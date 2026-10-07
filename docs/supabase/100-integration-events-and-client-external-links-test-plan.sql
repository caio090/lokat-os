-- ============================================================
-- LOKAT OS — SQL 100 TEST PLAN (transacional, nunca comita)
-- Mesmo espírito do test plan de SQL 99: roda inteiro dentro de
-- BEGIN...ROLLBACK, cria uma Company sintética isolada, nunca toca
-- dado real. Prova: (1) idempotência via chave composta
-- "source_system:event_id" sobre o UNIQUE global já existente em
-- idempotency_key, sem precisar alterar essa constraint; (2)
-- client_external_links.unique(source_system, external_id); (3) CHECK
-- de status novo.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_client_id UUID := gen_random_uuid();
  v_owner_id  UUID := gen_random_uuid();
  v_failed    BOOLEAN;
BEGIN
  INSERT INTO public.clients (id, owner_id, company_name, responsible_name, email, phone, instagram, segment, city, plan, status, account_type, platform_status, created_by)
  VALUES (v_client_id, v_owner_id, '__SQL100_TEST_COMPANY__', 'Teste SQL100', 'teste-sql100@example.invalid', '00000000000', '', 'Teste', 'Teste', 'comunidade', 'ativo', 'lokat_client', 'active', v_owner_id);

  -- ── TESTE 1: idempotência via chave composta "source_system:event_id" ──
  INSERT INTO public.integration_webhook_events (provider, event_type, idempotency_key, client_id, status, payload_sanitized)
  VALUES ('tayannara-brain', 'UPSELL_INTERESTED', 'tayannara-brain:evt_test_001', v_client_id, 'received', '{}'::jsonb);
  RAISE NOTICE 'TESTE 1a OK: primeiro evento gravado';

  v_failed := false;
  BEGIN
    INSERT INTO public.integration_webhook_events (provider, event_type, idempotency_key, client_id, status, payload_sanitized)
    VALUES ('tayannara-brain', 'UPSELL_INTERESTED', 'tayannara-brain:evt_test_001', v_client_id, 'received', '{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 1b FALHOU: o mesmo event_id do mesmo source_system deveria violar o UNIQUE'; END IF;
  RAISE NOTICE 'TESTE 1b OK: evento duplicado (mesmo source_system+event_id) rejeitado pelo UNIQUE global em idempotency_key';

  -- mesmo event_id, OUTRO source_system -- precisa funcionar (chave composta é diferente)
  INSERT INTO public.integration_webhook_events (provider, event_type, idempotency_key, client_id, status, payload_sanitized)
  VALUES ('outro-sistema', 'UPSELL_INTERESTED', 'outro-sistema:evt_test_001', v_client_id, 'received', '{}'::jsonb);
  RAISE NOTICE 'TESTE 1c OK: mesmo event_id de OUTRO source_system não colide -- chave composta funciona como isolamento por provider';

  -- ── TESTE 2: status novo (CHECK) ──
  v_failed := false;
  BEGIN
    INSERT INTO public.integration_webhook_events (provider, event_type, idempotency_key, status, payload_sanitized)
    VALUES ('tayannara-brain', 'UPSELL_INTERESTED', 'tayannara-brain:evt_test_002', 'estado_invalido', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 2 FALHOU: status fora do enum deveria ser rejeitado'; END IF;
  RAISE NOTICE 'TESTE 2 OK: CHECK de status rejeita valor inválido';

  INSERT INTO public.integration_webhook_events (provider, event_type, idempotency_key, status, payload_sanitized)
  VALUES ('tayannara-brain', 'UPSELL_INTERESTED', 'tayannara-brain:evt_test_003', 'ignored', '{}'::jsonb);
  RAISE NOTICE 'TESTE 2b OK: status=ignored (novo valor desta fase) aceito';

  -- ── TESTE 3: client_external_links ──
  INSERT INTO public.client_external_links (client_id, source_system, external_id)
  VALUES (v_client_id, 'tayannara-brain', 'tayannara-carvalho');
  RAISE NOTICE 'TESTE 3a OK: link externo criado';

  v_failed := false;
  BEGIN
    INSERT INTO public.client_external_links (client_id, source_system, external_id)
    VALUES (v_client_id, 'tayannara-brain', 'tayannara-carvalho');
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 3b FALHOU: (source_system, external_id) duplicado deveria violar UNIQUE'; END IF;
  RAISE NOTICE 'TESTE 3b OK: mesmo (source_system, external_id) rejeitado -- nunca aponta para dois clients';

  RAISE NOTICE '✅ TODOS OS TESTES PASSARAM — fazendo ROLLBACK (nada será persistido)';
END $$;

ROLLBACK;
