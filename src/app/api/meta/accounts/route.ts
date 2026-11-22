import { NextRequest, NextResponse } from "next/server";
import { resolveMetaApiVersion } from "@/lib/meta/graph-version";
import { createServerSupabaseClient, createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";

// GET /api/meta/accounts?connection_id=<uuid>
//
// Busca ativos Meta (páginas FB + Instagram Business) de uma conexão específica.
// Nunca expõe access_token ao front-end.
//
// Se connection_id não for fornecido:
//   - 1 conexão disponível: auto-seleciona
//   - >1 conexões: retorna connection_selection_required
//   - 0 conexões: retorna not_connected
export async function GET(request: NextRequest) {
  const apiVersion = resolveMetaApiVersion();
  const { searchParams } = new URL(request.url);
  const requestedConnectionId = searchParams.get("connection_id")?.trim() || null;

  // ── 1. Sessão ──────────────────────────────────────────────────────────
  let userId: string | null = null;
  let userRole: string | null = null;
  try {
    const supabase = await createServerSupabaseClient();
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

  const ALLOWED_ROLES = new Set(["admin", "super_admin", "agency", "operacional", "team"]);
  if (!userRole || !ALLOWED_ROLES.has(userRole)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  const isBroadAccess = userRole === "super_admin" || userRole === "admin";

  // ── 2. Admin DB para leitura de tokens (bypassa RLS) ──────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  if (hasSupabaseServiceRoleKey()) {
    try { db = createSupabaseAdminClient(); } catch { db = await createServerSupabaseClient(); }
  } else {
    db = await createServerSupabaseClient();
  }

  // ── 3. Resolver qual conexão usar ─────────────────────────────────────
  let accessToken: string | null = null;
  let connectionId: string | null = null;

  if (requestedConnectionId) {
    // Valida acesso à conexão específica
    let connQuery = db
      .from("meta_connections")
      .select("id, access_token, status")
      .eq("id", requestedConnectionId)
      .eq("status", "active")
      .maybeSingle();

    if (!isBroadAccess) {
      // Não-admin: só pode usar conexões próprias
      connQuery = db
        .from("meta_connections")
        .select("id, access_token, status")
        .eq("id", requestedConnectionId)
        .eq("connected_by", userId)
        .eq("status", "active")
        .maybeSingle();
    }

    const { data: conn, error } = await connQuery;

    if (error?.code === "42P01") {
      return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 35 no Supabase." });
    }
    if (error) {
      return NextResponse.json({ ok: false, reason: "db_error" }, { status: 500 });
    }
    if (!conn) {
      return NextResponse.json({
        ok: false, reason: "connection_not_found",
        message: "Conexão não encontrada ou sem permissão de acesso.",
      }, { status: 404 });
    }

    accessToken  = conn.access_token as string;
    connectionId = conn.id as string;
  } else {
    // Sem connection_id: descobre conexões disponíveis
    let listQuery = db
      .from("meta_connections")
      .select("id, access_token")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (!isBroadAccess) {
      listQuery = listQuery.eq("connected_by", userId);
    }

    const { data: conns, error } = await listQuery;

    if (error?.code === "42P01") {
      return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 35 no Supabase." });
    }
    if (error) {
      return NextResponse.json({ ok: false, reason: "db_error" }, { status: 500 });
    }

    const list = (conns ?? []) as Array<{ id: string; access_token: string }>;

    if (list.length === 0) {
      return NextResponse.json({ ok: false, reason: "not_connected", message: "Nenhuma conexão Meta ativa." });
    }

    if (list.length > 1) {
      // Mais de uma conexão disponível — front deve selecionar explicitamente
      return NextResponse.json({
        ok:     false,
        reason: "connection_selection_required",
        message: "Há mais de uma conta Meta disponível. Selecione a conexão desejada.",
        connection_count: list.length,
      });
    }

    // Exatamente uma conexão — auto-seleciona (compatibilidade)
    accessToken  = list[0].access_token;
    connectionId = list[0].id;
  }

  if (!accessToken) {
    return NextResponse.json({ ok: false, reason: "no_token", message: "Token não encontrado. Reconecte a conta Meta." });
  }

  // ── 4. Consulta Graph API (server-side) ───────────────────────────────
  try {
    const pagesRes = await fetch(
      `https://graph.facebook.com/${apiVersion}/me/accounts?fields=id,name,picture{url},instagram_business_account{id,name,username,profile_picture_url}&access_token=${accessToken}`
    );
    const pagesData = await pagesRes.json() as {
      data?: Array<{
        id: string;
        name: string;
        picture?: { data?: { url?: string } };
        instagram_business_account?: {
          id: string; name?: string; username?: string; profile_picture_url?: string;
        };
      }>;
      error?: { message: string; code: number };
    };

    if (pagesData.error) {
      return NextResponse.json({
        ok: false, reason: "graph_error",
        message: "Erro ao consultar a API da Meta. O token pode ter expirado.",
        connection_id: connectionId,
      });
    }

    const pages = (pagesData.data ?? []).map((p) => ({
      id:          p.id,
      name:        p.name,
      picture_url: p.picture?.data?.url ?? null,
      instagram:   p.instagram_business_account
        ? {
            id:          p.instagram_business_account.id,
            name:        p.instagram_business_account.name    ?? null,
            username:    p.instagram_business_account.username ?? null,
            picture_url: p.instagram_business_account.profile_picture_url ?? null,
          }
        : null,
    }));

    const instagramAccounts = pages.filter((p) => p.instagram !== null).map((p) => p.instagram!);

    return NextResponse.json({
      ok:               true,
      connection_id:    connectionId,
      pages,
      instagram_accounts: instagramAccounts,
      total_pages:      pages.length,
      total_instagram:  instagramAccounts.length,
    });
  } catch {
    return NextResponse.json({
      ok: false, reason: "fetch_error",
      message: "Erro de rede ao consultar Graph API da Meta.",
    });
  }
}
