-- ============================================================
-- LOKAT OS — SQL 107 · reconcile_meta_connections (advisory lock)
-- STATUS: DB MIGRATION PENDING -- NÃO APLICADA. Preparada e testada em
-- 2026-11-25 (PROMPT LKT | META, FASE 2) em sandbox ISOLADO (tabelas
-- temporárias com dados sintéticos equivalentes ao cenário real de
-- duplicatas -- NUNCA leu nem escreveu nas tabelas reais: a tentativa
-- de testar via transação revertida contra os dados reais, e a
-- tentativa de aplicar esta migration diretamente, foram as duas
-- recusadas pelo controle automático do ambiente de execução). É
-- puramente adição (função nova, sem alterar colunas/policies
-- existentes) e o rollback é trivial (ver abaixo) -- aplicar continua
-- dependendo de alguém rodar este arquivo direto no SQL Editor do
-- Supabase, ou de uma permissão que este ambiente ainda não concede
-- para a ferramenta de migration.
--
-- CONTEXTO (risco documentado antes desta missão em
-- src/app/api/meta/callback/route.ts): duas reconexões OAuth
-- VERDADEIRAMENTE simultâneas do mesmo usuário (ex.: duplo clique
-- abrindo duas abas) faziam leitura+escrita da reconciliação
-- (repontar vínculos de cliente + revogar conexões antigas) em
-- chamadas HTTP SEPARADAS, sem nenhuma transação nem lock cobrindo as
-- duas. Interleaving adversarial podia deixar as duas conexões novas
-- revogadas uma pela outra, com um vínculo de cliente apontando pra
-- uma conexão revogada.
--
-- SOLUÇÃO: toda a reconciliação roda dentro de UMA função, sob
-- pg_advisory_xact_lock(hashtext(connected_by), hashtext(meta_user_id))
-- -- serializa qualquer chamada concorrente pro MESMO usuário + MESMA
-- conta Meta (chamadas de usuários ou contas Meta diferentes nunca se
-- bloqueiam). Critério de sobrevivência é DETERMINÍSTICO
-- (created_at DESC, id DESC: a conexão mais recente sempre vence),
-- não "quem chegou primeiro" -- por isso é seguro chamar a função mais
-- de uma vez (idempotente) e não importa qual das duas chamadas
-- concorrentes roda primeiro: as duas convergem pro mesmo resultado
-- final depois que o lock serializa a ordem real de execução.
--
-- Chamada apenas pelo service role, server-side, nunca pelo cliente
-- autenticado direto -- por isso SECURITY INVOKER (não precisa de
-- DEFINER: o service role já faz bypass de RLS por padrão) e GRANT
-- apenas para service_role (REVOKE de anon/authenticated/public).
--
-- Rollback: DROP FUNCTION IF EXISTS public.reconcile_meta_connections(uuid, text);
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.meta_connections') IS NULL THEN
    RAISE EXCEPTION 'public.meta_connections não existe.';
  END IF;
  IF to_regclass('public.client_meta_assets') IS NULL THEN
    RAISE EXCEPTION 'public.client_meta_assets não existe.';
  END IF;
END $$;

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_meta_connections(
  p_connected_by  UUID,
  p_meta_user_id  TEXT
)
RETURNS TABLE (survivor_id UUID, revoked_count INT, repointed_count INT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_survivor  UUID;
  v_revoked   INT := 0;
  v_repointed INT := 0;
BEGIN
  IF p_connected_by IS NULL OR p_meta_user_id IS NULL OR btrim(p_meta_user_id) = '' THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  -- Serializa qualquer outra chamada concorrente pro MESMO usuário +
  -- MESMA conta Meta. Liberado automaticamente no fim da transação
  -- (xact-scoped) -- nunca precisa de unlock manual.
  PERFORM pg_advisory_xact_lock(hashtext(p_connected_by::text), hashtext(p_meta_user_id));

  -- Sobrevivente = a conexão ativa mais recente pra este usuário+conta.
  -- Critério determinístico -- não depende de qual chamada chegou
  -- "primeiro": repetir a chamada sempre converge pro mesmo resultado.
  SELECT id INTO v_survivor
  FROM public.meta_connections
  WHERE connected_by = p_connected_by
    AND meta_user_id = p_meta_user_id
    AND status = 'active'
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_survivor IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 0;
    RETURN;
  END IF;

  -- Repontar ANTES de revogar: nenhum vínculo de cliente fica, nem por
  -- um instante, apontando pra uma conexão já revogada.
  UPDATE public.client_meta_assets
  SET meta_connection_id = v_survivor
  WHERE meta_connection_id IN (
    SELECT id FROM public.meta_connections
    WHERE connected_by = p_connected_by
      AND meta_user_id = p_meta_user_id
      AND status = 'active'
      AND id <> v_survivor
  );
  GET DIAGNOSTICS v_repointed = ROW_COUNT;

  UPDATE public.meta_connections
  SET status = 'revoked', is_active = false
  WHERE connected_by = p_connected_by
    AND meta_user_id = p_meta_user_id
    AND status = 'active'
    AND id <> v_survivor;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  RETURN QUERY SELECT v_survivor, v_revoked, v_repointed;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_meta_connections(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_meta_connections(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.reconcile_meta_connections(UUID, TEXT) IS
  'SQL 107 -- substitui a reconciliação em 3 chamadas separadas feita em src/app/api/meta/callback/route.ts (select+update+update sem transação nem lock cobrindo as duas): esta função faz tudo sob pg_advisory_xact_lock, fechando de verdade a janela de corrida de duas reconexões OAuth simultâneas do mesmo usuário. Só o service_role chama (server-side, sem sessão de usuário no callback OAuth).';

COMMIT;

-- ── Depois de rodar este SQL ───────────────────────────────────────
-- 1. src/app/api/meta/callback/route.ts já tenta chamar
--    adminDb.rpc('reconcile_meta_connections', { p_connected_by, p_meta_user_id })
--    primeiro; se a função não existir (PGRST202/42883 -- o caso de
--    hoje, enquanto este arquivo não for rodado), cai sozinho pro
--    fallback manual (select+update+update, já em produção e testado).
--    Nenhum redeploy é necessário depois de rodar este SQL -- a próxima
--    reconexão já passa a usar o caminho atômico automaticamente.
-- 2. Testado em sandbox isolado com dados sintéticos (3 conexões do
--    mesmo usuário/conta criadas em momentos diferentes + 1 vínculo de
--    cliente apontando pra mais antiga): sobrevivente = a mais recente,
--    vínculo repontado antes da revogação, 2ª chamada idempotente
--    (0 revogações/repontes), e uma conta/usuário diferente nunca é
--    afetado pelo lock do primeiro. NÃO testado ainda contra os 8
--    registros reais duplicados em produção (acesso de escrita, mesmo
--    em transação revertida, foi recusado pelo controle automático).
