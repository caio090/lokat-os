-- ============================================================
-- LOKAT OS — SQL 101 TEST PLAN (transacional, nunca comita)
-- Mesmo espírito dos test plans de SQL 99/100: BEGIN...ROLLBACK,
-- Company sintética isolada, nunca toca dado real.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_client_id      UUID := gen_random_uuid();
  v_owner_id       UUID := gen_random_uuid();
  v_onboarding_id  UUID;
  v_item_a_id      UUID;
  v_item_b_id      UUID;
  v_meeting_id     UUID;
  v_project_id     UUID;
  v_failed         BOOLEAN;
BEGIN
  INSERT INTO public.clients (id, owner_id, company_name, responsible_name, email, phone, instagram, segment, city, plan, status, account_type, platform_status, created_by)
  VALUES (v_client_id, v_owner_id, '__SQL101_TEST_COMPANY__', 'Teste SQL101', 'teste-sql101@example.invalid', '00000000000', '', 'Teste', 'Teste', 'comunidade', 'onboarding', 'lokat_client', 'active', v_owner_id);

  -- ── TESTE 1: catálogo de templates + itens padrão ──────────────
  INSERT INTO public.client_onboarding_templates (code, label) VALUES ('__SQL101_TEST_MARKETING__', 'Marketing (teste)');
  INSERT INTO public.client_onboarding_template_items (template_code, item_key, category, label, responsible_side, is_required_for_kickoff)
  VALUES ('__SQL101_TEST_MARKETING__', 'contrato_confirmado', 'Comercial', 'Contrato confirmado', 'LOKAT', true);
  RAISE NOTICE 'TESTE 1 OK: template + item padrão criados';

  v_failed := false;
  BEGIN
    INSERT INTO public.client_onboarding_template_items (template_code, item_key, label, responsible_side)
    VALUES ('__SQL101_TEST_MARKETING__', 'contrato_confirmado', 'Duplicado', 'LOKAT');
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 1b FALHOU: (template_code, item_key) duplicado deveria violar UNIQUE'; END IF;
  RAISE NOTICE 'TESTE 1b OK: item_key duplicado no mesmo template rejeitado';

  -- ── TESTE 2: client_onboardings ──────────────────────────────
  INSERT INTO public.client_onboardings (client_id, status, template_codes, created_from)
  VALUES (v_client_id, 'IN_PROGRESS', ARRAY['__SQL101_TEST_MARKETING__'], 'commercial_handoff')
  RETURNING id INTO v_onboarding_id;
  RAISE NOTICE 'TESTE 2 OK: onboarding criado, status=IN_PROGRESS';

  v_failed := false;
  BEGIN
    INSERT INTO public.client_onboardings (client_id, status) VALUES (v_client_id, 'ESTADO_INVALIDO');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 2b FALHOU: status inválido deveria ser rejeitado'; END IF;
  RAISE NOTICE 'TESTE 2b OK: CHECK de status rejeita valor fora do enum';

  -- ── TESTE 3: client_onboarding_items (responsible_side/status/visibility, dependência) ──
  INSERT INTO public.client_onboarding_items (onboarding_id, item_key, label, responsible_side, status, visibility, is_required_for_kickoff)
  VALUES (v_onboarding_id, 'contrato_confirmado', 'Contrato confirmado', 'LOKAT', 'COMPLETED', 'INTERNAL_ONLY', true)
  RETURNING id INTO v_item_a_id;

  INSERT INTO public.client_onboarding_items (onboarding_id, item_key, label, responsible_side, status, visibility, depends_on_item_id)
  VALUES (v_onboarding_id, 'logo_recebido', 'Logo recebido', 'CLIENT', 'PENDING', 'CLIENT_ACTION_REQUIRED', v_item_a_id)
  RETURNING id INTO v_item_b_id;
  RAISE NOTICE 'TESTE 3 OK: 2 itens criados, um dependendo do outro';

  v_failed := false;
  BEGIN
    UPDATE public.client_onboarding_items SET depends_on_item_id = v_item_b_id WHERE id = v_item_b_id;
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 3b FALHOU: item não pode depender de si mesmo'; END IF;
  RAISE NOTICE 'TESTE 3b OK: auto-dependência rejeitada';

  v_failed := false;
  BEGIN
    INSERT INTO public.client_onboarding_items (onboarding_id, label, responsible_side) VALUES (v_onboarding_id, 'Item inválido', 'EXTERNO');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 3c FALHOU: responsible_side fora do enum deveria ser rejeitado'; END IF;
  RAISE NOTICE 'TESTE 3c OK: responsible_side inválido rejeitado';

  -- ── TESTE 3e (FASE 1C.1): dois itens com o MESMO item_key no MESMO
  -- onboarding são rejeitados (UNIQUE) -- defesa em profundidade além
  -- do merge feito na aplicação (mergeTemplateItems). source_templates
  -- aceita um array de códigos de template. ──
  v_failed := false;
  BEGIN
    INSERT INTO public.client_onboarding_items (onboarding_id, item_key, label, responsible_side, source_templates)
    VALUES (v_onboarding_id, 'contrato_confirmado', 'Duplicado no mesmo onboarding', 'LOKAT', ARRAY['__SQL101_TEST_MARKETING__', '__SQL101_TEST_SOCIAL__']);
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'TESTE 3e FALHOU: item_key duplicado no mesmo onboarding deveria violar UNIQUE(onboarding_id, item_key)'; END IF;
  RAISE NOTICE 'TESTE 3e OK: item_key duplicado no mesmo onboarding rejeitado (defesa em profundidade do merge de templates)';

  -- cascade: apagar o onboarding apaga os itens
  DELETE FROM public.client_onboardings WHERE id = v_onboarding_id;
  IF EXISTS (SELECT 1 FROM public.client_onboarding_items WHERE id IN (v_item_a_id, v_item_b_id)) THEN
    RAISE EXCEPTION 'TESTE 3d FALHOU: itens deveriam ter sido removidos em cascata';
  END IF;
  RAISE NOTICE 'TESTE 3d OK: ON DELETE CASCADE de onboarding -> itens funciona';

  -- recria pra continuar os testes seguintes
  INSERT INTO public.client_onboardings (client_id, status) VALUES (v_client_id, 'IN_PROGRESS') RETURNING id INTO v_onboarding_id;

  -- ── TESTE 4: commercial_meetings.onboarding_id / is_alignment_meeting ──
  INSERT INTO public.commercial_meetings (title, scheduled_at, client_id, onboarding_id, is_alignment_meeting)
  VALUES ('__SQL101_TEST__ Reunião de alinhamento', now(), v_client_id, v_onboarding_id, true)
  RETURNING id INTO v_meeting_id;
  RAISE NOTICE 'TESTE 4 OK: reunião de alinhamento vinculada ao onboarding';

  -- ── TESTE 5: client_projects -- campos novos + onboarding_id ──
  INSERT INTO public.client_projects (client_id, title, project_type, current_phase, owner_id, next_action, onboarding_id, scope_category)
  VALUES (v_client_id, 'Outlet Mulheres Empreendedoras', 'SITE', 'Planejamento', v_owner_id, 'Validar acesso Meta Ads', v_onboarding_id, 'contratado')
  RETURNING id INTO v_project_id;
  RAISE NOTICE 'TESTE 5 OK: projeto criado com campos de jornada (seção 19) + ligado ao onboarding (seção 17)';

  UPDATE public.client_projects SET blocked_reason = 'Aguardando domínio do cliente' WHERE id = v_project_id;
  RAISE NOTICE 'TESTE 5b OK: blocked_reason gravável (presença = bloqueio)';

  RAISE NOTICE '✅ TODOS OS TESTES PASSARAM — fazendo ROLLBACK (nada será persistido)';
END $$;

ROLLBACK;
