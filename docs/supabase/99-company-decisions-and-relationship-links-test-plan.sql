-- ============================================================
-- LOKAT OS — SQL 99 TEST PLAN (transacional, nunca comita)
--
-- Diferente do plano de SQL 91 (que precisou provar RLS cross-company
-- do zero, via impersonação real de role/JWT), este SQL 99 REAPROVEITA
-- can_access_client_company()/can_write_client_company() como caixa
-- preta já auditada -- não repete aquele teste. O que este plano
-- precisa provar de novo é: (1) o trigger de imutabilidade/supersessão
-- de company_decisions funciona como o de personal_decisions (SQL 98)
-- já provou funcionar, adaptado para client_id; (2) os CHECKs novos em
-- commercial_meetings/commercial_proposals/roadmap_items/client_projects
-- realmente aceitam o caso novo e rejeitam o inválido.
--
-- Roda inteiro dentro de BEGIN...ROLLBACK -- nunca persiste nada, nem
-- em caso de falha (qualquer RAISE EXCEPTION aborta a transação). Cria
-- uma Company sintética isolada (nunca usa Duh Lanches/O Pedreirão) --
-- zero dependência de dado real, zero risco de poluir produção mesmo
-- que o ROLLBACK final seja esquecido por engano (qualquer erro no meio
-- já aborta tudo).
--
-- NÃO EXECUTAR em produção sem revisão. Executar manualmente via SQL
-- Editor, inteiro, de uma vez.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_client_id   UUID := gen_random_uuid();
  v_owner_id    UUID := gen_random_uuid();
  v_old_id      UUID;
  v_old_created UUID;
  v_new_id      UUID;
  v_row         RECORD;
  v_failed      BOOLEAN;
BEGIN
  -- Fixture: Company sintética isolada, nunca um client real.
  INSERT INTO public.clients (id, owner_id, company_name, responsible_name, email, phone, instagram, segment, city, plan, status, account_type, platform_status, created_by)
  VALUES (v_client_id, v_owner_id, '__SQL99_TEST_COMPANY__', 'Teste SQL99', 'teste-sql99@example.invalid', '00000000000', '', 'Teste', 'Teste', 'comunidade', 'ativo', 'lokat_client', 'active', v_owner_id);

  RAISE NOTICE 'Fixture criada: client_id=%', v_client_id;

  -- ── TESTE 1: insert simples em company_decisions ──────────────
  INSERT INTO public.company_decisions (client_id, title, decision, origin, client_validation)
  VALUES (v_client_id, '__SQL99_TEST__ Decisão 1', 'Testar o Decision Ledger', 'manual', 'internal')
  RETURNING id INTO v_old_id;

  SELECT * INTO v_row FROM public.company_decisions WHERE id = v_old_id;
  IF v_row.status <> 'active' THEN RAISE EXCEPTION 'TESTE 1 FALHOU: status inicial deveria ser active'; END IF;
  RAISE NOTICE 'TESTE 1 OK: decisão criada, status=active';

  -- ── TESTE 2: edição de conteúdo DENTRO das 24h é permitida ────
  UPDATE public.company_decisions SET title = '__SQL99_TEST__ Decisão 1 (editada)' WHERE id = v_old_id;
  SELECT title INTO v_row FROM public.company_decisions WHERE id = v_old_id;
  IF v_row.title <> '__SQL99_TEST__ Decisão 1 (editada)' THEN
    RAISE EXCEPTION 'TESTE 2 FALHOU: edição dentro de 24h deveria ter sido aplicada';
  END IF;
  RAISE NOTICE 'TESTE 2 OK: edição de conteúdo dentro de 24h permitida';

  -- ── TESTE 3: simula decisão "antiga" (created_at > 24h) e prova
  --    que o trigger BLOQUEIA edição de conteúdo nesse caso ─────
  INSERT INTO public.company_decisions (client_id, title, decision, origin, client_validation, created_at)
  VALUES (v_client_id, '__SQL99_TEST__ Decisão antiga', 'Conteúdo original', 'manual', 'internal', now() - interval '48 hours')
  RETURNING id INTO v_old_created;

  v_failed := false;
  BEGIN
    UPDATE public.company_decisions SET decision = 'Tentando reescrever depois de 24h' WHERE id = v_old_created;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'TESTE 3 FALHOU: edição de conteúdo após 24h deveria ter sido bloqueada pelo trigger';
  END IF;
  RAISE NOTICE 'TESTE 3 OK: trigger bloqueou edição de conteúdo após 24h';

  -- ── TESTE 4: company_supersede_decision() cria nova + marca antiga
  --    como superseded, atomicamente ───────────────────────────
  v_new_id := public.company_supersede_decision(
    v_old_id, v_client_id,
    jsonb_build_object('decision', 'Nova posição depois de reconsiderar', 'origin', 'strategy')
  );

  SELECT status INTO v_row FROM public.company_decisions WHERE id = v_old_id;
  IF v_row.status <> 'superseded' THEN RAISE EXCEPTION 'TESTE 4 FALHOU: decisão antiga deveria estar superseded'; END IF;

  SELECT supersedes_decision_id INTO v_row FROM public.company_decisions WHERE id = v_new_id;
  IF v_row.supersedes_decision_id IS DISTINCT FROM v_old_id THEN
    RAISE EXCEPTION 'TESTE 4 FALHOU: nova decisão deveria referenciar supersedes_decision_id=%', v_old_id;
  END IF;
  RAISE NOTICE 'TESTE 4 OK: supersessão atômica funcionou (old=superseded, new.supersedes_decision_id=old)';

  -- ── TESTE 5: supersede de novo a mesma decisão antiga deve falhar
  --    (já não está active) ──────────────────────────────────
  v_failed := false;
  BEGIN
    PERFORM public.company_supersede_decision(v_old_id, v_client_id, jsonb_build_object('decision', 'segunda tentativa'));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 5 FALHOU: supersede de uma decisão já superseded deveria falhar'; END IF;
  RAISE NOTICE 'TESTE 5 OK: supersede duplicado rejeitado';

  -- ── TESTE 6: reverter manualmente superseded -> active deve falhar
  v_failed := false;
  BEGIN
    UPDATE public.company_decisions SET status = 'active' WHERE id = v_old_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 6 FALHOU: reativar uma decisão superseded deveria ser bloqueado'; END IF;
  RAISE NOTICE 'TESTE 6 OK: trigger impediu reativação manual';

  -- ── TESTE 7: commercial_meetings/proposals — CHECK lead_id/client_id
  v_failed := false;
  BEGIN
    INSERT INTO public.commercial_meetings (title, scheduled_at) VALUES ('__SQL99_TEST__ sem lead nem client', now());
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 7 FALHOU: meeting sem lead_id nem client_id deveria ser rejeitada'; END IF;

  INSERT INTO public.commercial_meetings (title, scheduled_at, client_id) VALUES ('__SQL99_TEST__ reunião pós-venda', now(), v_client_id);
  RAISE NOTICE 'TESTE 7 OK: CHECK rejeita ambos nulos, aceita client_id sozinho (reunião pós-venda)';

  v_failed := false;
  BEGIN
    INSERT INTO public.commercial_proposals (title) VALUES ('__SQL99_TEST__ sem lead nem client');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 7b FALHOU: proposta sem lead_id nem client_id deveria ser rejeitada'; END IF;

  INSERT INTO public.commercial_proposals (title, client_id) VALUES ('__SQL99_TEST__ proposta de upsell', v_client_id);
  RAISE NOTICE 'TESTE 7b OK: CHECK rejeita ambos nulos, aceita client_id sozinho (proposta de upsell)';

  -- ── TESTE 8: roadmap_items — planning_stage/horizon enums ─────
  v_failed := false;
  BEGIN
    INSERT INTO public.roadmap_items (client_id, title, planning_stage) VALUES (v_client_id, '__SQL99_TEST__', 'estado_invalido');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 8 FALHOU: planning_stage inválido deveria ser rejeitado'; END IF;

  INSERT INTO public.roadmap_items (client_id, title, planning_stage, horizon)
  VALUES (v_client_id, '__SQL99_TEST__ próxima janela', 'pre_planning', 'next_window');
  RAISE NOTICE 'TESTE 8 OK: planning_stage/horizon aceitam valores válidos, rejeitam inválidos';

  -- ── TESTE 9: client_projects.scope_category ───────────────────
  v_failed := false;
  BEGIN
    INSERT INTO public.client_projects (client_id, title, scope_category) VALUES (v_client_id, '__SQL99_TEST__', 'categoria_invalida');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 9 FALHOU: scope_category inválida deveria ser rejeitada'; END IF;

  INSERT INTO public.client_projects (client_id, title) VALUES (v_client_id, '__SQL99_TEST__ projeto padrão');
  SELECT scope_category INTO v_row FROM public.client_projects WHERE client_id = v_client_id AND title = '__SQL99_TEST__ projeto padrão';
  IF v_row.scope_category <> 'contratado' THEN RAISE EXCEPTION 'TESTE 9 FALHOU: default deveria ser contratado'; END IF;
  RAISE NOTICE 'TESTE 9 OK: scope_category default=contratado, rejeita valor fora do enum';

  RAISE NOTICE '✅ TODOS OS TESTES PASSARAM — fazendo ROLLBACK (nada será persistido)';
END $$;

ROLLBACK;
