/**
 * Marketing API da Meta — LEITURA de contas de anúncio e Insights, e
 * montagem de RASCUNHO de criação (sem envio). Somente servidor.
 *
 * Referências oficiais (conferidas em 2026-11-22):
 *  - Insights: developers.facebook.com/docs/marketing-api/insights
 *  - Permissões: ads_read (relatórios) / ads_management (criar/editar);
 *    contas de terceiros exigem Advanced Access (Revisão do App).
 *    developers.facebook.com/docs/marketing-api/get-started/authorization
 *  - Versão corrente: v26.0 (ver graph-version.ts).
 *
 * Decisões:
 *  - Paginação por cursor seguindo `paging.next` até o fim ou maxPages.
 *  - Limite de requisições (códigos 4, 17, 32, 613, 80000–80014) e erros
 *    transitórios (1, 2, HTTP 5xx): nova tentativa com espera exponencial.
 *  - Token inválido/expirado (190) ou permissão (10, 200–299): não repete;
 *    devolve tipo de erro para a UI pedir reconexão/permissão.
 *  - Insights diários com time_increment=1: as datas vêm no FUSO DA CONTA
 *    e os valores na MOEDA DA CONTA — os dois são gravados junto.
 *  - Atribuição: use_unified_attribution_setting=true (respeita a
 *    configuração de cada conjunto, como o Gerenciador de Anúncios). O
 *    rótulo é gravado em attribution_setting para nunca misturar janelas.
 *  - Nenhuma função aqui faz POST na Meta. Publicação real fica em rota
 *    própria de servidor, depois de aprovação (ver marketing-ops/workflow.ts).
 */
import { resolveMetaApiVersion } from "./graph-version";
import type { PerformanceDaily } from "@/lib/marketing-ops/types";
import { PLATFORM_STATUS_ON_PUBLISH } from "@/lib/marketing-ops/workflow";

export type MetaErrorKind = "token_invalido" | "sem_permissao" | "limite" | "parametro_invalido" | "transitorio" | "desconhecido";

export class MetaApiError extends Error {
  kind: MetaErrorKind;
  code: number | null;
  subcode: number | null;
  constructor(kind: MetaErrorKind, code: number | null, subcode: number | null, message: string) {
    super(message);
    this.name = "MetaApiError";
    this.kind = kind;
    this.code = code;
    this.subcode = subcode;
  }
}

export function classifyMetaError(code: number | null, httpStatus: number): MetaErrorKind {
  if (code === 190 || code === 102) return "token_invalido";
  if (code === 10 || (code != null && code >= 200 && code <= 299)) return "sem_permissao";
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code != null && code >= 80000 && code <= 80014)) return "limite";
  if (code === 100) return "parametro_invalido";
  if (code === 1 || code === 2 || httpStatus >= 500) return "transitorio";
  return "desconhecido";
}

type FetchLike = (url: string) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface GraphOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  maxPages?: number;
  version?: string;
}

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string };
  error?: { message?: string; code?: number; error_subcode?: number };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getJson<T>(url: string, opts: Required<Pick<GraphOptions, "fetchImpl" | "sleep" | "maxRetries">>): Promise<GraphPage<T>> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let body: GraphPage<T>;
    try {
      const res = await opts.fetchImpl(url);
      status = res.status;
      body = (await res.json()) as GraphPage<T>;
    } catch {
      body = { error: { message: "Falha de rede", code: 2 } };
    }
    if (!body.error && status < 500) return body;
    const code = body.error?.code ?? null;
    const kind = classifyMetaError(code, status);
    if ((kind === "limite" || kind === "transitorio") && attempt < opts.maxRetries) {
      await opts.sleep(Math.min(60_000, 1000 * 2 ** attempt));
      continue;
    }
    // Nunca incluir a URL (tem o token) na mensagem.
    throw new MetaApiError(kind, code, body.error?.error_subcode ?? null, body.error?.message ?? `HTTP ${status}`);
  }
}

/** GET paginado. `path` sem barra inicial; `params` sem access_token. */
export async function graphGetAll<T>(path: string, params: Record<string, string>, token: string, options: GraphOptions = {}): Promise<T[]> {
  const opts = { fetchImpl: options.fetchImpl ?? (fetch as unknown as FetchLike), sleep: options.sleep ?? defaultSleep, maxRetries: options.maxRetries ?? 4 };
  const maxPages = options.maxPages ?? 50;
  const url = new URL(`https://graph.facebook.com/${options.version ?? resolveMetaApiVersion()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);

  const out: T[] = [];
  let next: string | undefined = url.toString();
  for (let page = 0; next && page < maxPages; page++) {
    const body: GraphPage<T> = await getJson<T>(next, opts);
    out.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  if (next) throw new MetaApiError("parametro_invalido", null, null, `Mais de ${maxPages} páginas: reduza o período ou o nível.`);
  return out;
}

export interface AdAccountSummary {
  accountId: string;
  name: string | null;
  currency: string | null;
  timezoneName: string | null;
  accountStatus: number | null;
}

export async function listAdAccounts(token: string, options?: GraphOptions): Promise<AdAccountSummary[]> {
  const rows = await graphGetAll<Record<string, unknown>>("me/adaccounts", {
    fields: "account_id,name,currency,timezone_name,account_status",
    limit: "100",
  }, token, options);
  return rows.map((r) => ({
    accountId: String(r.account_id ?? ""),
    name: typeof r.name === "string" ? r.name : null,
    currency: typeof r.currency === "string" ? r.currency : null,
    timezoneName: typeof r.timezone_name === "string" ? r.timezone_name : null,
    accountStatus: typeof r.account_status === "number" ? r.account_status : null,
  }));
}

export interface InsightsRequest {
  accountId: string;
  level: "account" | "campaign" | "adset" | "ad";
  /** YYYY-MM-DD no fuso da conta. */
  since: string;
  until: string;
  clientId: string;
  accountTimezone: string;
  accountCurrency: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): number => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0; return Number.isFinite(n) ? n : 0; };
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v));
const actionList = (v: unknown) => (Array.isArray(v) ? v.filter((a) => a && typeof a.action_type === "string").map((a) => ({ action_type: String(a.action_type), value: String(a.value ?? "0") })) : []);

export const ATTRIBUTION_LABEL = "unificada_por_conjunto";

export function normalizeInsightRow(row: Record<string, unknown>, req: InsightsRequest): PerformanceDaily {
  const idField = req.level === "account" ? "account_id" : req.level === "adset" ? "adset_id" : `${req.level}_id`;
  const externalObjectId = String(row[idField] ?? req.accountId);
  return {
    clientId: req.clientId,
    platform: "meta",
    level: req.level,
    externalObjectId,
    date: String(row.date_start),
    accountTimezone: req.accountTimezone,
    currency: typeof row.account_currency === "string" ? row.account_currency : req.accountCurrency,
    attributionSetting: ATTRIBUTION_LABEL,
    spend: num(row.spend),
    impressions: num(row.impressions),
    reach: numOrNull(row.reach),
    clicks: num(row.clicks),
    linkClicks: numOrNull(row.inline_link_clicks),
    actions: actionList(row.actions),
    actionValues: actionList(row.action_values),
  };
}

export async function fetchDailyInsights(req: InsightsRequest, token: string, options?: GraphOptions): Promise<PerformanceDaily[]> {
  if (!DATE.test(req.since) || !DATE.test(req.until) || req.since > req.until) {
    throw new MetaApiError("parametro_invalido", null, null, "Período inválido (use YYYY-MM-DD, início ≤ fim).");
  }
  const account = req.accountId.startsWith("act_") ? req.accountId : `act_${req.accountId}`;
  const rows = await graphGetAll<Record<string, unknown>>(`${account}/insights`, {
    level: req.level,
    time_increment: "1",
    time_range: JSON.stringify({ since: req.since, until: req.until }),
    use_unified_attribution_setting: "true",
    fields: "account_id,account_currency,campaign_id,adset_id,ad_id,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values,date_start,date_stop",
    limit: "500",
  }, token, options);
  return rows.map((r) => normalizeInsightRow(r, req));
}

// ── Rascunho de criação (não envia nada) ─────────────────────────────────

export interface CampaignDraftInput {
  accountId: string;
  name: string;
  /** Objetivo ODAX da Meta, ex.: OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_SALES. */
  objective: string;
  specialAdCategories?: string[];
}

export interface DraftRequest {
  method: "POST";
  path: string;
  body: Record<string, string>;
  notice: string;
}

/**
 * Monta o corpo que a rota de publicação (futura, servidor) enviaria.
 * Status sempre PAUSED. Não existe parâmetro para mudar isso aqui: ativar
 * é outra operação, com autorização registrada (canActivateDelivery).
 */
export function buildCampaignDraftRequest(input: CampaignDraftInput): DraftRequest {
  if (!/^\d+$/.test(input.accountId.replace(/^act_/, ""))) throw new Error("accountId inválido");
  if (!input.name.trim()) throw new Error("nome obrigatório");
  if (!/^OUTCOME_[A-Z_]+$/.test(input.objective)) throw new Error("objetivo deve ser um OUTCOME_* da Meta");
  return {
    method: "POST",
    path: `act_${input.accountId.replace(/^act_/, "")}/campaigns`,
    body: {
      name: input.name.trim(),
      objective: input.objective,
      status: PLATFORM_STATUS_ON_PUBLISH,
      special_ad_categories: JSON.stringify(input.specialAdCategories ?? []),
    },
    notice: "Rascunho: nada foi enviado à Meta. Ao publicar, a campanha nasce PAUSADA e não gera gasto.",
  };
}
