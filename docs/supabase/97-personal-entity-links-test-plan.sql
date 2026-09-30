-- ============================================================
-- LOKAT OS — TEST PLAN do SQL 97 · personal_entity_links (Meu PP V2 · Fase 0)
--
-- Executar DEPOIS do SQL 97, no SQL Editor (ou execute_sql), como postgres.
-- É um único bloco que SEMPRE termina com RAISE EXCEPTION: a mensagem do
-- erro carrega o resultado (PASS/FAIL) e a transação inteira é desfeita --
-- nenhuma linha de teste sobrevive, nenhum usuário é criado.
--
-- Usuários:
--   OWNER  = um usuário real já existente em auth.users (só o id é usado,
--            nenhum dado dele é lido; toda escrita é desfeita no fim).
--   OUTRO  = um UUID aleatório SÓ nos JWT claims (não existe em auth.users;
--            não fabricamos conta real para testar isolamento).
--   anon / service_role = SET ROLE direto; o esperado é "permission denied"
--            já na camada de GRANT (service role tem BYPASSRLS, então o
--            que o barra é o REVOKE, não o RLS).
--
-- Cobertura: owner cria/lê/atualiza/apaga; outro não lê/atualiza/apaga/
-- insere em nome do owner; anon e service_role não leem nem escrevem;
-- constraints (auto-relação, formato de tipo, aresta duplicada, metadata
-- não-objeto).
-- ============================================================

DO $$
DECLARE
  owner_id uuid;
  other_id uuid := gen_random_uuid();
  link_id  uuid;
  n        int;
  ok       int := 0;
  fails    text[] := '{}';
  src      uuid := gen_random_uuid();
  tgt      uuid := gen_random_uuid();
BEGIN
  SELECT id INTO owner_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'TEST_ABORTED: nenhum usuário em auth.users'; END IF;

  -- ── camada de GRANT (sem impersonar) ─────────────────────────
  IF NOT has_table_privilege('anon', 'public.personal_entity_links', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.personal_entity_links', 'INSERT') THEN ok := ok + 1; ELSE fails := fails || 'grant: anon tem acesso'; END IF;
  IF NOT has_table_privilege('service_role', 'public.personal_entity_links', 'SELECT')
     AND NOT has_table_privilege('service_role', 'public.personal_entity_links', 'INSERT')
     AND NOT has_table_privilege('service_role', 'public.personal_entity_links', 'UPDATE')
     AND NOT has_table_privilege('service_role', 'public.personal_entity_links', 'DELETE') THEN ok := ok + 1; ELSE fails := fails || 'grant: service_role tem acesso'; END IF;
  IF has_table_privilege('authenticated', 'public.personal_entity_links', 'SELECT,INSERT,UPDATE,DELETE') THEN ok := ok + 1; ELSE fails := fails || 'grant: authenticated sem CRUD'; END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.personal_entity_links'::regclass) THEN ok := ok + 1; ELSE fails := fails || 'rls desligada'; END IF;

  -- ── OWNER: cria, lê, atualiza ────────────────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id, relation_type)
  VALUES (owner_id, 'task', src, 'client_project', tgt, 'related_to') RETURNING id INTO link_id;
  IF link_id IS NOT NULL THEN ok := ok + 1; ELSE fails := fails || 'owner: insert'; END IF;

  SELECT count(*) INTO n FROM public.personal_entity_links WHERE id = link_id;
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'owner: select'; END IF;

  UPDATE public.personal_entity_links SET relation_type = 'references' WHERE id = link_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'owner: update'; END IF;

  -- constraints (cada uma num sub-bloco: o erro esperado não aborta o teste)
  BEGIN
    INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id) VALUES (owner_id, 'task', src, 'task', src);
    fails := fails || 'constraint: auto-relação aceita';
  EXCEPTION WHEN check_violation THEN ok := ok + 1; END;
  BEGIN
    INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id) VALUES (owner_id, 'Task Grande!', src, 'task', tgt);
    fails := fails || 'constraint: tipo fora do formato aceito';
  EXCEPTION WHEN check_violation THEN ok := ok + 1; END;
  BEGIN
    INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id, relation_type) VALUES (owner_id, 'task', src, 'client_project', tgt, 'references');
    fails := fails || 'constraint: aresta duplicada aceita';
  EXCEPTION WHEN unique_violation THEN ok := ok + 1; END;
  BEGIN
    INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id, metadata) VALUES (owner_id, 'task', src, 'event', tgt, '[1,2]'::jsonb);
    fails := fails || 'constraint: metadata não-objeto aceita';
  EXCEPTION WHEN check_violation THEN ok := ok + 1; END;

  -- ── OUTRO usuário (só claims) ────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.personal_entity_links WHERE id = link_id;
  IF n = 0 THEN ok := ok + 1; ELSE fails := fails || 'outro: lê link do owner'; END IF;
  UPDATE public.personal_entity_links SET relation_type = 'supersedes' WHERE id = link_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN ok := ok + 1; ELSE fails := fails || 'outro: atualiza link do owner'; END IF;
  DELETE FROM public.personal_entity_links WHERE id = link_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN ok := ok + 1; ELSE fails := fails || 'outro: apaga link do owner'; END IF;
  BEGIN
    INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id) VALUES (owner_id, 'task', gen_random_uuid(), 'task', gen_random_uuid());
    fails := fails || 'outro: insere em nome do owner';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;

  -- ── anon ─────────────────────────────────────────────────────
  PERFORM set_config('role', 'anon', true);
  BEGIN
    SELECT count(*) INTO n FROM public.personal_entity_links;
    fails := fails || 'anon: lê a tabela';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;

  -- ── service_role (BYPASSRLS, mas sem GRANT) ─────────────────
  PERFORM set_config('role', 'service_role', true);
  BEGIN
    SELECT count(*) INTO n FROM public.personal_entity_links;
    fails := fails || 'service_role: lê a tabela';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;
  BEGIN
    INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id) VALUES (owner_id, 'task', gen_random_uuid(), 'task', gen_random_uuid());
    fails := fails || 'service_role: escreve na tabela';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;

  -- service_role também não lê nenhuma tabela Personal Core (regra preservada)
  BEGIN
    SELECT count(*) INTO n FROM public.personal_tasks;
    fails := fails || 'service_role: lê personal_tasks';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;

  -- ── OWNER apaga ──────────────────────────────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  DELETE FROM public.personal_entity_links WHERE id = link_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'owner: delete'; END IF;

  -- sempre desfaz tudo: o resultado viaja na mensagem de erro
  IF array_length(fails, 1) IS NULL THEN
    RAISE EXCEPTION 'PERSONAL_ENTITY_LINKS_TEST: PASS % checks (rollback automático, nada gravado)', ok;
  ELSE
    RAISE EXCEPTION 'PERSONAL_ENTITY_LINKS_TEST: FAIL % ok / falhas: %', ok, array_to_string(fails, ' | ');
  END IF;
END $$;
