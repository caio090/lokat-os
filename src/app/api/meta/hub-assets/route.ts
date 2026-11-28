import { NextResponse } from "next/server";
import { createServerSupabaseClient, createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";

// GET /api/meta/hub-assets
// Retorna nomes persistidos de ativos Meta por cliente em uma única query.
// Fonte: client_meta_assets (não Graph API) — representa o que foi explicitamente vinculado.
// Nunca retorna access_token.
//
// Resposta:
// {
//   ok: true,
//   items: [{ client_id, facebook_page_name, instagram_username, meta_status }]
// }
export async function GET() {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  if (hasSupabaseServiceRoleKey()) {
    try { db = createSupabaseAdminClient(); } catch { db = await createServerSupabaseClient(); }
  } else {
    db = await createServerSupabaseClient();
  }

  const { data: rows, error } = await db
    .from("client_meta_assets")
    .select("client_id, asset_type, asset_id, asset_name, username");

  if (error?.code === "42P01") {
    // Tabela não existe ainda — retorna vazio sem erro
    return NextResponse.json({ ok: true, items: [] });
  }
  if (error) {
    return NextResponse.json({ ok: false, reason: "db_error" }, { status: 500 });
  }

  // Agrupa por client_id
  const byClient = new Map<string, { fb: string | null; ig: string | null; adAccountId: string | null; adAccountName: string | null }>();

  for (const row of (rows ?? []) as Array<{
    client_id: string; asset_type: string; asset_id: string; asset_name: string | null; username: string | null;
  }>) {
    if (!byClient.has(row.client_id)) {
      byClient.set(row.client_id, { fb: null, ig: null, adAccountId: null, adAccountName: null });
    }
    const entry = byClient.get(row.client_id)!;
    if (row.asset_type === "facebook_page" && !entry.fb) {
      entry.fb = row.asset_name;
    }
    if (row.asset_type === "instagram_business" && !entry.ig) {
      entry.ig = row.username ?? row.asset_name;
    }
    // PROMPT LKT 16: conta de anúncio por cliente -- a linha já existia
    // aqui (client_meta_assets não filtra por asset_type), só não era lida.
    if (row.asset_type === "ad_account" && !entry.adAccountId) {
      entry.adAccountId = row.asset_id;
      entry.adAccountName = row.asset_name;
    }
  }

  const items = Array.from(byClient.entries()).map(([client_id, { fb, ig, adAccountId, adAccountName }]) => ({
    client_id,
    facebook_page_name:  fb,
    instagram_username:  ig,
    ad_account_asset_id: adAccountId,
    ad_account_name:     adAccountName,
    meta_status: (fb && ig) ? "complete" : (fb || ig) ? "partial" : "not_connected",
  }));

  return NextResponse.json({ ok: true, items });
}
