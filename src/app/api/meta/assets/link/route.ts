import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";

interface LinkPayload {
  client_id:          string;
  meta_connection_id?: string; // opcional — RPC resolve internamente se omitido
  asset_type:         "facebook_page" | "instagram_business" | "ad_account";
  asset_id:           string;
  asset_name?:        string;
  username?:          string;
  picture_url?:       string;
  is_primary?:        boolean;
}

// Sprint Legacy Security Hardening V2 (Fase 23): o valor de role usado
// anteriormente para "agência" nunca foi real em profiles.role -- removido.
// Nenhum destes roles concede
// acesso a uma Company específica por si só -- ver can_access_client()
// logo abaixo, chamado ANTES de qualquer operação privilegiada (Fase 17).
const META_MANAGER_ROLES = new Set(["admin", "super_admin"]);

function isRpcUnavailable(err: { code?: string; message?: string } | null) {
  if (!err) return false;
  const msg = err.message?.toLowerCase() ?? "";
  return (
    err.code === "PGRST202" ||
    msg.includes("could not find the function") ||
    msg.includes("function public.admin_link_meta_asset")
  );
}

// POST /api/meta/assets/link
// Vincula ativo Meta (Página FB ou Instagram Business) a um cliente.
//
// Estratégia de acesso:
//   1. RPC admin_link_meta_asset (SECURITY DEFINER, bypassa RLS) — preferido
//   2. Upsert direto via adminDb (service role) — fallback quando SQL 60 não rodado
//   3. Upsert direto via session client (requer SQL 59/61) — último recurso
//
// meta_connection_id é OPCIONAL:
//   - Se vier do front (vem de /api/meta/assets que já verificou a conexão),
//     usa diretamente — sem re-verificar, pois o listing já provou a conexão.
//   - Se não vier, procura a conexão Meta ativa mais recente via adminDb/session.
//
// Nunca retorna access_token, refresh_token ou outros secrets.
export const POST = withMutationProtection(async function POST(request: NextRequest) {
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
  if (!userRole || !META_MANAGER_ROLES.has(userRole)) {
    return NextResponse.json({
      ok: false, reason: "forbidden",
      message: "Apenas admin e super_admin podem vincular ativos.",
    }, { status: 403 });
  }

  let body: LinkPayload;
  try { body = await request.json() as LinkPayload; }
  catch { return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 }); }

  const { client_id, meta_connection_id, asset_type, asset_id, asset_name, username, picture_url, is_primary } = body;

  if (!client_id || !asset_type || !asset_id) {
    return NextResponse.json({
      ok: false, reason: "missing_fields",
      message: "client_id, asset_type e asset_id são obrigatórios.",
    }, { status: 400 });
  }

  // ad_account já era aceito por admin_link_meta_asset (SQL 60) e pelo CHECK
  // de client_meta_assets (SQL 37) -- só esta rota nunca deixava passar
  // (PROMPT LKT 16: vínculo de conta de anúncio por cliente).
  const validTypes = ["facebook_page", "instagram_business", "ad_account"];
  if (!validTypes.includes(asset_type)) {
    return NextResponse.json({ ok: false, reason: "invalid_asset_type" }, { status: 400 });
  }

  // ── Autorização de Company ANTES de qualquer operação privilegiada
  // (Fase 17/18) -- vale para o caminho RPC e para o fallback direto por
  // igual, então o fallback nunca fica mais permissivo que o caminho
  // normal (Fase 19). client_id da query/body nunca é autorização por si
  // só -- resolvido via o helper canônico real.
  const { data: canAccess } = await supabase.rpc("can_access_client", { target_client_id: client_id });
  if (!canAccess) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const isSuperAdmin = userRole === "super_admin";

  // ── Etapa 1: RPC SECURITY DEFINER (bypassa RLS, não precisa de service role) ──
  {
    const { data: rpcData, error: rpcError } = await supabase.rpc("admin_link_meta_asset", {
      p_client_id:          client_id,
      p_asset_type:         asset_type,
      p_asset_id:           asset_id,
      p_asset_name:         asset_name         ?? null,
      p_username:           username            ?? null,
      p_picture_url:        picture_url         ?? null,
      p_meta_connection_id: meta_connection_id  ?? null,
      p_is_primary:         is_primary          ?? false,
    });

    if (!rpcError) {
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      return NextResponse.json({ ok: true, id: row?.asset_record_id, via: "rpc" });
    }

    if (isRpcUnavailable(rpcError)) {
      // SQL 60 não foi rodado — usa fallback direto
      console.warn("[api/meta/assets/link] RPC admin_link_meta_asset indisponivel, usando fallback direto");
    } else if (rpcError.code === "P0001") {
      return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
    } else if (rpcError.code === "P0002") {
      return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
    } else if (rpcError.code === "P0003") {
      return NextResponse.json({ ok: false, reason: "client_not_found", message: "Cliente não encontrado." }, { status: 404 });
    } else if (rpcError.code === "P0005") {
      return NextResponse.json({ ok: false, reason: "invalid_asset_type" }, { status: 400 });
    } else if (rpcError.code === "P0006") {
      // Fase 15: conexão explícita cross-context -- rejeita direto,
      // nunca cai no fallback para "adivinhar" outra conexão.
      return NextResponse.json({
        ok: false, reason: "connection_not_found",
        message: "Conexão Meta não encontrada ou sem permissão de acesso.",
      }, { status: 404 });
    } else {
      console.error("[api/meta/assets/link] erro inesperado na RPC", {
        stage: "rpc_admin_link_meta_asset",
        supabaseErrorCode: rpcError.code,
        supabaseErrorMessage: rpcError.message,
      });
      // Cai no fallback — não retorna erro aqui, tenta via upsert direto
    }
  }

  // ── Etapa 2: Fallback direto ────────────────────────────────────────────────
  //
  // meta_connections não tem FK de Company (é por usuário/workspace) --
  // não fingimos uma (Fase 14). A autorização real já foi feita acima
  // (can_access_client); aqui só resolvemos ownership da CONEXÃO em si:
  //   - explícita (veio do body): precisa pertencer ao caller
  //     (connected_by), ou o caller ser super_admin. Nunca cai
  //     silenciosamente para outra conexão (Fase 15) -- rejeita.
  //   - implícita (não veio): busca só entre as conexões do PRÓPRIO
  //     caller, nunca "a mais recente da plataforma" -- exceto
  //     super_admin, que mantém o alcance global já existente.
  let resolvedConnectionId: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let connDb: any = supabase;
  if (hasSupabaseServiceRoleKey()) {
    try { connDb = createSupabaseAdminClient(); } catch { /* usa session */ }
  }

  if (meta_connection_id) {
    const connQ = isSuperAdmin
      ? connDb.from("meta_connections").select("id").eq("id", meta_connection_id).eq("status", "active").maybeSingle()
      : connDb.from("meta_connections").select("id").eq("id", meta_connection_id).eq("connected_by", userId).eq("status", "active").maybeSingle();

    const { data: connRow, error: connErr } = await connQ as {
      data: { id: string } | null;
      error: { code?: string; message?: string } | null;
    };

    if (connErr?.code === "42P01") {
      return NextResponse.json({ ok: false, reason: "sql_pending", message: "Rode o SQL 35 no Supabase." });
    }
    if (!connRow) {
      // Fase 15: nunca corrige silently escolhendo outra conexão.
      return NextResponse.json({
        ok: false, reason: "connection_not_found",
        message: "Conexão Meta não encontrada ou sem permissão de acesso.",
      }, { status: 404 });
    }
    resolvedConnectionId = connRow.id;
  }

  if (!resolvedConnectionId) {
    const connLookupQ = isSuperAdmin
      ? connDb.from("meta_connections").select("id").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle()
      : connDb.from("meta_connections").select("id").eq("status", "active").eq("connected_by", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();

    const { data: connRow, error: connLookupErr } = await connLookupQ as {
      data: { id: string } | null;
      error: { code?: string; message?: string } | null;
    };

    if (connLookupErr?.code === "42P01") {
      return NextResponse.json({
        ok: false, reason: "sql_pending",
        message: "Tabela meta_connections não existe. Rode o SQL 35 no Supabase.",
      });
    }

    resolvedConnectionId = connRow?.id ?? null;

    if (!resolvedConnectionId) {
      return NextResponse.json({
        ok: false, reason: "no_active_meta_connection",
        message: "Nenhuma conexão Meta ativa encontrada. Conecte a Meta em /admin/conexoes.",
        debug: {
          stage: "resolve_meta_connection",
          payloadHadConnectionId: false,
          hasMetaConnections: !connLookupErr,
        },
      }, { status: 404 });
    }
  }

  // Prepara payload de upsert
  const upsertPayload = {
    client_id,
    meta_connection_id: resolvedConnectionId,
    asset_type,
    asset_id,
    asset_name:  asset_name  ?? null,
    username:    username    ?? null,
    picture_url: picture_url ?? null,
    is_primary:  is_primary  ?? false,
    connected_by: userId,
  };

  // Tenta session client primeiro (requer SQL 59/61 rodados no Supabase)
  let { data, error } = await supabase
    .from("client_meta_assets")
    .upsert(upsertPayload, { onConflict: "client_id,asset_type,asset_id" })
    .select("id")
    .single();

  // Se session client falhou (RLS bloqueia super_admin antes de SQL 59/61),
  // tenta adminDb (service role bypassa tudo)
  if (error && hasSupabaseServiceRoleKey()) {
    try {
      const adminDb = createSupabaseAdminClient();
      const r = await adminDb
        .from("client_meta_assets")
        .upsert(upsertPayload, { onConflict: "client_id,asset_type,asset_id" })
        .select("id")
        .single();
      data  = r.data;
      error = r.error;
    } catch { /* mantém erro original do session client */ }
  }

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json({
        ok: false, reason: "sql_pending",
        message: "Tabela client_meta_assets não existe. Rode o SQL 37 e o SQL 59 no Supabase.",
      });
    }

    console.error("[api/meta/assets/link] erro no upsert", {
      stage:               "upsert_client_meta_assets",
      table:               "client_meta_assets",
      client_id,
      asset_type,
      supabaseErrorCode:   error.code,
      supabaseErrorMessage: error.message,
    });

    return NextResponse.json({
      ok: false, reason: "db_error",
      message: error.message,
      debug: {
        stage:                "upsert_client_meta_assets",
        table:                "client_meta_assets",
        supabaseErrorCode:    error.code,
        supabaseErrorMessage: error.message,
        payloadHadConnectionId: !!meta_connection_id,
        currentUserRole:      userRole,
      },
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id, via: "direct" });
});

// DELETE /api/meta/assets/link?id=<asset_record_id> — remove vínculo
export const DELETE = withMutationProtection(async function DELETE(request: NextRequest) {
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

  if (!userId || !supabase || !userRole || !META_MANAGER_ROLES.has(userRole)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  const assetRecordId = new URL(request.url).searchParams.get("id");
  if (!assetRecordId) {
    return NextResponse.json({ ok: false, reason: "missing_id" }, { status: 400 });
  }

  // Fase 17/18 + Fase 12 (PROMPT 04A): resolve a Company real do registro
  // antes de deletar -- "está logado e tem o role certo" não é autorização
  // para a Company dona deste vínculo específico. Lookup que não resolve
  // ownership NUNCA é interpretado como autorização implícita -- fail
  // closed em cada ramo (erro de lookup, registro inexistente, ou
  // client_id ausente).
  const { data: assetRow, error: lookupError } = await supabase
    .from("client_meta_assets").select("client_id").eq("id", assetRecordId).maybeSingle();
  if (lookupError) {
    return NextResponse.json({ ok: false, reason: "lookup_failed" }, { status: 500 });
  }
  if (!assetRow) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  if (!assetRow.client_id) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const { data: canAccess } = await supabase.rpc("can_access_client", { target_client_id: assetRow.client_id });
  if (!canAccess) return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  // Autorização já validada de forma independente acima -- só agora é
  // seguro usar service_role para a mutação técnica (Fase 10). Nunca mais
  // "tenta com sessão, cai pro admin em qualquer erro".
  const deleteDb = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : supabase;
  const { error } = await deleteDb
    .from("client_meta_assets")
    .delete()
    .eq("id", assetRecordId);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
