import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/app-url";
import { verifyOAuthState } from "@/lib/meta/state";
import { exchangeForLongLivedToken, inspectToken } from "@/lib/meta/token-lifecycle";

// GET /api/meta/callback
// Recebe o retorno OAuth do Meta, valida state assinado, troca code por token
// e persiste em meta_connections via admin client (não depende de sessão ativa).
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const { searchParams } = new URL(request.url);
  const code        = searchParams.get("code");
  const rawState    = searchParams.get("state");
  const errorParam  = searchParams.get("error");
  const errorReason = searchParams.get("error_reason");

  // ── 1. Usuário cancelou o OAuth ───────────────────────────────────────
  if (errorParam) {
    const msg = errorReason === "user_denied"
      ? "Autorização cancelada pelo usuário."
      : "Não foi possível conectar a conta Meta. Tente novamente.";
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent(msg)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent("Parâmetro code ausente no callback OAuth.")}`
    );
  }

  // ── 2. Valida state HMAC assinado ─────────────────────────────────────
  if (!rawState) {
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent("State OAuth ausente. Tente reconectar.")}`
    );
  }

  const stateResult = verifyOAuthState(rawState);
  if (!stateResult.ok) {
    const msgs: Record<string, string> = {
      invalid_format:    "State OAuth inválido. Tente reconectar.",
      invalid_signature: "State OAuth adulterado. Por segurança, a conexão foi bloqueada.",
      expired:           "A sessão OAuth expirou (limite: 10 minutos). Tente reconectar.",
      replay:            "State OAuth já utilizado. Por segurança, a conexão foi bloqueada.",
    };
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent(msgs[stateResult.reason] ?? "Erro de validação OAuth.")}`
    );
  }

  const { uid: userId, cid: clientId, rt: returnTo } = stateResult.payload;

  // ── 3. Troca code por access_token ────────────────────────────────────
  const appId      = process.env.META_APP_ID?.trim();
  const appSecret  = process.env.META_APP_SECRET?.trim();
  const redirectUri = process.env.META_REDIRECT_URI?.trim();

  if (!appId || !appSecret || !redirectUri) {
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent("Variáveis Meta não configuradas no servidor.")}`
    );
  }

  let accessToken: string | null = null;
  try {
    const tokenUrl = new URL("https://graph.facebook.com/oauth/access_token");
    tokenUrl.searchParams.set("client_id",     appId);
    tokenUrl.searchParams.set("client_secret", appSecret); // server-side only
    tokenUrl.searchParams.set("redirect_uri",  redirectUri);
    tokenUrl.searchParams.set("code",          code);

    const tokenRes  = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } };

    if (tokenData.error || !tokenData.access_token) {
      const msg = tokenData.error?.message
        ? "Falha ao obter token da Meta. Verifique as credenciais do app."
        : "Resposta inesperada da Meta ao trocar o code.";
      return NextResponse.redirect(
        `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent(msg)}`
      );
    }

    accessToken = tokenData.access_token;
  } catch {
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent("Erro de rede ao comunicar com a API da Meta.")}`
    );
  }

  // ── 3b. Token de longa duração + escopos/validade reais (não-crítico) ──
  //    Sem isso a conexão ficava "active" com um token de ~1-2h e sem
  //    registro de permissões (estado encontrado em produção em 2026-11-22).
  if (!accessToken) {
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent("Resposta inesperada da Meta ao trocar o code.")}`
    );
  }
  const longLived = await exchangeForLongLivedToken(accessToken, appId, appSecret);
  accessToken = longLived.accessToken;
  const inspection = await inspectToken(accessToken, appId, appSecret);
  const tokenExpiresAt = inspection
    ? inspection.expiresAt
    : longLived.expiresAt;
  const grantedScopes = inspection?.scopes.join(",") ?? null;

  // ── 4. Busca metadados da conta Meta (não-crítico) ────────────────────
  let metaUserId:   string | null = null;
  let metaUserName: string | null = null;
  try {
    const meRes  = await fetch(`https://graph.facebook.com/me?fields=id,name&access_token=${accessToken}`);
    const meData = await meRes.json() as { id?: string; name?: string };
    metaUserId   = meData.id   ?? null;
    metaUserName = meData.name ?? null;
  } catch { /* não crítico */ }

  // ── 5. Persiste em meta_connections via admin client (bypassa RLS) ────
  //    connected_by vem exclusivamente do state validado, não de query param.
  if (!hasSupabaseServiceRoleKey()) {
    // Sem service role, não consegue persistir sem depender de sessão.
    // Avisa sem registrar o token no log.
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_warn=${encodeURIComponent(
        "OAuth autorizado, mas SUPABASE_SERVICE_ROLE_KEY não está configurada. Configure-a na Vercel para salvar a conexão."
      )}`
    );
  }

  const adminDb = createSupabaseAdminClient();
  let newConnectionId: string | null = null;

  try {
    const { data: inserted, error: insertError } = await adminDb
      .from("meta_connections")
      .insert({
        connected_by: userId,
        provider:     "meta",
        meta_app_id:  appId,
        meta_user_id: metaUserId,
        access_token: accessToken, // armazenado server-side, nunca enviado ao front
        token_expires_at: tokenExpiresAt ? tokenExpiresAt.toISOString() : null,
        scopes:       grantedScopes,
        status:       "active",
        is_active:    true,
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "42P01") {
        return NextResponse.redirect(
          `${appUrl}/admin/conexoes?meta_warn=${encodeURIComponent(
            "OAuth autorizado com sucesso, mas a tabela meta_connections ainda não existe. Rode o SQL 35 no Supabase."
          )}`
        );
      }
      // Erro real de DB — não redireciona como sucesso
      console.error("[meta/callback] falha ao inserir conexão", {
        code:    insertError.code,
        message: insertError.message,
        // Nunca loga token
      });
      return NextResponse.redirect(
        `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent(
          "Falha ao salvar a conexão Meta. Tente reconectar ou contate o suporte."
        )}`
      );
    }

    newConnectionId = inserted?.id ?? null;

    // Toda reconexão deste usuário criava uma linha nova sem nunca
    // desativar a anterior (histórico nunca é apagado), e isso se
    // acumulou: confirmado em produção em 2026-11-23, 8 linhas "active"
    // simultâneas para a mesma conta Meta, o que faz /api/meta/accounts
    // sempre cair em "connection_selection_required" sem nenhuma forma
    // de escolher. client_meta_assets.meta_connection_id aponta pra uma
    // linha ESPECÍFICA (ex.: Duh Lanches -> conexão de 2026-06-26);
    // revogar essa linha sem repontar primeiro quebraria a leitura de
    // insights dela, mesmo sendo a MESMA conta Meta -- achado confirmado
    // ao reauditar este fluxo em 2026-11-24.
    //
    // metaUserId ausente (fetch /me falhou, caminho não-crítico) significa
    // que não há como comprovar "é a mesma conta Meta" -- nesse caso não
    // toca em nada.
    if (newConnectionId && metaUserId) {
      try {
        // reconcile_meta_connections (SQL 107) faz a reconciliação toda
        // (escolher sobrevivente + repontar vínculos + revogar antigas)
        // em UMA transação sob pg_advisory_xact_lock, fechando de verdade
        // a corrida entre duas reconexões verdadeiramente simultâneas do
        // mesmo usuário -- a versão anterior fazia 3 chamadas HTTP
        // separadas, sem nenhuma transação cobrindo as duas. Testado em
        // sandbox isolado (tabelas temporárias, nunca nas reais) em
        // 2026-11-25: sobrevivente determinístico (mais recente),
        // idempotente, e duas contas/usuários diferentes nunca se
        // bloqueiam entre si.
        const { error: rpcError } = await adminDb.rpc("reconcile_meta_connections", {
          p_connected_by: userId,
          p_meta_user_id: metaUserId,
        });

        // PGRST202 / 42883: a migration 107 ainda não foi rodada neste
        // ambiente (pendência manual -- aplicar migrations está fora do
        // que esta sessão consegue fazer direto no banco). Nesse caso,
        // cai pro caminho anterior (3 chamadas separadas): não é à prova
        // de concorrência simultânea, mas é o mesmo comportamento já
        // testado e em uso, nunca deixa a reconexão sequencial quebrada.
        const fnMissing =
          rpcError && (rpcError.code === "PGRST202" || rpcError.code === "42883");

        if (fnMissing) {
          const { data: oldActive } = await adminDb
            .from("meta_connections")
            .select("id")
            .eq("connected_by", userId)
            .eq("status", "active")
            .eq("meta_user_id", metaUserId)
            .neq("id", newConnectionId);

          const oldIds = (oldActive ?? []).map((r: { id: string }) => r.id);

          if (oldIds.length > 0) {
            await adminDb
              .from("client_meta_assets")
              .update({ meta_connection_id: newConnectionId })
              .in("meta_connection_id", oldIds);
          }

          await adminDb
            .from("meta_connections")
            .update({ status: "revoked", is_active: false })
            .eq("connected_by", userId)
            .eq("status", "active")
            .eq("meta_user_id", metaUserId)
            .neq("id", newConnectionId);
        } else if (rpcError) {
          console.error("[meta/callback] reconcile_meta_connections falhou", {
            code: rpcError.code,
            message: rpcError.message,
          });
        }
      } catch {
        // Não-crítico: a conexão nova já foi salva com sucesso. Falhar em
        // rebaixar/repontar as antigas nunca deve virar um erro pro
        // usuário -- na próxima reconexão, a limpeza é tentada de novo.
      }
    }
  } catch {
    return NextResponse.redirect(
      `${appUrl}/admin/conexoes?meta_error=${encodeURIComponent("Erro inesperado ao salvar a conexão Meta.")}`
    );
  }

  // ── 6. Retorno contextual ─────────────────────────────────────────────
  const successMsg = metaUserName
    ? `Conta Meta conectada: ${metaUserName}`
    : "Conta Meta conectada com sucesso.";

  // Se o OAuth foi iniciado a partir de um cliente, retorna ao contexto do cliente
  if (returnTo === "/admin/clientes" && clientId) {
    const params = new URLSearchParams({
      provider:    "meta",
      client:      clientId,
      meta_ok:     encodeURIComponent(successMsg),
    });
    if (newConnectionId) params.set("connection", newConnectionId);
    return NextResponse.redirect(`${appUrl}/admin/clientes?${params.toString()}`);
  }

  return NextResponse.redirect(
    `${appUrl}/admin/conexoes?meta_ok=${encodeURIComponent(successMsg)}`
  );
}
