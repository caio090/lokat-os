/**
 * Prompt 28 (Content Handoff Authorization & Recent Series Repair) —
 * autorização de "Usar no conteúdo" (Series -> Criar), separada da
 * resolução de ativo genérica (asset-resolution.ts, usada por
 * Download/EditorOS).
 *
 * ROOT CAUSE (ver relatório completo) -- o endpoint de asset ANTES
 * autorizava conteúdo consultando `content_items` com o client
 * Supabase da SESSÃO, filtrando `client_id = <company da série>`. Essa
 * query nunca funcionava de verdade: a política RLS de SELECT de
 * `content_items` é ANTIGA (`client_id = current_client_id()` --
 * "own client only" -- OU uma lista FIXA de roles de staff que nem
 * inclui `super_admin`) e NUNCA foi atualizada pra usar
 * `can_access_client_company()`, a função que `creative_series`,
 * `creative_series_items` e `client_visual_assets` já usam
 * corretamente (confirmado lendo as policies reais via Supabase MCP,
 * read-only). Resultado: uma sessão genuinamente autorizada pra
 * Company A (via `can_access_client_company`) podia MESMO ASSIM
 * receber zero linhas de uma query direta em `content_items` -- daí o
 * 403 num caso legítimo.
 *
 * CORREÇÃO -- nunca consulta `content_items` de novo (essa tabela
 * continua com a política antiga; corrigi-la exigiria uma migration,
 * fora do escopo deste prompt) e NUNCA usa service role (proibido
 * explicitamente). Em vez disso, deriva a autorização de conteúdo a
 * partir de um campo que JÁ está sob uma RLS correta e testada:
 * `creative_series.content_id` -- preenchido na criação da série
 * (POST /api/rec-os/series, sempre atrás de `resolveCompanyContext`)
 * e protegido por uma FK real pra `content_items.id`
 * (`creative_series_content_id_fkey`, `ON DELETE SET NULL` -- nunca
 * pode apontar pra uma linha inexistente). "Usar no conteúdo" só
 * autoriza quando o `contentId` pedido pelo cliente é EXATAMENTE o
 * mesmo já associado à série no banco -- nunca deriva do query param
 * sozinho (FASE 10/11), nunca aceita um id de transporte sintético
 * (seriesItemTransportContentId, usado só pelo EditorOS quando não há
 * conteúdo real -- ver FASE 14/15 e TEST 07).
 */
import type { CreativeSeriesWithItems } from "./repository";
import { resolveReadySeriesItem, resolveCanonicalAsset } from "./asset-resolution";
import type { CanonicalAssetDeps, ResolveSeriesItemAssetResult } from "./asset-resolution";

export interface PrepareContentHandoffDeps extends CanonicalAssetDeps {
  fetchSeriesById: (seriesId: string) => Promise<CreativeSeriesWithItems | null>;
}

export interface PrepareContentHandoffInput {
  seriesId: string;
  itemId: string;
  /** Real, vindo do fluxo Criar -- nunca o id de transporte sintético do EditorOS (FASE 14/15). */
  contentId: string;
}

export type PrepareContentHandoffResult =
  | (Extract<ResolveSeriesItemAssetResult, { ok: true }> & { contentId: string })
  | { ok: false; status: 404 | 409 | 403 | 502; code: string; error: string };

/**
 * FASE 08-13 -- resolve série/item/asset sob RLS, depois autoriza o
 * conteúdo comparando com `series.content_id` (nunca uma query
 * separada, nunca o query param sozinho). Company diferente (série A +
 * conteúdo B) e conteúdo ausente/nunca associado produzem o MESMO
 * resultado observável (403, fail closed) -- nunca revela detalhes de
 * outro workspace.
 */
export async function prepareSeriesItemContentHandoff(deps: PrepareContentHandoffDeps, input: PrepareContentHandoffInput): Promise<PrepareContentHandoffResult> {
  const resolved = await resolveReadySeriesItem(deps.fetchSeriesById, input.seriesId, input.itemId);
  if (!resolved.ok) return resolved;

  // FASE 10/11/12 -- a Company do conteúdo é derivada do próprio objeto
  // já autorizado (series.content_id, sob a RLS real de creative_series),
  // nunca de uma segunda consulta a content_items (RLS incompatível, ver
  // cabeçalho) nem do query param isolado. Série sem conteúdo associado
  // (content_id null -- série standalone) ou conteúdo diferente do
  // pedido: mesmo 403 genérico, fail closed (FASE 13).
  if (!resolved.series.series.contentId || resolved.series.series.contentId !== input.contentId) {
    return { ok: false, status: 403, code: "SERIES_ITEM_CONTENT_FORBIDDEN", error: "Este conteúdo não está disponível para esta série." };
  }

  const asset = await resolveCanonicalAsset(deps, input.seriesId, resolved.item);
  if (!asset.ok) return asset;
  return { ...asset, contentId: input.contentId };
}
