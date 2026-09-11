/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/lib/rec-os/studio/render/__tests__/asset-fetch.structural.test.ts
 * Prompt 03 (Studio Release Fix) — threat pass completo do fetch
 * seguro: SSRF (localhost/IP privado/link-local/carrier-grade NAT/
 * metadata service/IPv6 privado/IPv4-mapped), múltiplos endereços
 * mistos (público+privado), e a prova central do fix de DNS
 * rebinding/TOCTOU: a função de lookup pinada NUNCA re-resolve o
 * hostname, não importa o que for passado a ela em runtime.
 * Nenhuma requisição de rede real: `node:dns/promises` é mockado por
 * teste; `global.fetch`/undici não chegam a ser exercitados nos casos
 * que já falham na validação de endereço (mais rápido e determinístico).
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchAssetSafely } from "../asset-fetch";

async function withDnsMock<T>(t: TestContext, addresses: { address: string; family: number }[], run: () => Promise<T>): Promise<T> {
  let calls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", {
    exports: { lookup: async () => { calls++; return addresses; } },
  });
  const result = await run();
  return Object.assign(result as object, { __dnsCalls: calls }) as T;
}

test("[1] hostname resolve só para IP público (unicast) -- validação aceita", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.resolveAllAndValidate("example-public.test");
  assert.equal(result.ok, true);
});

test("[2] hostname resolve para 127.0.0.1 -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "127.0.0.1", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.resolveAllAndValidate("attacker.test");
  assert.equal(result.ok, false);
});

test("[3] hostname resolve para 10.x -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "10.0.0.5", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("[4] hostname resolve para 172.16/12 -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "172.16.5.1", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("[5] hostname resolve para 192.168.x -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "192.168.1.1", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("[6] hostname resolve para 169.254.x (link-local) -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "169.254.1.1", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("[7] metadata service da cloud (169.254.169.254) -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "169.254.169.254", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("metadata-lookalike.test")).ok, false);
});

test("[7b] metadata.google.internal -- bloqueado por hostname mesmo antes do DNS", async () => {
  const result = await fetchAssetSafely("https://metadata.google.internal/computeMetadata/v1/");
  assert.equal(result.ok, false);
});

test("[8] IPv6 ::1 (loopback) -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "::1", family: 6 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("[9] IPv6 unique-local (fc00::/7) -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "fd12:3456:789a::1", family: 6 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("[10] IPv6 link-local (fe80::/10) -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "fe80::1", family: 6 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("[11] IPv4-mapped IPv6 embutindo endereço privado (::ffff:127.0.0.1) -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "::ffff:127.0.0.1", family: 6 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("carrier-grade NAT (100.64.0.0/10, RFC6598) -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "100.64.0.1", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("IPv4 reservado/documentação (RFC5737, ex.: 203.0.113.0/24) -- bloqueado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "203.0.113.10", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  assert.equal((await mod.resolveAllAndValidate("attacker.test")).ok, false);
});

test("[12] múltiplos endereços -- um público, um privado -- REJEITA o conjunto inteiro (nunca escolhe só o bom)", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", {
    exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }] },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.resolveAllAndValidate("mixed.test");
  assert.equal(result.ok, false, "presença de QUALQUER endereço privado na lista invalida a resolução inteira");
});

test("URL IP literal privado (sem DNS) -- bloqueado", async () => {
  const result = await fetchAssetSafely("https://192.168.0.1/logo.png");
  assert.equal(result.ok, false);
});

test("[13] PROVA DE PINNING: a função de lookup usada na conexão real NUNCA re-resolve -- ignora completamente qualquer hostname passado a ela depois", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);

  const pinnedLookup = mod.buildPinnedLookup({ address: "8.8.8.8", family: 4 });

  // Simula o pior caso de rebinding: o hostname que a conexão real
  // "pediria" para resolver de novo já mudou para outra coisa
  // (controlada por um atacante). A prova do fix é que isso não
  // importa -- a função pinada nunca consulta DNS, então nunca vê
  // esse hostname alterado, e devolve sempre o endereço pinado original.
  const single = { address: null as string | null, family: null as number | null };
  pinnedLookup(
    "completamente-diferente.attacker-controlled.evil",
    undefined,
    (_err: unknown, address: unknown, family: unknown) => {
      single.address = address as string;
      single.family = family as number;
    },
  );
  assert.equal(single.address, "8.8.8.8");
  assert.equal(single.family, 4);

  const all = { addresses: null as { address: string; family: number }[] | null };
  pinnedLookup(
    "outro-hostname-totalmente-diferente.evil",
    { all: true },
    (_err: unknown, addresses: unknown) => {
      all.addresses = addresses as { address: string; family: number }[];
    },
  );
  assert.equal(all.addresses?.length, 1);
  assert.equal(all.addresses?.[0]?.address, "8.8.8.8");
});

test("[13b] o lookup pinado nunca invoca o resolvedor DNS real -- é uma função pura sobre o valor já capturado", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "src/lib/rec-os/studio/render/asset-fetch.ts"), "utf8");
  const fnBody = content.slice(content.indexOf("export function buildPinnedLookup"), content.indexOf("function isAllowedUrl"));
  assert.ok(!/dnsLookup|dns\.lookup|dns\.resolve/.test(fnBody), "buildPinnedLookup nunca chama dns.lookup/dns.resolve -- a única resolução real acontece antes, em resolveAllAndValidate");
});

test("nenhuma segunda chamada a dns.promises.lookup acontece entre a validação e o resultado (mesma execução, um único lookup)", async (t) => {
  const result = await withDnsMock(t, [{ address: "8.8.8.8", family: 4 }], async () => {
    const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
    return mod.resolveAllAndValidate("example-public.test");
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((result as any).__dnsCalls, 1, "resolveAllAndValidate consulta o DNS real exatamente uma vez");
});

test("rejeita URL com esquema não-https (http)", async () => {
  const result = await fetchAssetSafely("http://example.com/logo.png");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /https/i);
});

test("rejeita URL malformada", async () => {
  const result = await fetchAssetSafely("not a url");
  assert.equal(result.ok, false);
});

test("rejeita localhost explicitamente (fast-path por hostname, antes de qualquer DNS)", async () => {
  const result = await fetchAssetSafely("https://localhost/logo.png");
  assert.equal(result.ok, false);
});

test("[15] URL IP direto privado -- bloqueado (fetchAssetSafely ponta a ponta)", async () => {
  const result = await fetchAssetSafely("https://127.0.0.1/logo.png");
  assert.equal(result.ok, false);
});

test("[16] URL HTTPS pública válida -- pipeline completo funciona (fetch real mockado via dispatcher)", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  const bytes = new Uint8Array([1, 2, 3, 4]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("undici", {
    exports: {
      Agent: class { close() { return Promise.resolve(); } },
      fetch: async () => new Response(bytes, { status: 200, headers: { "content-type": "image/png", "content-length": String(bytes.length) } }),
    },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.fetchAssetSafely("https://example-public.test/logo.png");
  assert.equal(result.ok, true);
  assert.equal(result.bytes?.length, 4);
  assert.equal(result.contentType, "image/png");
});

test("[FASE 31M] Content-Type image/svg+xml é aceito (logos oficiais são frequentemente SVG -- sharp já decodifica nativamente)", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("undici", {
    exports: {
      Agent: class { close() { return Promise.resolve(); } },
      fetch: async () => new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml; charset=utf-8", "content-length": String(svg.length) } }),
    },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.fetchAssetSafely("https://example-public.test/logo.svg");
  assert.equal(result.ok, true, "image/svg+xml (com ou sem charset) nunca mais é rejeitado só por ser vetorial");
  assert.equal(result.contentType, "image/svg+xml; charset=utf-8");
});

test("rejeita Content-Type que não é imagem conhecida", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("undici", {
    exports: {
      Agent: class { close() { return Promise.resolve(); } },
      fetch: async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.fetchAssetSafely("https://example-public.test/not-an-image");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Tipo de conteúdo/);
});

test("rejeita asset acima do tamanho máximo (Content-Length)", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("undici", {
    exports: {
      Agent: class { close() { return Promise.resolve(); } },
      fetch: async () => new Response(new Uint8Array(10), { status: 200, headers: { "content-type": "image/png", "content-length": String(50_000_000) } }),
    },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.fetchAssetSafely("https://example-public.test/huge.png");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /tamanho máximo/);
});

test("propaga falha HTTP como erro explícito, nunca lança", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("undici", {
    exports: {
      Agent: class { close() { return Promise.resolve(); } },
      fetch: async () => new Response("not found", { status: 404 }),
    },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.fetchAssetSafely("https://example-public.test/missing.png");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /404/);
});

test("[14] redirect nunca é seguido -- fetch com redirect:error propaga como falha", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("undici", {
    exports: {
      Agent: class { close() { return Promise.resolve(); } },
      fetch: async (_url: string, opts: { redirect?: string }) => {
        assert.equal(opts.redirect, "error", "fetch é sempre chamado com redirect:error -- nunca segue automaticamente");
        throw new TypeError("redirect");
      },
    },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.fetchAssetSafely("https://example-public.test/redirects-to-private");
  assert.equal(result.ok, false);
});

test("exceção de rede vira erro explícito, nunca lança", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("undici", {
    exports: {
      Agent: class { close() { return Promise.resolve(); } },
      fetch: async () => { throw new Error("network down"); },
    },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  const result = await mod.fetchAssetSafely("https://example-public.test/logo.png");
  assert.equal(result.ok, false);
});

test("servername/SNI usado na conexão é o hostname original, nunca o IP pinado", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("node:dns/promises", { exports: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } });
  const captured: { connect: { servername?: string; rejectUnauthorized?: boolean } | null } = { connect: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("undici", {
    exports: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Agent: class { constructor(opts: any) { captured.connect = opts.connect; } close() { return Promise.resolve(); } },
      fetch: async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/png", "content-length": "1" } }),
    },
  });
  const mod = await import(`../asset-fetch.ts?t=${Date.now()}-${Math.random()}`);
  await mod.fetchAssetSafely("https://example-public.test/logo.png");
  assert.equal(captured.connect?.servername, "example-public.test", "SNI continua o hostname original, nunca o IP pinado");
  assert.equal(captured.connect?.rejectUnauthorized, true, "verificação de certificado TLS nunca é desativada pelo pinning");
});
