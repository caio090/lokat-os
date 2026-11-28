import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { getAdAccountMeta, listCampaigns, fetchCampaignPeriodMetrics, MetaApiError } from "@/lib/meta/marketing-api";
import { resolveMetaApiVersion } from "@/lib/meta/graph-version";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "operacional", "agency", "team"]);
const AD_READ_SCOPES = ["ads_read", "ads_management"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeAccountId(raw: string): string {
  return raw.replace(/^act_/, "").trim();
}

// GET /api/meta/campaigns?client_id=<uuid>&ad_account_id=<digits|act_digits>&since=YYYY-MM-DD&until=YYYY-MM-DD
//
// PROMPT LKT 16: "leitura de campanhas" nunca existia em nenhuma rota --
// listAdAccounts (ver /api/meta/ad-accounts) só dava nome da conta, nunca
// campanha nem métrica. Esta rota é a implementação real pedida.
//
// Isolamento por cliente: a conta de anúncio só é aceita se já estiver
// vinculada a ESTE client_id em client_meta_assets (asset_type='ad_account')
// -- nunca aceita qualquer conta acessível pela conexão, mesmo que o caller
// tenha acesso a ela via Graph API. Isso é mais estrito que /api/meta/ad-accounts
// (que lista todas as contas da conexão) de propósito: aqui é leitura por
// CLIENTE, não um inventário geral.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId        = searchParams.get("client_id")?.trim() || null;
  const rawAdAccountId   = searchParams.get("ad_account_id")?.trim() || null;
  const since            = searchParams.get("since")?.trim() || null;
  const until             = searchParams.get("until")?.trim() || null;

  if (!clientId || !rawAdAccountId || !since || !until) {
    return NextResponse.json({
      ok: false, reason: "missing_params",
      message: "client_id, ad_account_id, since e until são obrigatórios.",
    }, { status: 400 });
  }
  if (!DATE_RE.test(since) || !DATE_RE.test(until) || since > until) {
    return NextResponse.json({
      ok: false, reason: "invalid_period",
      message: "Período inválido. Use since/until no formato YYYY-MM-DD, com since ≤ until.",
    }, { status: 400 });
  }

  const adAccountId = normalizeAccountId(rawAdAccountId);

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

  // Isolamento real entre clientes: can_access_client (RPC canônica), nunca
  // "está logado com papel X" como autorização implícita para QUALQUER cliente.
  const { data: canAccess, error: canAccessErr } = await supabase.rpc("can_access_client", { target_client_id: clientId });
  if (canAccessErr) {
    return NextResponse.json({ ok: false, reason: "db_error", message: canAccessErr.message }, { status: 500 });
  }
  if (!canAccess) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = supabase;
  if (hasSupabaseServiceRoleKey()) {
    try { db = createSupabaseAdminClient(); } catch { /* usa session */ }
  }

  // A conta precisa estar EXPLICITAMENTE vinculada a este cliente -- nunca
  // "qualquer conta que a conexão acessa".
  const { data: linkRow, error: linkErr } = await db
    .from("client_meta_assets")
    .select("meta_connection_id, asset_id, asset_name")
    .eq("client_id", clientId)
    .eq("asset_type", "ad_account")
    .eq("asset_id", adAccountId)
    .maybeSingle();

  if (linkErr?.code === "42P01") {
    return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 37 no Supabase." });
  }
  if (linkErr) {
    return NextResponse.json({ ok: false, reason: "db_error", message: linkErr.message }, { status: 500 });
  }
  if (!linkRow) {
    return NextResponse.json({
      ok: false, reason: "ad_account_not_linked",
      message: "Esta conta de anúncio não está vinculada a este cliente. Vincule em /admin/conexoes antes de consultar campanhas.",
    }, { status: 404 });
  }
  if (!linkRow.meta_connection_id) {
    return NextResponse.json({
      ok: false, reason: "no_connection_id",
      message: "Vínculo sem conexão Meta associada. Re-vincule em /admin/conexoes.",
    });
  }

  const { data: connRow, error: connErr } = await db
    .from("meta_connections")
    .select("access_token, status, token_expires_at, scopes")
    .eq("id", linkRow.meta_connection_id)
    .maybeSingle();

  if (connErr?.code === "42P01") {
    return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 35 no Supabase." });
  }
  if (!connRow) {
    return NextResponse.json({ ok: false, reason: "connection_not_found", message: "Conexão Meta do vínculo não foi encontrada." }, { status: 404 });
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
      message: "Token Meta expirado. Reconecte a conta em /admin/conexoes.",
    });
  }

  const scopes = (connRow.scopes ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!AD_READ_SCOPES.some((s) => scopes.includes(s))) {
    return NextResponse.json({
      ok: false, reason: "ads_scope_not_granted",
      message: "A conexão vinculada não tem permissão de leitura de anúncios (ads_read). Reconecte a Meta pedindo esse escopo.",
    });
  }

  const token: string = connRow.access_token;
  if (!token) {
    return NextResponse.json({ ok: false, reason: "no_access_token" }, { status: 500 });
  }

  const queriedAt = new Date().toISOString();

  try {
    const [accountMeta, campaigns, periodMetrics] = await Promise.all([
      getAdAccountMeta(adAccountId, token),
      listCampaigns(adAccountId, token),
      fetchCampaignPeriodMetrics(adAccountId, since, until, token),
    ]);

    const metricsByCampaign = new Map(periodMetrics.map((m) => [m.campaignId, m]));

    const rows = campaigns.map((c) => {
      const m = metricsByCampaign.get(c.id);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        effectiveStatus: c.effectiveStatus,
        objective: c.objective,
        hasData: !!m,
        metrics: m ? {
          spend: m.spend,
          impressions: m.impressions,
          reach: m.reach,
          clicks: m.clicks,
          linkClicks: m.linkClicks,
          ctr: m.ctr,
          currency: m.currency ?? accountMeta.currency,
          actions: m.actions,
          costPerActionType: m.costPerActionType,
        } : null,
      };
    });

    return NextResponse.json({
      ok: true,
      client_id: clientId,
      ad_account_id: adAccountId,
      ad_account_label: linkRow.asset_name ?? accountMeta.name,
      account: {
        name: accountMeta.name,
        currency: accountMeta.currency,
        timezoneName: accountMeta.timezoneName,
      },
      period: { since, until },
      attributionSetting: "unificada_por_conjunto",
      source: `graph_api_${resolveMetaApiVersion()}`,
      queriedAt,
      campaigns: rows,
      total: rows.length,
    });
  } catch (e) {
    if (e instanceof MetaApiError) {
      const message =
        e.kind === "token_invalido" ? "Token Meta expirado ou inválido. Reconecte a conta em /admin/conexoes."
        : e.kind === "sem_permissao" ? "Permissão de anúncios recusada pela Meta para esta conta. Pode exigir Revisão do App (Advanced Access para ads_read)."
        : e.kind === "limite" ? "Limite de requisições da Meta atingido. Aguarde alguns minutos e tente novamente."
        : e.kind === "parametro_invalido" ? `Parâmetro inválido: ${e.message}`
        : `Erro ao consultar campanhas: ${e.message}`;
      return NextResponse.json({ ok: false, reason: e.kind, message, graphErrorCode: e.code });
    }
    return NextResponse.json({ ok: false, reason: "fetch_error", message: "Erro de rede ao consultar a Graph API." });
  }
}
