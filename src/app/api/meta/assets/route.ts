import { NextResponse } from "next/server";
import { resolveMetaApiVersion } from "@/lib/meta/graph-version";
import { createServerSupabaseClient, createSupabaseAdminClient } from "@/lib/supabase/server";

// GET /api/meta/assets
// Lista ativos Meta da conta conectada + vínculo com clientes, se existir.
// Nunca expõe access_token.
export async function GET() {
  let userId: string | null = null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch { userId = null; }

  if (!userId) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  const apiVersion = resolveMetaApiVersion();
  // Token só é lido pelo servidor (service role), sempre filtrado pelo
  // usuário autenticado acima -- a coluna access_token não precisa ficar
  // legível pela sessão do navegador (ver docs/supabase/106).
  const supabase = await createServerSupabaseClient();
  let tokenDb: typeof supabase = supabase;
  try { tokenDb = createSupabaseAdminClient() as unknown as typeof supabase; } catch { /* usa session */ }

  // Busca token ativo
  const { data: conn, error: connError } = await tokenDb
    .from("meta_connections")
    .select("id, access_token")
    .eq("connected_by", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connError?.code === "42P01") {
    return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 35." });
  }
  if (!conn) {
    return NextResponse.json({ ok: false, reason: "not_connected", message: "Nenhuma conexão Meta ativa." });
  }

  const accessToken = conn.access_token as string;
  const connectionId = conn.id as string;

  // Busca páginas + Instagram via Graph API
  let pages: Array<{
    id: string; name: string; picture_url: string | null;
    instagram: { id: string; name: string | null; username: string | null; picture_url: string | null } | null;
  }> = [];

  try {
    const r = await fetch(
      `https://graph.facebook.com/${apiVersion}/me/accounts?fields=id,name,picture{url},instagram_business_account{id,name,username,profile_picture_url}&access_token=${accessToken}`
    );
    const d = await r.json() as { data?: Array<{ id: string; name: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; name?: string; username?: string; profile_picture_url?: string } }>; error?: { message: string } };
    if (!d.error) {
      pages = (d.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        picture_url: p.picture?.data?.url ?? null,
        instagram: p.instagram_business_account ? {
          id: p.instagram_business_account.id,
          name: p.instagram_business_account.name ?? null,
          username: p.instagram_business_account.username ?? null,
          picture_url: p.instagram_business_account.profile_picture_url ?? null,
        } : null,
      }));
    }
  } catch { /* continua com pages vazio */ }

  // Busca vínculos existentes na client_meta_assets
  // Usa admin client para bypassar RLS (policy de client_meta_assets pode bloquear session client)
  let links: Array<{
    id: string; client_id: string; asset_type: string; asset_id: string;
    asset_name: string | null; is_primary: boolean;
    client_name: string | null;
  }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminOrSession: any = supabase;
  try { adminOrSession = createSupabaseAdminClient(); } catch { /* usa session */ }

  try {
    const { data: linkData, error: linkError } = await adminOrSession
      .from("client_meta_assets")
      .select("id, client_id, asset_type, asset_id, asset_name, is_primary, clients(company_name)")
      .eq("meta_connection_id", connectionId);

    if (!linkError) {
      links = (linkData ?? []).map((l: {
        id: string; client_id: string; asset_type: string; asset_id: string;
        asset_name: string | null; is_primary: boolean;
        clients: { company_name: string | null } | { company_name: string | null }[] | null;
      }) => ({
        id: l.id,
        client_id: l.client_id,
        asset_type: l.asset_type,
        asset_id: l.asset_id,
        asset_name: l.asset_name,
        is_primary: l.is_primary,
        client_name: (Array.isArray(l.clients) ? l.clients[0]?.company_name : l.clients?.company_name) ?? null,
      }));
    }
  } catch { /* sql 37 não rodado — links fica vazio */ }

  // Enriquecer páginas com info de vínculo
  const enriched = pages.map((p) => {
    const pageLink = links.find((l) => l.asset_type === "facebook_page" && l.asset_id === p.id);
    const igLink   = p.instagram ? links.find((l) => l.asset_type === "instagram_business" && l.asset_id === p.instagram!.id) : null;
    return {
      ...p,
      link: pageLink ?? null,
      instagram: p.instagram ? { ...p.instagram, link: igLink ?? null } : null,
    };
  });

  return NextResponse.json({
    ok: true,
    connection_id: connectionId,
    assets: enriched,
    total: pages.length,
  });
}

// POST /api/meta/assets/link está em /api/meta/assets/link/route.ts
