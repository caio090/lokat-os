/**
 * Prompt 26 (Dedicated Series Workspace Completion) — resolução do
 * ATIVO CANÔNICO de um item de série, pra alimentar as três "portas de
 * saída" do workspace (Download, Abrir no EditorOS, Usar no conteúdo).
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
 * FASE 36 -- quando `contentId` é informado (uso exclusivo de "Usar no
 * conteúdo"), valida que aquele conteúdo pertence à MESMA Company da
 * série antes de liberar o asset -- nunca confia no UUID sozinho como
 * autorização.
 *
 * Extraído como módulo `.ts` puro (nunca `.tsx`/rota Next.js
 * diretamente) pela mesma razão dos Prompts 22/24: a decisão real
 * precisa ser testável com fakes injetados, sem depender do runtime do
 * Next.js/Supabase.
 */
import type { CreativeSeriesWithItems } from "./repository";

export interface SeriesAssetRow {
  storagePath: string;
  mime: string | null;
}

export interface ResolveSeriesItemAssetDeps {
  /** SEMPRE já amarrado ao client Supabase da SESSÃO pelo chamador (RLS real). Nunca lança -- erros viram null. */
  fetchSeriesById: (seriesId: string) => Promise<CreativeSeriesWithItems | null>;
  /** Busca a row de `client_visual_assets` pelo id JÁ RESOLVIDO pela relação item -> asset (nunca um id vindo do cliente). */
  fetchAssetRow: (assetId: string) => Promise<SeriesAssetRow | null>;
  /** Gera uma signed URL nova a partir do storage_path -- nunca reusa uma assinatura anterior. */
  resolveSignedUrl: (storagePath: string) => Promise<string | null>;
  /** FASE 36 -- só chamado quando `contentId` está presente no input. Verifica que o conteúdo pertence à Company da série. */
  checkContentAccessible: (contentId: string, clientId: string | null) => Promise<boolean>;
}

export interface ResolveSeriesItemAssetInput {
  seriesId: string;
  itemId: string;
  /** FASE 36 -- presente só na ação "Usar no conteúdo"; ausente em Download/EditorOS (que nunca dependem de um conteúdo real). */
  contentId?: string | null;
}

export type ResolveSeriesItemAssetResult =
  | { ok: true; signedUrl: string; mimeType: string; fileExtension: string; fileName: string; width: number; height: number }
  | { ok: false; status: 404 | 409 | 403 | 502; code: string; error: string };

const MIME_EXTENSION: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

export async function resolveSeriesItemAsset(deps: ResolveSeriesItemAssetDeps, input: ResolveSeriesItemAssetInput): Promise<ResolveSeriesItemAssetResult> {
  let series: CreativeSeriesWithItems | null;
  try {
    series = await deps.fetchSeriesById(input.seriesId);
  } catch {
    series = null;
  }
  if (!series) return { ok: false, status: 404, code: "SERIES_NOT_FOUND", error: "Série não encontrada." };

  const item = series.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, status: 404, code: "SERIES_ITEM_NOT_FOUND", error: "Item não encontrado." };

  // FASE 02 -- ações de ativo só existem pra itens ready com um vínculo real de asset.
  if (item.status !== "ready" || !item.visualAssetId) {
    return { ok: false, status: 409, code: "SERIES_ITEM_NOT_READY", error: "Este item ainda não tem um ativo pronto." };
  }

  if (input.contentId) {
    let authorized: boolean;
    try {
      authorized = await deps.checkContentAccessible(input.contentId, series.series.clientId);
    } catch {
      authorized = false;
    }
    if (!authorized) return { ok: false, status: 403, code: "SERIES_ITEM_CONTENT_FORBIDDEN", error: "Este conteúdo não está disponível para esta série." };
  }

  let assetRow: SeriesAssetRow | null;
  try {
    assetRow = await deps.fetchAssetRow(item.visualAssetId);
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
  const fileName = `serie-${input.seriesId}-peca-${item.position}.${fileExtension}`;

  return {
    ok: true, signedUrl, mimeType, fileExtension, fileName,
    width: item.image?.width ?? 1080, height: item.image?.height ?? 1080,
  };
}
