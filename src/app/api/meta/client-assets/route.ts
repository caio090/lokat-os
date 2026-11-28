import { NextRequest, NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  createSupabaseAdminClient,
  hasSupabaseServiceRoleKey,
} from "@/lib/supabase/server";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "operacional", "agency", "team"]);

// GET /api/meta/client-assets?client_id=<uuid>
// Returns aggregated Meta asset status for a specific client.
// Never exposes access_token.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");

  if (!clientId) {
    return NextResponse.json({ ok: false, reason: "missing_client_id" }, { status: 400 });
  }

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

  const { data: assetRows, error } = await db
    .from("client_meta_assets")
    .select("id, asset_type, asset_id, asset_name, username, picture_url, is_primary, connected_at")
    .eq("client_id", clientId)
    .order("is_primary", { ascending: false });

  if (error?.code === "42P01") {
    return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 37." });
  }

  if (error) {
    return NextResponse.json({ ok: false, reason: "db_error", message: error.message }, { status: 500 });
  }

  const assets = (assetRows ?? []) as Array<{
    id: string; asset_type: string; asset_id: string;
    asset_name: string | null; username: string | null;
    picture_url: string | null; is_primary: boolean;
    connected_at: string | null;
  }>;

  const facebookPage      = assets.find((a) => a.asset_type === "facebook_page")      ?? null;
  const instagramBusiness = assets.find((a) => a.asset_type === "instagram_business") ?? null;
  // PROMPT LKT 16: "adAccount: null, adAccountStatus: unavailable" eram fixos
  // -- a query acima já traz linhas asset_type='ad_account' (nunca filtrada
  // por tipo), só não eram lidas. Nunca houve indisponibilidade real.
  const adAccount          = assets.find((a) => a.asset_type === "ad_account")        ?? null;

  const hasPage      = !!facebookPage;
  const hasInstagram = !!instagramBusiness;

  let status: "complete" | "partial" | "not_connected";
  if (hasPage && hasInstagram) {
    status = "complete";
  } else if (hasPage || hasInstagram) {
    status = "partial";
  } else {
    status = "not_connected";
  }

  return NextResponse.json({
    ok: true,
    client_id: clientId,
    assets: {
      facebookPage: facebookPage ? {
        asset_record_id: facebookPage.id,
        id:              facebookPage.asset_id,
        name:            facebookPage.asset_name,
        picture_url:     facebookPage.picture_url,
        connected_at:    facebookPage.connected_at,
      } : null,
      instagramBusiness: instagramBusiness ? {
        asset_record_id: instagramBusiness.id,
        id:              instagramBusiness.asset_id,
        username:        instagramBusiness.username,
        name:            instagramBusiness.asset_name,
        picture_url:     instagramBusiness.picture_url,
        connected_at:    instagramBusiness.connected_at,
      } : null,
      adAccount: adAccount ? {
        asset_record_id: adAccount.id,
        id:              adAccount.asset_id,
        name:            adAccount.asset_name,
        connected_at:    adAccount.connected_at,
      } : null,
      adAccountStatus: adAccount ? "linked" as const : "not_linked" as const,
    },
    status,
    allAssets: assets.map((a) => ({
      asset_record_id: a.id,
      asset_type:      a.asset_type,
      asset_id:        a.asset_id,
      asset_name:      a.asset_name,
      username:        a.username,
    })),
  });
}
