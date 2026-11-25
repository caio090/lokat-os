import { NextResponse } from "next/server";
import { createServerSupabaseClient, createSupabaseAdminClient, hasSupabaseServiceRoleKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { hasLocalhostMetaRedirect, isProductionEnv } from "@/lib/app-url";

const BROAD_ACCESS_ROLES = new Set(["admin", "super_admin"]);

// GET /api/meta/status
// Retorna estado completo da integração Meta sem expor nenhum valor sensível.
// Rota pública — cookies do usuário são lidos quando disponíveis para checar conexão.
export async function GET() {
  const appId       = process.env.META_APP_ID?.trim();
  const appSecret   = process.env.META_APP_SECRET?.trim();
  const redirectUri = process.env.META_REDIRECT_URI?.trim();
  const apiVersion  = process.env.META_API_VERSION?.trim();

  // Status por variável — nunca expõe o valor real
  const configured = {
    META_APP_ID:       !!appId,
    META_APP_SECRET:   !!appSecret,
    META_REDIRECT_URI: !!redirectUri,
    META_API_VERSION:  !!apiVersion,
  };

  const allConfigured = Object.values(configured).every(Boolean);
  const canConnect    = allConfigured;

  // Tenta checar conexão ativa e existência da tabela meta_connections
  let connected  = false;
  let sqlPending = false;

  if (isSupabaseConfigured) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // admin/super_admin: "conectado" considera QUALQUER conexão ativa
        // na plataforma, não só a do usuário que está checando -- mesma
        // regra já usada em /api/meta/accounts. Sem isso, um admin
        // diferente de quem fez o OAuth via a Central de Conexões como
        // "Aguardando conexão" mesmo com uma conexão real já ativa.
        const { data: profile } = await supabase
          .from("profiles").select("role").eq("id", user.id).maybeSingle();
        const isBroadAccess = !!profile?.role && BROAD_ACCESS_ROLES.has(profile.role);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let db: any = supabase;
        if (isBroadAccess && hasSupabaseServiceRoleKey()) {
          try { db = createSupabaseAdminClient(); } catch { /* usa session */ }
        }

        let connQuery = db
          .from("meta_connections")
          .select("id")
          .eq("status", "active")
          .limit(1)
          .maybeSingle();
        if (!isBroadAccess) {
          connQuery = db
            .from("meta_connections")
            .select("id")
            .eq("connected_by", user.id)
            .eq("status", "active")
            .limit(1)
            .maybeSingle();
        }

        const { data, error } = await connQuery;

        if (error?.code === "42P01") {
          // relation does not exist — SQL 35 não foi rodado
          sqlPending = true;
        } else {
          connected = !!data;
        }
      }
    } catch {
      // Supabase indisponível ou sem sessão — não é crítico
    }
  }

  // Mensagem amigável derivada do estado
  const missingVars = Object.entries(configured)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const localhostRedirect = hasLocalhostMetaRedirect();
  const inProd            = isProductionEnv();
  let redirectHost: string | null = null;
  try {
    if (redirectUri) redirectHost = new URL(redirectUri).hostname;
  } catch { /* invalid URL — ignore */ }

  const message = !allConfigured
    ? `Variáveis não configuradas: ${missingVars.join(", ")}. Adicione no painel da Vercel e faça redeploy.`
    : inProd && localhostRedirect
      ? "META_REDIRECT_URI aponta para localhost. Atualize para https://www.lokat.com.br/api/meta/callback na Vercel e faça redeploy."
      : sqlPending
        ? "Variáveis configuradas. Rode o SQL 35 no Supabase SQL Editor para ativar o salvamento de conexões."
        : connected
          ? "Meta configurada e conta conectada."
          : "Meta configurada. Conecte uma conta para iniciar o fluxo OAuth.";

  return NextResponse.json({
    ok:                  allConfigured && (!inProd || !localhostRedirect),
    configured,
    connected,
    canConnect:          allConfigured && (!inProd || !localhostRedirect),
    sqlPending,
    message,
    redirectConfigured:  !!redirectUri,
    redirectHost,
    hasLocalhostRedirect: localhostRedirect,
    missing:             missingVars,
  });
}
