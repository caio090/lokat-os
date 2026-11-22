import { NextRequest, NextResponse } from "next/server";
import { resolveMetaApiVersion } from "@/lib/meta/graph-version";
import {
  createServerSupabaseClient,
  createSupabaseAdminClient,
  hasSupabaseServiceRoleKey,
} from "@/lib/supabase/server";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "operacional", "agency", "team"]);
const API_VERSION = resolveMetaApiVersion();
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── Utilitários de data ────────────────────────────────────────────────────────

function toUnix(d: Date) { return Math.floor(d.getTime() / 1000); }

function periodToRange(
  period: string,
  startDate: string | null,
  endDate: string | null,
): { since: number; until: number } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "custom" && startDate && endDate) {
    const s = new Date(startDate + "T00:00:00");
    const e = new Date(endDate   + "T23:59:59");
    return { since: toUnix(s), until: toUnix(e) };
  }
  if (period === "current_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    // Meta enforces a 30-day maximum window; cap since to today-29 for months with 31 days
    const minSince = new Date(today);
    minSince.setDate(minSince.getDate() - 29);
    const effectiveSince = start >= minSince ? start : minSince;
    return { since: toUnix(effectiveSince), until: toUnix(new Date(today.setHours(23, 59, 59))) };
  }
  const days = period === "15d" ? 15 : period === "30d" ? 30 : 7;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { since: toUnix(start), until: toUnix(new Date(today.setHours(23, 59, 59))) };
}

// ── Classificador de erros Meta ────────────────────────────────────────────────

interface MetaGraphError {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

function classifyMetaError(
  graphErr: MetaGraphError,
  endpoint: string,
  metricAttempted: string,
): {
  ok: false;
  provider: "meta";
  reason: string;
  httpStatus: number;
  graphErrorCode: number | null;
  graphErrorSubcode: number | null;
  graphErrorMessage: string;
  endpoint: string;
  metricAttempted: string;
  missingPermissionsLikely: string[];
  safeMessage: string;
} {
  const code    = graphErr.code    ?? null;
  const subcode = graphErr.error_subcode ?? null;
  const msg     = graphErr.message ?? "";

  let reason = "unknown_meta_error";
  let httpStatus = 400;
  let missing: string[] = [];
  let safeMessage = "Erro desconhecido da Meta.";

  if (code === 190) {
    reason      = "token_expired_or_invalid";
    httpStatus  = 401;
    safeMessage = "Token Meta expirado ou inválido. Reconecte a conta em /admin/conexoes.";
  } else if (code === 10) {
    reason      = "permission_missing";
    httpStatus  = 403;
    missing     = ["instagram_manage_insights", "pages_read_engagement"];
    safeMessage = "Permissão ausente no App Meta. O escopo instagram_manage_insights ou pages_read_engagement não foi concedido.";
  } else if (code === 200) {
    reason      = "permission_error";
    httpStatus  = 403;
    missing     = ["instagram_manage_insights"];
    safeMessage = "Erro de permissão Meta. Reconecte e aceite os escopos de insights.";
  } else if (code === 100) {
    reason      = "invalid_parameter_or_metric";
    httpStatus  = 400;
    safeMessage = `Parâmetro ou métrica inválida: ${msg}. Verifique a versão da API e os campos solicitados.`;
  } else if (code === 4 || code === 17 || code === 32) {
    reason      = "rate_limit_or_throttle";
    httpStatus  = 429;
    safeMessage = "Limite de requisições da Meta atingido. Aguarde alguns minutos e tente novamente.";
  } else if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("unsupported")) {
    reason      = "endpoint_or_asset_invalid";
    httpStatus  = 404;
    safeMessage = `Endpoint ou ativo não encontrado na Meta: ${msg}`;
  }

  return {
    ok: false,
    provider: "meta",
    reason,
    httpStatus,
    graphErrorCode: code,
    graphErrorSubcode: subcode,
    graphErrorMessage: msg,
    endpoint,
    metricAttempted,
    missingPermissionsLikely: missing,
    safeMessage,
  };
}

// ── Fetch Graph API seguro ────────────────────────────────────────────────────

async function graphGet(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<{ data?: unknown; error?: MetaGraphError }> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  try {
    const res  = await fetch(url.toString(), { cache: "no-store" });
    const json = await res.json() as { data?: unknown; error?: MetaGraphError };
    return json;
  } catch (e) {
    return { error: { message: String(e), code: 0 } };
  }
}

// ── Agregar valores diários ───────────────────────────────────────────────────

interface InsightValue { value: number; end_time: string }
interface InsightMetric {
  name: string;
  values?: InsightValue[];
  total_value?: { value: number };
}

function sumMetric(metric: InsightMetric): number {
  // metric_type=total_value returns a single aggregated value instead of time-series
  if (metric.total_value !== undefined) return metric.total_value.value ?? 0;
  return (metric.values ?? []).reduce((acc, v) => acc + (v.value ?? 0), 0);
}

// ── Advanced audience insights ────────────────────────────────────────────────

interface AdvancedMetricItem { label: string; value: number }

interface BreakdownMetric {
  name: string;
  total_value?: {
    breakdowns?: Array<{
      results?: Array<{ dimension_values?: string[]; value?: number }>;
    }>;
  };
}

interface OnlineFollowersMetric {
  name: string;
  values?: Array<{ value?: Record<string, number> }>;
}

function normalizeBreakdown(data: unknown[], metricName: string): AdvancedMetricItem[] {
  const metric = (data as BreakdownMetric[]).find((m) => m.name === metricName);
  if (!metric?.total_value?.breakdowns) return [];
  const items: AdvancedMetricItem[] = [];
  for (const bd of metric.total_value.breakdowns) {
    for (const r of bd.results ?? []) {
      items.push({ label: (r.dimension_values ?? []).join(" · "), value: r.value ?? 0 });
    }
  }
  return items.sort((a, b) => b.value - a.value);
}

async function fetchAdvancedInsights(igId: string, token: string): Promise<{
  demographics?: { gender?: AdvancedMetricItem[]; age?: AdvancedMetricItem[] };
  locations?: { cities?: AdvancedMetricItem[]; countries?: AdvancedMetricItem[] };
  activity?: { onlineFollowersByHour?: AdvancedMetricItem[] };
  unavailable?: string[];
}> {
  const unavailable: string[] = [];

  // Demographics + Locations (isolated)
  let demographics: { gender?: AdvancedMetricItem[]; age?: AdvancedMetricItem[] } | undefined;
  let locations: { cities?: AdvancedMetricItem[]; countries?: AdvancedMetricItem[] } | undefined;
  try {
    const res = await graphGet(`${igId}/insights`, token, {
      metric:      "audience_gender_age,audience_city,audience_country",
      period:      "lifetime",
      metric_type: "total_value",
    });
    if (!res.error && Array.isArray(res.data)) {
      const data = res.data as unknown[];
      const genderAgeRaw = normalizeBreakdown(data, "audience_gender_age");
      const genderTotals: Record<string, number> = {};
      const ageTotals:    Record<string, number> = {};
      for (const item of genderAgeRaw) {
        const parts  = item.label.split(" · ");
        const gender = parts[0];
        const age    = parts[1];
        if (gender) genderTotals[gender] = (genderTotals[gender] ?? 0) + item.value;
        if (age)    ageTotals[age]       = (ageTotals[age]       ?? 0) + item.value;
      }
      demographics = {
        gender: Object.entries(genderTotals).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
        age:    Object.entries(ageTotals).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      };
      locations = {
        cities:    normalizeBreakdown(data, "audience_city").slice(0, 5),
        countries: normalizeBreakdown(data, "audience_country").slice(0, 5),
      };
    } else {
      unavailable.push("demographics", "locations");
    }
  } catch {
    unavailable.push("demographics", "locations");
  }

  // Activity — online followers by hour (isolated)
  let activity: { onlineFollowersByHour?: AdvancedMetricItem[] } | undefined;
  try {
    const res = await graphGet(`${igId}/insights`, token, {
      metric: "online_followers",
      period: "lifetime",
    });
    if (!res.error && Array.isArray(res.data)) {
      const data    = res.data as OnlineFollowersMetric[];
      const ofMetric = data.find((m) => m.name === "online_followers");
      if (ofMetric?.values?.length) {
        const totals: Record<string, number> = {};
        const counts: Record<string, number> = {};
        for (const day of ofMetric.values) {
          for (const [h, count] of Object.entries(day.value ?? {})) {
            totals[h] = (totals[h] ?? 0) + count;
            counts[h] = (counts[h] ?? 0) + 1;
          }
        }
        const hourly = Object.entries(totals)
          .map(([h, total]) => ({ label: `${h.padStart(2, "0")}:00`, value: Math.round(total / (counts[h] ?? 1)) }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8);
        if (hourly.length > 0) activity = { onlineFollowersByHour: hourly };
        else unavailable.push("activity");
      } else { unavailable.push("activity"); }
    } else { unavailable.push("activity"); }
  } catch {
    unavailable.push("activity");
  }

  return { demographics, locations, activity, ...(unavailable.length ? { unavailable } : {}) };
}

// ── Handler principal ─────────────────────────────────────────────────────────

// GET /api/meta/insights?client_id=<uuid>&period=7d|15d|30d|current_month|custom&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId  = searchParams.get("client_id");
  const period    = searchParams.get("period")     ?? "7d";
  const startDate = searchParams.get("start_date") ?? null;
  const endDate   = searchParams.get("end_date")   ?? null;

  if (!clientId) {
    return NextResponse.json(
      { ok: false, reason: "missing_client_id" },
      { status: 400 }
    );
  }

  // Autenticação
  let userId: string | null = null;
  let userRole: string | null = null;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> | null = null;

  try {
    supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles").select("role").eq("id", userId).maybeSingle();
      userRole = profile?.role ?? null;
    }
  } catch { userId = null; }

  if (!userId || !supabase) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }
  if (!userRole || !ALLOWED_ROLES.has(userRole)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = supabase;
  if (hasSupabaseServiceRoleKey()) {
    try { db = createSupabaseAdminClient(); } catch { /* usa session */ }
  }

  // Busca ativo principal do cliente
  const { data: assetRows, error: assetErr } = await db
    .from("client_meta_assets")
    .select("asset_type, asset_id, username, asset_name, meta_connection_id")
    .eq("client_id", clientId)
    .order("is_primary", { ascending: false });

  if (assetErr?.code === "42P01") {
    return NextResponse.json({
      ok: false,
      reason: "sql_pending",
      message: "Rode o SQL 37 e SQL 62 no Supabase.",
    });
  }

  const assets = (assetRows ?? []) as Array<{
    asset_type: string; asset_id: string;
    username: string | null; asset_name: string | null;
    meta_connection_id: string | null;
  }>;

  const primaryAsset =
    assets.find((a) => a.asset_type === "instagram_business") ??
    assets.find((a) => a.asset_type === "facebook_page") ??
    assets[0] ?? null;

  if (!primaryAsset) {
    return NextResponse.json({
      ok: false,
      reason: "no_linked_asset",
      message: "Nenhum ativo Meta vinculado a este cliente.",
    });
  }

  if (!primaryAsset.meta_connection_id) {
    return NextResponse.json({
      ok: false,
      reason: "no_connection_id",
      message: "Ativo Meta sem conexão associada. Re-vincule em /admin/conexoes.",
    });
  }

  // Busca token (server-side, nunca exposto)
  const { data: connRow, error: connErr } = await db
    .from("meta_connections")
    .select("access_token, status, token_expires_at, scopes")
    .eq("id", primaryAsset.meta_connection_id)
    .maybeSingle();

  if (connErr?.code === "42P01") {
    return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 35." });
  }
  if (!connRow) {
    return NextResponse.json({ ok: false, reason: "connection_not_found" });
  }
  if (connRow.status !== "active") {
    return NextResponse.json({
      ok: false, reason: "connection_not_active",
      message: `Conexão Meta com status '${connRow.status}'. Reconecte em /admin/conexoes.`,
    });
  }
  if (connRow.token_expires_at && new Date(connRow.token_expires_at) < new Date()) {
    return NextResponse.json({
      ok: false, reason: "token_expired",
      message: "Token Meta expirado. Reconecte a conta.",
    });
  }

  const token: string = connRow.access_token;
  if (!token) {
    return NextResponse.json({ ok: false, reason: "no_access_token" });
  }

  const { since, until } = periodToRange(period, startDate, endDate);

  // ── Instagram Business insights ────────────────────────────────────────────
  if (primaryAsset.asset_type === "instagram_business") {
    const igId = primaryAsset.asset_id;

    // Métricas de conta — metric_type=total_value exigido pela Graph API v17+
    const IG_ACCOUNT_METRICS = "reach,profile_views,website_clicks,views";
    const [accountInsights, accountInfo] = await Promise.all([
      graphGet(`${igId}/insights`, token, {
        metric:      IG_ACCOUNT_METRICS,
        period:      "day",
        since:       String(since),
        until:       String(until),
        metric_type: "total_value",
      }),
      graphGet(igId, token, {
        fields: "followers_count,username,name",
      }),
    ]);

    if (accountInsights.error) {
      const classified = classifyMetaError(
        accountInsights.error,
        `${igId}/insights`,
        IG_ACCOUNT_METRICS,
      );
      return NextResponse.json(classified, { status: classified.httpStatus });
    }

    const metricsData = (accountInsights.data as InsightMetric[] | undefined) ?? [];
    const metrics: Record<string, number | null> = {};

    for (const m of metricsData) {
      metrics[m.name] = sumMetric(m);
    }

    // follower_count vem da conta, não de insights
    const igInfo = accountInfo.data as { followers_count?: number; username?: string; name?: string } | undefined;
    const followerCount = igInfo?.followers_count ?? null;

    const availableMetrics: string[] = [];
    const unavailableMetrics: string[] = [];

    const EXPECTED = ["reach", "profile_views", "website_clicks", "views"];
    for (const m of EXPECTED) {
      if (metrics[m] !== undefined && metrics[m] !== null) {
        availableMetrics.push(m);
      } else {
        unavailableMetrics.push(m);
      }
    }
    if (followerCount !== null) availableMetrics.push("followers_count");

    const advanced = await fetchAdvancedInsights(igId, token);

    return NextResponse.json({
      ok: true,
      provider: "meta",
      assetType: "instagram_business",
      assetId: igId,
      username: igInfo?.username ?? primaryAsset.username,
      period,
      since,
      until,
      metrics: {
        reach:           metrics["reach"]          ?? null,
        views:           metrics["views"]           ?? null,
        profile_views:   metrics["profile_views"]  ?? null,
        website_clicks:  metrics["website_clicks"] ?? null,
        followers_count: followerCount,
      },
      availableMetrics,
      unavailableMetrics: unavailableMetrics.map((m) => ({
        metric: m,
        metricUnavailable: true,
        reason: "not_returned_by_meta",
      })),
      endpoint: `${GRAPH_BASE}/${igId}/insights`,
      advanced,
    });
  }

  // ── Facebook Page insights ─────────────────────────────────────────────────
  if (primaryAsset.asset_type === "facebook_page") {
    const pageId = primaryAsset.asset_id;
    const FB_PAGE_METRICS = "page_impressions,page_reach";

    const pageInsights = await graphGet(`${pageId}/insights`, token, {
      metric: FB_PAGE_METRICS,
      period: "day",
      since:  String(since),
      until:  String(until),
    });

    if (pageInsights.error) {
      const classified = classifyMetaError(
        pageInsights.error,
        `${pageId}/insights`,
        FB_PAGE_METRICS,
      );
      return NextResponse.json(classified, { status: classified.httpStatus });
    }

    const metricsData = (pageInsights.data as InsightMetric[] | undefined) ?? [];
    const metrics: Record<string, number | null> = {};
    for (const m of metricsData) {
      metrics[m.name] = sumMetric(m);
    }

    const EXPECTED = ["page_impressions", "page_reach"];
    const availableMetrics   = EXPECTED.filter((m) => metrics[m] !== undefined);
    const unavailableMetrics = EXPECTED.filter((m) => metrics[m] === undefined);

    return NextResponse.json({
      ok: true,
      provider: "meta",
      assetType: "facebook_page",
      assetId: pageId,
      assetName: primaryAsset.asset_name,
      period,
      since,
      until,
      metrics: {
        page_impressions: metrics["page_impressions"] ?? null,
        page_reach:       metrics["page_reach"]       ?? null,
      },
      availableMetrics,
      unavailableMetrics: unavailableMetrics.map((m) => ({
        metric: m,
        metricUnavailable: true,
        reason: "not_returned_by_meta",
      })),
      endpoint: `${GRAPH_BASE}/${pageId}/insights`,
    });
  }

  return NextResponse.json({
    ok: false,
    reason: "unsupported_asset_type",
    assetType: primaryAsset.asset_type,
    message: "Tipo de ativo Meta não suportado para insights.",
  });
}
