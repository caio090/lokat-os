import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { listAdAccounts, MetaApiError } from "@/lib/meta/marketing-api";

const BROAD_ACCESS_ROLES = new Set(["admin", "super_admin"]);
const AD_READ_SCOPES = ["ads_read", "ads_management"];

// GET /api/meta/ad-accounts?connection_id=<uuid>
//
// Lê contas de anúncio reais via Graph API (listAdAccounts, já existia em
// src/lib/meta/marketing-api.ts mas nunca estava conectado a nenhuma rota
// -- "Conta de anúncios indisponível nesta versão" no painel era um texto
// fixo, não um estado real checado). Nunca expõe access_token.
//
// ads_read/ads_management NÃO fazem parte do escopo padrão pedido no OAuth
// (ver META_BASE_SCOPES em token-lifecycle.ts) -- são opt-in via
// META_OAUTH_EXTRA_SCOPES, pois a Meta trata como permissão avançada que
// precisa de Revisão do App para contas de terceiros. Por isso, antes de
// chamar a Graph API, esta rota checa se a conexão JÁ tem esse escopo
// concedido (coluna meta_connections.scopes) e, se não tiver, devolve uma
// instrução exata -- nunca um erro genérico de permissão.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedConnectionId = searchParams.get("connection_id")?.trim() || null;

  let userId: string | null = null;
  let userRole: string | null = null;
  const supabase = await createServerSupabaseClient();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles").select("role").eq("id", userId).maybeSingle();
      userRole = profile?.role ?? null;
    }
  } catch { userId = null; }

  if (!userId) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }
  const isBroadAccess = !!userRole && BROAD_ACCESS_ROLES.has(userRole);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = supabase;
  if (hasSupabaseServiceRoleKey()) {
    try { db = createSupabaseAdminClient(); } catch { /* usa session */ }
  }

  let connQuery = db
    .from("meta_connections")
    .select("id, access_token, scopes")
    .eq("status", "active");
  if (requestedConnectionId) {
    connQuery = connQuery.eq("id", requestedConnectionId);
    if (!isBroadAccess) connQuery = connQuery.eq("connected_by", userId);
    connQuery = connQuery.maybeSingle();
  } else {
    if (!isBroadAccess) connQuery = connQuery.eq("connected_by", userId);
    connQuery = connQuery.order("created_at", { ascending: false });
  }

  const { data: connResult, error: connErr } = await connQuery;
  if (connErr?.code === "42P01") {
    return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 35 no Supabase." });
  }

  type ConnRow = { id: string; access_token: string; scopes: string | null };
  const connRows: ConnRow[] = requestedConnectionId
    ? (connResult ? [connResult as ConnRow] : [])
    : ((connResult ?? []) as ConnRow[]);

  if (connRows.length === 0) {
    return NextResponse.json({ ok: false, reason: "not_connected", message: "Nenhuma conexão Meta ativa." });
  }
  if (!requestedConnectionId && connRows.length > 1) {
    return NextResponse.json({
      ok: false, reason: "connection_selection_required",
      message: "Há mais de uma conta Meta disponível. Selecione a conexão desejada.",
      connection_count: connRows.length,
    });
  }

  const conn = connRows[0];
  const scopes = (conn.scopes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const hasAdsScope = AD_READ_SCOPES.some((s) => scopes.includes(s));

  if (!hasAdsScope) {
    return NextResponse.json({
      ok: false,
      reason: "ads_scope_not_granted",
      connection_id: conn.id,
      message: "A conexão atual não tem permissão de leitura de anúncios (ads_read).",
      howToEnable: [
        "1. Na Vercel, vá em Project Settings → Environment Variables (ambiente Production) e crie META_OAUTH_EXTRA_SCOPES com o valor ads_read.",
        "2. Faça um redeploy (a variável só é lida na inicialização da função).",
        "3. Volte em /admin/conexoes e clique em \"Reconectar Meta\" -- isso reabre o diálogo OAuth já pedindo o novo escopo.",
        "4. Se a Meta recusar o escopo para contas de terceiros, pode ser necessário enviar ads_read para Revisão do App em developers.facebook.com (Advanced Access).",
      ],
    });
  }

  try {
    const accounts = await listAdAccounts(conn.access_token);
    return NextResponse.json({
      ok: true,
      connection_id: conn.id,
      accounts: accounts.map((a) => ({
        accountId: a.accountId,
        name: a.name,
        currency: a.currency,
        timezoneName: a.timezoneName,
        accountStatus: a.accountStatus,
      })),
      total: accounts.length,
    });
  } catch (e) {
    if (e instanceof MetaApiError) {
      return NextResponse.json({
        ok: false,
        reason: e.kind,
        message: e.kind === "token_invalido"
          ? "Token Meta expirado ou inválido. Reconecte a conta em /admin/conexoes."
          : e.kind === "sem_permissao"
            ? "Permissão de anúncios recusada pela Meta para esta conta. Pode exigir Revisão do App (Advanced Access para ads_read)."
            : `Erro ao consultar contas de anúncio: ${e.message}`,
        graphErrorCode: e.code,
      });
    }
    return NextResponse.json({ ok: false, reason: "fetch_error", message: "Erro de rede ao consultar a Graph API." });
  }
}
