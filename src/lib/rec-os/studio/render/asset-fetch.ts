/**
 * Prompt 03 (Studio Release Fix) — busca segura de asset remoto, agora
 * com PINNING de conexão para eliminar SSRF por DNS rebinding/TOCTOU.
 *
 * O problema da versão anterior: validava o IP resolvido e, em
 * seguida, deixava o `fetch` global resolver o hostname DE NOVO para
 * abrir a conexão de verdade -- entre essas duas resoluções, um
 * atacante controlando o DNS do próprio domínio pode trocar a
 * resposta (primeira consulta pública, segunda privada) e o socket
 * real acaba se conectando a um endereço nunca validado.
 *
 * Correção: resolve TODOS os endereços uma única vez
 * (dns.promises.lookup com `all:true`), valida TODOS (rejeita se
 * qualquer um deles não for unicast público -- nunca só ignora o
 * ruim e segue com o bom), e usa um dispatcher `undici.Agent` cujo
 * `connect.lookup` é uma função pinada: ela NUNCA consulta DNS de
 * novo, sempre devolve o endereço já validado, não importa o
 * hostname recebido em runtime (ver buildPinnedLookup, testado
 * isoladamente com um hostname diferente do original para provar
 * que o pin realmente ignora qualquer nova tentativa de resolução).
 * `servername`/Host continuam o hostname original (SNI e validação
 * de certificado TLS continuam corretos -- `rejectUnauthorized`
 * nunca é desativado).
 *
 * Classificação de endereço via `ipaddr.js` (biblioteca madura,
 * cobre IPv4/IPv6/IPv4-mapped/carrier-grade NAT/unique-local/
 * link-local/multicast/reservado -- nunca uma regex improvisada).
 */
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import ipaddr from "ipaddr.js";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 8_000_000; // ~8MB
/**
 * FASE 31M §5 -- logos oficiais de marca são frequentemente SVG
 * (vetorial); `sharp` (usado pelo compositor real, render/compositor.ts)
 * já decodifica SVG nativamente e o rasteriza preservando alpha
 * (confirmado localmente, sem rede: `sharp(svgBuffer).resize(...).png()`
 * funciona sem nenhuma dependência nova) -- o único bloqueio real era
 * este allowlist nunca ter incluído `image/svg+xml`. `+xml` no fim é
 * opcional (alguns servidores devolvem `image/svg+xml; charset=utf-8`,
 * outros só `image/svg+xml`).
 */
const ALLOWED_CONTENT_TYPES = /^image\/(png|jpe?g|webp|gif|svg\+xml)/i;

export interface AssetFetchResult {
  ok: boolean;
  bytes?: Buffer;
  contentType?: string;
  error?: string;
}

/** Único range que ipaddr.js devolve para "endereço unicast público
 *  comum" -- todo o resto (loopback/private/linkLocal/uniqueLocal/
 *  multicast/reserved/carrierGradeNat/unspecified/broadcast/
 *  ipv4Mapped-privado/etc.) é bloqueado por padrão (allowlist, não
 *  denylist -- nunca esquece uma categoria nova). */
function isPublicUnicastAddress(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return addr.range() === "unicast";
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type ResolveAllResult =
  | { ok: true; addresses: ResolvedAddress[] }
  | { ok: false; error: string };

/**
 * Resolve TODOS os endereços do hostname e valida TODOS -- rejeita a
 * lista inteira se qualquer um dos endereços não for unicast público
 * (nunca aceita "pelo menos um endereço bom", já que o atacante
 * controla qual deles o cliente pode acabar usando).
 */
export async function resolveAllAndValidate(hostname: string): Promise<ResolveAllResult> {
  const literalFamily = isIP(hostname);
  let raw: LookupAddress[];
  if (literalFamily) {
    raw = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      raw = await dnsLookup(hostname, { all: true, verbatim: true });
    } catch {
      return { ok: false, error: "Não foi possível resolver o host." };
    }
  }
  if (raw.length === 0) return { ok: false, error: "Host não resolveu para nenhum endereço." };

  const addresses: ResolvedAddress[] = raw.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
  for (const { address } of addresses) {
    if (!isPublicUnicastAddress(address)) {
      return { ok: false, error: "Host resolve para um endereço não permitido." };
    }
  }
  return { ok: true, addresses };
}

/**
 * Constrói a função de lookup PINADA passada ao dispatcher undici.
 * Nunca consulta DNS -- devolve sempre o endereço já validado,
 * independente do `hostname` recebido em runtime (é isso que fecha a
 * janela TOCTOU: mesmo que o DNS real do domínio mude entre a
 * validação e a conexão, esta função nunca é reconsultada).
 */
export function buildPinnedLookup(pinned: ResolvedAddress) {
  return function pinnedLookup(
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
  ): void {
    if (options?.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      callback(null, pinned.address, pinned.family);
    }
  };
}

function isAllowedUrl(rawUrl: string): { ok: true; url: URL; hostname: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "URL inválida." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Somente URLs https são aceitas." };
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    return { ok: false, error: "Host não permitido." };
  }
  return { ok: true, url, hostname };
}

/**
 * Busca segura de um asset de imagem por URL https pública, com a
 * conexão real pinada ao endereço já validado (sem SSRF por DNS
 * rebinding/TOCTOU). Rejeita explicitamente localhost/IP privado/
 * link-local/carrier-grade NAT/metadata service/IPv6 privado antes de
 * qualquer conexão real. Nunca segue redirect. Nunca lança -- toda
 * falha vira `{ ok: false, error }`, nunca bloqueia a geração inteira.
 */
export async function fetchAssetSafely(rawUrl: string): Promise<AssetFetchResult> {
  const parsed = isAllowedUrl(rawUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { url, hostname } = parsed;

  const resolution = await resolveAllAndValidate(hostname);
  if (!resolution.ok) return { ok: false, error: resolution.error };

  const pinned = resolution.addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup: buildPinnedLookup(pinned),
      servername: hostname, // SNI/certificado continuam validados contra o hostname real, nunca contra o IP.
      rejectUnauthorized: true,
      timeout: FETCH_TIMEOUT_MS,
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await undiciFetch(url.toString(), {
      signal: controller.signal,
      redirect: "error", // nunca segue redirect -- cada hop precisaria de nova validação/pin, fora de escopo.
      dispatcher: dispatcher as unknown as Dispatcher,
    });
    if (!res.ok) return { ok: false, error: `Falha ao buscar asset (HTTP ${res.status}).` };
    const contentType = res.headers.get("content-type") ?? "";
    if (!ALLOWED_CONTENT_TYPES.test(contentType)) {
      return { ok: false, error: `Tipo de conteúdo não suportado: ${contentType || "desconhecido"}.` };
    }
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BYTES) {
      return { ok: false, error: "Asset excede o tamanho máximo permitido." };
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return { ok: false, error: "Asset excede o tamanho máximo permitido." };
    }
    return { ok: true, bytes: Buffer.from(arrayBuffer), contentType };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: timedOut ? "Tempo limite excedido ao buscar o asset." : "Não foi possível buscar o asset." };
  } finally {
    clearTimeout(timer);
    await dispatcher.close().catch(() => {});
  }
}
