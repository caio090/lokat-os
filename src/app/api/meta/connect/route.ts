import { NextRequest, NextResponse } from "next/server";
import { resolveMetaApiVersion } from "@/lib/meta/graph-version";
import { resolveOAuthScopes } from "@/lib/meta/token-lifecycle";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAppUrl, isProductionEnv, hasLocalhostMetaRedirect } from "@/lib/app-url";
import { createOAuthState } from "@/lib/meta/state";

const VALID_RETURN_PATHS = new Set([
  "/admin/clientes",
  "/admin/conexoes",
  "/client/integracoes",
  "/client/configuracoes",
]);

// GET /api/meta/connect?client_id=<uuid>&return_to=<path>
// Monta a URL de autorização OAuth do Meta/Facebook e redireciona o usuário.
// Requer sessão autenticada.
// State é assinado com HMAC-SHA256 para proteger contra CSRF e replay.
export async function GET(request: NextRequest) {
  const appUrl      = getAppUrl();
  const appId       = process.env.META_APP_ID?.trim();
  const redirectUri = process.env.META_REDIRECT_URI?.trim();
  const apiVersion  = resolveMetaApiVersion();

  if (!appId || !redirectUri) {
    return NextResponse.json(
      { ok: false, error: "META_APP_ID ou META_REDIRECT_URI não configurados." },
      { status: 500 }
    );
  }

  if (isProductionEnv() && hasLocalhostMetaRedirect()) {
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent(
        "META_REDIRECT_URI aponta para localhost. Atualize na Vercel e faça redeploy."
      )}`
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  const { searchParams } = new URL(request.url);
  const clientId  = searchParams.get("client_id")  ?? undefined;
  const rawReturn = searchParams.get("return_to")   ?? undefined;
  const returnTo  = rawReturn && VALID_RETURN_PATHS.has(rawReturn) ? rawReturn : undefined;

  const state = createOAuthState({ uid: user.id, cid: clientId, rt: returnTo });

  // Base de leitura orgânica + extras opt-in (META_OAUTH_EXTRA_SCOPES, ex.:
  // "ads_read") -- ver src/lib/meta/token-lifecycle.ts.
  const scopes = resolveOAuthScopes().join(",");

  const authUrl = new URL(`https://www.facebook.com/${apiVersion}/dialog/oauth`);
  authUrl.searchParams.set("client_id",     appId);
  authUrl.searchParams.set("redirect_uri",  redirectUri);
  authUrl.searchParams.set("scope",         scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state",         state);

  return NextResponse.redirect(authUrl.toString());
}
