/**
 * Prompt 26 (Dedicated Series Workspace Completion) — resolução do
 * ATIVO CANÔNICO de um item de série, pra alimentar Download e Abrir
 * no EditorOS (ver Prompt 28 pra "Usar no conteúdo" — content-
 * handoff.ts, uma preocupação SEPARADA, ver comentário abaixo).
 *
 * FASE 04/05 -- nunca parte de uma data URL antiga/React state
 * efêmero/URL salva anteriormente: sempre resolve `visual_asset_id` (o
 * vínculo real, já validado pela relação série -> item -> asset) e
 * gera uma signed URL NOVA no momento da chamada (nunca reusa uma
 * assinatura anterior).
 *
 * FASE 34/35 -- nunca aceita um `visual_asset_id` vindo do cliente: o
 * único input é `seriesId`/`itemId` (sob RLS via `fetchSeriesById`,
 * injetado pelo chamador com o client Supabase da SESSÃO); o asset_id
 * usado é sempre o que a própria relação item -> asset já tinha na
 * hidratação -- impossível "spoofar" um asset de outro item/Company
 * porque o cliente nunca controla esse valor.
 *
 * Prompt 28 (Content Handoff Authorization & Recent Series Repair) —
 * PARTE B: este módulo ANTES também recebia um `contentId` opcional e
 * autorizava via uma query ad hoc em `content_items` (RLS por
 * `client_id = current_client_id()` + lista fixa de roles de staff --
 * NUNCA `can_access_client_company()`, a função que `creative_series`
 * de fato usa). Investigação em Production (Supabase MCP, read-only)
 * confirmou: `content_items` tem uma política RLS ANTIGA/incompatível
 * (nem sequer cobre `super_admin` nem o modelo de delegação agency/
 * client_user_access que `can_access_client_company` cobre) -- por
 * isso um handoff genuinamente da MESMA Company sempre voltava 403.
 * Corrigido SEPARANDO as responsabilidades (FASE 06/07): este módulo
 * volta a ser só "resolve o ativo de um item ready", e a autorização de
 * conteúdo (que não pode depender da RLS quebrada de `content_items`)
 * mora em `content-handoff.ts`, derivando a Company do conteúdo a
 * partir do próprio `creative_series.content_id` (um campo já
 * autorizado por `creative_series`'s RLS real, nunca de uma query
 * separada com uma política incompatível).
 *
 * Extraído como módulo `.ts` puro (nunca `.tsx`/rota Next.js
 * diretamente) pela mesma razão dos Prompts 22/24: a decisão real
 * precisa ser testável com fakes injetados, sem depender do runtime do
 * Next.js/Supabase.
 */
import type { CreativeSeriesWithItems } from "./repository";
import type { CreativeSeriesItem } from "./types";

export interface SeriesAssetRow {
  storagePath: string;
  mime: string | null;
}

export interface CanonicalAssetDeps {
  /** Busca a row de `client_visual_assets` pelo id JÁ RESOLVIDO pela relação item -> asset (nunca um id vindo do cliente). */
  fetchAssetRow: (assetId: string) => Promise<SeriesAssetRow | null>;
  /** Gera uma signed URL nova a partir do storage_path -- nunca reusa uma assinatura anterior. */
  resolveSignedUrl: (storagePath: string) => Promise<string | null>;
}

export interface ResolveSeriesItemAssetDeps extends CanonicalAssetDeps {
  /** SEMPRE já amarrado ao client Supabase da SESSÃO pelo chamador (RLS real). Nunca lança -- erros viram null. */
  fetchSeriesById: (seriesId: string) => Promise<CreativeSeriesWithItems | null>;
}

export interface ResolveSeriesItemAssetInput {
  seriesId: string;
  itemId: string;
}

export type ResolveSeriesItemAssetResult =
  | { ok: true; signedUrl: string; mimeType: string; fileExtension: string; fileName: string; width: number; height: number }
  | { ok: false; status: 404 | 409 | 403 | 502; code: string; error: string };

export type ResolveReadySeriesItemResult =
  | { ok: true; series: CreativeSeriesWithItems; item: CreativeSeriesItem }
  | { ok: false; status: 404 | 409; code: string; error: string };

const MIME_EXTENSION: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

/**
 * FASE 08 -- resolve seriesId+itemId sob sessão/RLS e valida: item
 * pertence à série, está ready, tem `visual_asset_id` válido. Reusado
 * tanto por Download/EditorOS (asset-resolution.ts) quanto por "Usar
 * no conteúdo" (content-handoff.ts) -- a MESMA checagem de pertencimento
 * série->item em ambos os casos, nunca duas implementações divergentes.
 */
export async function resolveReadySeriesItem(
  fetchSeriesById: (seriesId: string) => Promise<CreativeSeriesWithItems | null>,
  seriesId: string,
  itemId: string,
): Promise<ResolveReadySeriesItemResult> {
  let series: CreativeSeriesWithItems | null;
  try {
    series = await fetchSeriesById(seriesId);
  } catch {
    series = null;
  }
  if (!series) return { ok: false, status: 404, code: "SERIES_NOT_FOUND", error: "Série não encontrada." };

  const item = series.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, status: 404, code: "SERIES_ITEM_NOT_FOUND", error: "Item não encontrado." };

  // FASE 02 -- ações de ativo só existem pra itens ready com um vínculo real de asset.
  if (item.status !== "ready" || !item.visualAssetId) {
    return { ok: false, status: 409, code: "SERIES_ITEM_NOT_READY", error: "Este item ainda não tem um ativo pronto." };
  }

  return { ok: true, series, item };
}

/** Última etapa, compartilhada: dado um item JÁ validado como ready+com asset, resolve o ativo canônico (signed URL fresca, MIME real, nome de arquivo humano). */
export async function resolveCanonicalAsset(deps: CanonicalAssetDeps, seriesId: string, item: CreativeSeriesItem): Promise<ResolveSeriesItemAssetResult> {
  let assetRow: SeriesAssetRow | null;
  try {
    assetRow = await deps.fetchAssetRow(item.visualAssetId!);
  } catch {
    assetRow = null;
  }
  if (!assetRow) return { ok: false, status: 404, code: "SERIES_ITEM_ASSET_NOT_FOUND", error: "Ativo não encontrado." };

  let signedUrl: string | null;
  try {
    signedUrl = await deps.resolveSignedUrl(assetRow.storagePath);
  } catch {
    signedUrl = null;
  }
  if (!signedUrl) return { ok: false, status: 502, code: "SERIES_ITEM_ASSET_SIGN_FAILED", error: "Não foi possível gerar o link do ativo agora." };

  const mimeType = assetRow.mime ?? "image/png";
  const fileExtension = MIME_EXTENSION[mimeType] ?? "png";
  const fileName = `serie-${seriesId}-peca-${item.position}.${fileExtension}`;

  return {
    ok: true, signedUrl, mimeType, fileExtension, fileName,
    width: item.image?.width ?? 1080, height: item.image?.height ?? 1080,
  };
}

/** FASE 26/27 -- Download/EditorOS: só resolve o ativo, NUNCA envolve autorização de conteúdo (essa é uma preocupação separada, ver content-handoff.ts). */
export async function resolveSeriesItemAsset(deps: ResolveSeriesItemAssetDeps, input: ResolveSeriesItemAssetInput): Promise<ResolveSeriesItemAssetResult> {
  const resolved = await resolveReadySeriesItem(deps.fetchSeriesById, input.seriesId, input.itemId);
  if (!resolved.ok) return resolved;
  return resolveCanonicalAsset(deps, input.seriesId, resolved.item);
}
