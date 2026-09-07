/**
 * Prompt 16/18 (REC OS Persistence Completion / Creative Series Control
 * & Asset Link Repair) — camada única de persistência de Série Visual.
 * Nenhuma query Supabase espalhada em componentes React -- todo acesso
 * a `creative_series`/`creative_series_items`/`client_visual_assets`
 * (join de hidratação) passa por aqui.
 *
 * SEMPRE recebe um client Supabase já vinculado à SESSÃO do usuário
 * (nunca o admin/service role) -- RLS real (can_access_client_company/
 * can_write_client_company, created_by = auth.uid() pro Free Mode).
 *
 * Prompt 18 -- correções: `updateCreativeSeriesItem` não aceita mais
 * `assetUrl` (Fase "SIGNED URL": nunca persistir URL assinada -- ela
 * expira). Hidratação agora resolve `visual_asset_id` -> storage_path
 * -> signed URL nova a cada chamada. Adicionado
 * `reconcileStaleGeneratingItems` (Fase "STALE GENERATING").
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreativeSeriesItem, CreativeSeriesItemStatus, CreativeSeriesSize } from "./types";
import { resolveAssetSignedUrl } from "./asset-persistence";

export interface CreativeSeriesRow {
  id: string;
  clientId: string | null;
  contentId: string | null;
  campaignId: string | null;
  title: string | null;
  count: CreativeSeriesSize;
  placement: string | null;
  format: string | null;
  creativeDirection: string | null;
  status: "draft" | "generating" | "ready" | "error";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeSeriesWithItems {
  series: CreativeSeriesRow;
  items: CreativeSeriesItem[];
}

interface DbSeriesRow {
  id: string; client_id: string | null; content_id: string | null; campaign_id: string | null;
  title: string | null; count: number; placement: string | null; format: string | null;
  creative_direction: string | null; status: string; created_by: string | null;
  created_at: string; updated_at: string;
}
interface DbItemRow {
  id: string; series_id: string; position: number; role: string | null; brief: string | null;
  headline: string | null; cta: string | null; status: string; visual_asset_id: string | null;
  generation_metadata: Record<string, unknown> | null; updated_at: string;
}

function rowToSeries(row: DbSeriesRow): CreativeSeriesRow {
  return {
    id: row.id, clientId: row.client_id, contentId: row.content_id, campaignId: row.campaign_id,
    title: row.title, count: row.count as CreativeSeriesSize, placement: row.placement, format: row.format,
    creativeDirection: row.creative_direction, status: row.status as CreativeSeriesRow["status"],
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Fase "HYDRATION" -- resolve visual_asset_id -> storage_path -> signed URL nova (nunca persiste a URL). Assets de outra Company nunca aparecem aqui (RLS do client_visual_assets já existente, mesmo client da sessão). */
async function resolveItemThumbnails(db: SupabaseClient, items: DbItemRow[]): Promise<Map<string, string | null>> {
  const assetIds = items.map((i) => i.visual_asset_id).filter((id): id is string => Boolean(id));
  const result = new Map<string, string | null>();
  if (assetIds.length === 0) return result;

  const { data: assets, error } = await db.from("client_visual_assets").select("id, storage_path").in("id", assetIds);
  if (error || !assets) return result;

  const pathByAssetId = new Map((assets as { id: string; storage_path: string | null }[]).map((a) => [a.id, a.storage_path]));
  for (const item of items) {
    if (!item.visual_asset_id) continue;
    const path = pathByAssetId.get(item.visual_asset_id);
    if (!path) { result.set(item.visual_asset_id, null); continue; }
    result.set(item.visual_asset_id, await resolveAssetSignedUrl(db, path));
  }
  return result;
}

function rowToItem(row: DbItemRow, signedUrl: string | null): CreativeSeriesItem {
  return {
    id: row.id, position: row.position, role: row.role ?? `Peça ${row.position}`, brief: row.brief ?? "",
    headline: row.headline ?? undefined, cta: row.cta ?? undefined,
    status: row.status as CreativeSeriesItemStatus,
    visualAssetId: row.visual_asset_id,
    image: row.visual_asset_id && signedUrl ? { url: signedUrl, width: 1080, height: 1080 } : null,
    error: (row.generation_metadata as { error?: string } | null)?.error ?? null,
  };
}

async function hydrateItems(db: SupabaseClient, dbItems: DbItemRow[]): Promise<CreativeSeriesItem[]> {
  const thumbnails = await resolveItemThumbnails(db, dbItems);
  return dbItems
    .sort((a, b) => a.position - b.position)
    .map((row) => rowToItem(row, row.visual_asset_id ? (thumbnails.get(row.visual_asset_id) ?? null) : null));
}

export interface CreateSeriesInput {
  clientId: string | null;
  contentId: string | null;
  campaignId: string | null;
  title: string | null;
  count: CreativeSeriesSize;
  placement: string | null;
  format: string | null;
  creativeDirection: string | null;
  createdBy: string;
  itemBriefs: { position: number; role: string; brief: string }[];
}

export type CreateSeriesResult = { ok: true; series: CreativeSeriesWithItems } | { ok: false; error: string };

/**
 * Fase "CRIAR SÉRIE" -- só cria a estrutura (1 creative_series + N
 * creative_series_items, todos "planned"). NENHUM request ao provider
 * de imagem acontece aqui -- Criar Série != Gerar Série (Fase "REGRA DE
 * PRODUTO"). Compensating rollback se o insert dos items falhar depois
 * do insert da série.
 */
export async function createCreativeSeries(db: SupabaseClient, input: CreateSeriesInput): Promise<CreateSeriesResult> {
  const { data: seriesRow, error: seriesError } = await db
    .from("creative_series")
    .insert({
      client_id: input.clientId, content_id: input.contentId, campaign_id: input.campaignId,
      title: input.title, count: input.count, placement: input.placement, format: input.format,
      creative_direction: input.creativeDirection, status: "draft", created_by: input.createdBy,
    })
    .select("*")
    .single();

  if (seriesError || !seriesRow) {
    return { ok: false, error: "Não foi possível criar a série agora." };
  }

  const itemsPayload = input.itemBriefs.map((b) => ({
    series_id: seriesRow.id, position: b.position, role: b.role, brief: b.brief, status: "planned",
  }));
  const { data: itemRows, error: itemsError } = await db
    .from("creative_series_items")
    .insert(itemsPayload)
    .select("*");

  if (itemsError || !itemRows || itemRows.length !== input.itemBriefs.length) {
    await db.from("creative_series").delete().eq("id", seriesRow.id);
    return { ok: false, error: "Não foi possível criar os itens da série agora." };
  }

  return {
    ok: true,
    series: {
      series: rowToSeries(seriesRow as DbSeriesRow),
      items: (itemRows as DbItemRow[]).sort((a, b) => a.position - b.position).map((row) => rowToItem(row, null)),
    },
  };
}

/**
 * Prompt 18 -- toda hidratação passa por aqui (inclusive
 * findRecentCreativeSeries abaixo), então a reconciliação de items
 * presos em "generating" (STALE_GENERATING_THRESHOLD_MS, ver
 * reconcileStaleGeneratingItems) acontece num único lugar, nunca
 * duplicada nas rotas chamadoras.
 */
export async function getCreativeSeriesWithItems(db: SupabaseClient, seriesId: string): Promise<CreativeSeriesWithItems | null> {
  const { data: seriesRow, error: seriesError } = await db.from("creative_series").select("*").eq("id", seriesId).maybeSingle();
  if (seriesError || !seriesRow) return null;
  await reconcileStaleGeneratingItems(db, seriesId);
  const { data: itemRows, error: itemsError } = await db.from("creative_series_items").select("*").eq("series_id", seriesId);
  if (itemsError) return null;
  return { series: rowToSeries(seriesRow as DbSeriesRow), items: await hydrateItems(db, (itemRows ?? []) as DbItemRow[]) };
}

/** Fase 25/26 -- série mais recente pro contexto (client/content), pra permitir "continuar" em vez de recomeçar a cada mount. */
export async function findRecentCreativeSeries(db: SupabaseClient, filter: { clientId: string | null; contentId: string | null }): Promise<CreativeSeriesWithItems | null> {
  let query = db.from("creative_series").select("*").order("created_at", { ascending: false }).limit(1);
  query = filter.contentId ? query.eq("content_id", filter.contentId) : query.is("content_id", null);
  query = filter.clientId ? query.eq("client_id", filter.clientId) : query.is("client_id", null);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return getCreativeSeriesWithItems(db, (data as DbSeriesRow).id);
}

export interface CreativeSeriesSummary {
  id: string;
  clientId: string | null;
  count: CreativeSeriesSize;
  format: string | null;
  status: CreativeSeriesRow["status"];
  createdAt: string;
  readyCount: number;
  totalCount: number;
}

/**
 * Prompt 26 (Dedicated Series Workspace Completion) -- FASE 23-28:
 * "Séries Recentes" no Studio root. Deliberadamente LEVE (FASE 28 --
 * "não baixar seis imagens full-resolution por série recente"): nunca
 * hidrata `image`/signed URL de nenhum item, só conta status pra
 * mostrar progresso ("2/6 prontas"). Aditiva -- não modifica
 * `findRecentCreativeSeries` (ainda usada pelo fluxo "continuar" de
 * uma única série) nem nenhuma outra função deste arquivo.
 */
export async function listRecentCreativeSeries(db: SupabaseClient, filter: { clientId: string | null; contentId: string | null }, limit: number): Promise<CreativeSeriesSummary[]> {
  let query = db.from("creative_series").select("*").order("created_at", { ascending: false }).limit(limit);
  query = filter.contentId ? query.eq("content_id", filter.contentId) : query.is("content_id", null);
  query = filter.clientId ? query.eq("client_id", filter.clientId) : query.is("client_id", null);
  const { data, error } = await query;
  if (error || !data || data.length === 0) return [];

  const rows = data as DbSeriesRow[];
  const seriesIds = rows.map((r) => r.id);
  const { data: itemRows } = await db.from("creative_series_items").select("series_id, status").in("series_id", seriesIds);
  const readyBySeriesId = new Map<string, number>();
  const totalBySeriesId = new Map<string, number>();
  for (const item of (itemRows ?? []) as { series_id: string; status: string }[]) {
    totalBySeriesId.set(item.series_id, (totalBySeriesId.get(item.series_id) ?? 0) + 1);
    if (item.status === "ready") readyBySeriesId.set(item.series_id, (readyBySeriesId.get(item.series_id) ?? 0) + 1);
  }
  return rows.map((row) => ({
    id: row.id, clientId: row.client_id, count: row.count as CreativeSeriesSize, format: row.format,
    status: row.status as CreativeSeriesRow["status"], createdAt: row.created_at,
    readyCount: readyBySeriesId.get(row.id) ?? 0, totalCount: totalBySeriesId.get(row.id) ?? row.count,
  }));
}

export interface UpdateSeriesItemStatusInput {
  status: CreativeSeriesItemStatus;
  error?: string | null;
}

/**
 * Fase 23/28/30 -- transição de status SEM asset (generating/error/
 * canceled/planned). A transição pra "ready" com asset passa
 * exclusivamente por persistGeneratedSeriesItemAsset() (asset-
 * persistence.ts) -- nunca por aqui, pra nunca ser possível marcar
 * "ready" sem o vínculo real (Test 08).
 */
export async function updateCreativeSeriesItemStatus(db: SupabaseClient, itemId: string, input: UpdateSeriesItemStatusInput): Promise<boolean> {
  const { error } = await db.from("creative_series_items").update({
    status: input.status,
    generation_metadata: input.error ? { error: input.error } : null,
  }).eq("id", itemId);
  return !error;
}

/** Recalcula o status agregado da série a partir dos items -- nunca um segundo "source of truth" divergente. */
export async function recomputeSeriesStatus(db: SupabaseClient, seriesId: string): Promise<void> {
  const { data: items } = await db.from("creative_series_items").select("status").eq("series_id", seriesId);
  const statuses = ((items ?? []) as { status: string }[]).map((i) => i.status);
  if (statuses.length === 0) return;
  const terminal = new Set(["ready", "error", "canceled"]);
  const allTerminal = statuses.every((s) => terminal.has(s));
  const anyError = statuses.some((s) => s === "error");
  const nextStatus = !allTerminal ? "generating" : anyError ? "error" : "ready";
  await db.from("creative_series").update({ status: nextStatus }).eq("id", seriesId);
}

const STALE_GENERATING_THRESHOLD_MS = 5 * 60 * 1000; // 5min -- generoso vs. orçamento real de geração (~58s, Prompt 11/16), nunca curto demais.

/**
 * Fase "STALE GENERATING"/"RECOVERY POLICY" -- reconcilia items presos
 * em "generating" há mais de STALE_GENERATING_THRESHOLD_MS (browser
 * fechou, deployment mudou, processo morreu) pra "error" -- nunca
 * re-dispara geração sozinho, nunca cobra uma nova chamada em
 * silêncio. Chamado na hidratação (GET), nunca num cron/job que não
 * existe nesta arquitetura.
 */
export async function reconcileStaleGeneratingItems(db: SupabaseClient, seriesId: string): Promise<void> {
  const threshold = new Date(Date.now() - STALE_GENERATING_THRESHOLD_MS).toISOString();
  await db
    .from("creative_series_items")
    .update({ status: "error", generation_metadata: { error: "Execução interrompida (sem resposta dentro do tempo esperado)." } })
    .eq("series_id", seriesId)
    .eq("status", "generating")
    .lt("updated_at", threshold);
}
