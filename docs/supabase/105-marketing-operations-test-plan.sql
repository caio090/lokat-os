-- Plano de testes da 105. Rodar SÓ em banco de teste/branch (cria fixtures),
-- depois da 105. Tudo dentro de uma transação que termina em ROLLBACK.
-- Falha com EXCEPTION na primeira regra violada; sucesso imprime NOTICE final.
-- Executado em 2026-11-22 com PGlite (Postgres 18) + stubs de auth/tabelas base.

BEGIN;

-- Fixtures: dois clientes, um gestor com acesso só ao cliente A, um admin com
-- acesso a A e B, um usuário-cliente de B.
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO public.clients (id) VALUES
  ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
INSERT INTO public.profiles (id, role, client_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'gestor_trafego', NULL),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', NULL),
  ('00000000-0000-0000-0000-0000000000b1', 'cliente', '22222222-2222-2222-2222-222222222222');
INSERT INTO public.client_user_access (user_id, client_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', '22222222-2222-2222-2222-222222222222', 'active');

-- Dados de B criados pelo servidor.
SET LOCAL request.jwt.claim.role = 'service_role';
INSERT INTO public.mkt_funnels (id, client_id, name) VALUES ('f0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Funil B');
INSERT INTO public.mkt_leads (id, client_id, name, email) VALUES ('1e000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Lead B', 'b@exemplo.com');
RESET request.jwt.claim.role;

-- ── Gestor de tráfego (acesso só a A) ──
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
SET LOCAL request.jwt.claim.role = 'authenticated';

DO $$ BEGIN
  IF (SELECT count(*) FROM public.mkt_funnels) <> 0 THEN RAISE EXCEPTION 'T1: gestor de A enxerga funil de B'; END IF;
  IF (SELECT count(*) FROM public.mkt_leads) <> 0 THEN RAISE EXCEPTION 'T1: gestor de A enxerga lead de B'; END IF;
END $$;

INSERT INTO public.mkt_funnels (id, client_id, name, framework) VALUES ('f0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Funil A', 'brunson_funnel');
INSERT INTO public.mkt_funnel_stages (client_id, funnel_id, position, stage_key, name, kind)
  VALUES ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', 1, 'captura', 'Captura', 'captura');

DO $$ BEGIN
  BEGIN
    INSERT INTO public.mkt_funnels (client_id, name) VALUES ('22222222-2222-2222-2222-222222222222', 'invasão');
    RAISE EXCEPTION 'T2: gestor de A conseguiu escrever em B';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Campanha nasce rascunho; não pode nascer aprovada/publicada.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.mkt_campaigns (client_id, channel, name, status) VALUES ('11111111-1111-1111-1111-111111111111', 'meta', 'x', 'publicada');
    RAISE EXCEPTION 'T3: campanha nasceu publicada';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO public.mkt_campaigns (id, client_id, channel, name, funnel_id, budget_type, budget_amount, currency)
  VALUES ('c0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'meta', 'Captação A', 'f0000000-0000-0000-0000-00000000000a', 'diario', 50, 'BRL');

-- Integridade: campanha de A não aponta para funil de B (FK composta).
DO $$ BEGIN
  BEGIN
    UPDATE public.mkt_campaigns SET funnel_id = 'f0000000-0000-0000-0000-00000000000b' WHERE id = 'c0000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'T4: campanha de A ligada a funil de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

-- Fluxo: gestor envia para revisão, mas não aprova nem publica.
UPDATE public.mkt_campaigns SET status = 'em_revisao' WHERE id = 'c0000000-0000-0000-0000-00000000000a';
DO $$ BEGIN
  IF (SELECT submitted_by FROM public.mkt_campaigns WHERE id = 'c0000000-0000-0000-0000-00000000000a') <> '00000000-0000-0000-0000-0000000000a1'
    THEN RAISE EXCEPTION 'T5: submitted_by não carimbado'; END IF;
  BEGIN
    UPDATE public.mkt_campaigns SET status = 'aprovada' WHERE id = 'c0000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'T5: gestor aprovou';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.mkt_campaigns SET status = 'publicada' WHERE id = 'c0000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'T5: gestor publicou';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.mkt_campaigns SET approved_by = '00000000-0000-0000-0000-0000000000a1' WHERE id = 'c0000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'T5: approved_by escrito à mão';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- ── Admin aprova ──
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
UPDATE public.mkt_campaigns SET status = 'aprovada' WHERE id = 'c0000000-0000-0000-0000-00000000000a';
DO $$ BEGIN
  IF (SELECT approved_by FROM public.mkt_campaigns WHERE id = 'c0000000-0000-0000-0000-00000000000a') <> '00000000-0000-0000-0000-0000000000a2'
    THEN RAISE EXCEPTION 'T6: approved_by não carimbado'; END IF;
  BEGIN
    UPDATE public.mkt_campaigns SET status = 'publicada' WHERE id = 'c0000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'T6: admin publicou pelo navegador (precisa ser servidor)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.mkt_campaigns SET activation_authorized_at = now() WHERE id = 'c0000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'T6: veiculação autorizada antes de publicar';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Editar orçamento de campanha aprovada devolve para rascunho.
UPDATE public.mkt_campaigns SET budget_amount = 80 WHERE id = 'c0000000-0000-0000-0000-00000000000a';
DO $$ BEGIN
  IF (SELECT status FROM public.mkt_campaigns WHERE id = 'c0000000-0000-0000-0000-00000000000a') <> 'rascunho'
    THEN RAISE EXCEPTION 'T7: edição de aprovada não voltou para rascunho'; END IF;
END $$;
UPDATE public.mkt_campaigns SET status = 'em_revisao' WHERE id = 'c0000000-0000-0000-0000-00000000000a';
UPDATE public.mkt_campaigns SET status = 'aprovada' WHERE id = 'c0000000-0000-0000-0000-00000000000a';

-- ── Servidor publica (criada PAUSADA na plataforma) ──
RESET ROLE;
SET LOCAL request.jwt.claim.role = 'service_role';
UPDATE public.mkt_campaigns SET status = 'publicada', external_id = '120000000000001', platform_status = 'PAUSED'
  WHERE id = 'c0000000-0000-0000-0000-00000000000a';
DO $$ BEGIN
  IF (SELECT published_at FROM public.mkt_campaigns WHERE id = 'c0000000-0000-0000-0000-00000000000a') IS NULL
    THEN RAISE EXCEPTION 'T8: published_at não carimbado'; END IF;
  BEGIN
    UPDATE public.mkt_campaigns SET activation_authorized_at = now() WHERE id = 'c0000000-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'T8: servidor autorizou veiculação sozinho';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- ── Admin autoriza veiculação (ato humano) ──
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
UPDATE public.mkt_campaigns SET activation_authorized_at = now() WHERE id = 'c0000000-0000-0000-0000-00000000000a';
DO $$ BEGIN
  IF (SELECT activation_authorized_by FROM public.mkt_campaigns WHERE id = 'c0000000-0000-0000-0000-00000000000a') <> '00000000-0000-0000-0000-0000000000a2'
    THEN RAISE EXCEPTION 'T9: autorização não registrou quem autorizou'; END IF;
  IF (SELECT count(*) FROM public.mkt_funnels) <> 2 THEN RAISE EXCEPTION 'T9: admin com acesso a A e B deveria ver 2 funis'; END IF;
END $$;

-- ── Usuário-cliente de B: lê só B, não escreve ──
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mkt_funnels) <> 1 THEN RAISE EXCEPTION 'T10: cliente B deveria ver só o próprio funil'; END IF;
  IF (SELECT count(*) FROM public.mkt_campaigns) <> 0 THEN RAISE EXCEPTION 'T10: cliente B vê campanha de A'; END IF;
  BEGIN
    INSERT INTO public.mkt_funnels (client_id, name) VALUES ('22222222-2222-2222-2222-222222222222', 'cliente escrevendo');
    RAISE EXCEPTION 'T10: cliente conseguiu escrever';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- ── Anônimo não lê nada ──
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.mkt_leads LIMIT 1;
    RAISE EXCEPTION 'T11: anon leu mkt_leads';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- ── Deduplicação de evento (Pixel × CAPI com mesmo event_id) ──
RESET ROLE;
SET LOCAL request.jwt.claim.role = 'service_role';
INSERT INTO public.mkt_conversion_events (client_id, event_key, source, external_event_id, occurred_at, value, currency)
  VALUES ('11111111-1111-1111-1111-111111111111', 'lead', 'meta_pixel', 'evt-1', now(), NULL, NULL);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.mkt_conversion_events (client_id, event_key, source, external_event_id, occurred_at)
      VALUES ('11111111-1111-1111-1111-111111111111', 'lead', 'meta_capi', 'evt-1', now());
    RAISE EXCEPTION 'T12: evento duplicado aceito';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.mkt_conversion_events (client_id, event_key, source, occurred_at, value)
      VALUES ('11111111-1111-1111-1111-111111111111', 'purchase', 'crm', now(), 100);
    RAISE EXCEPTION 'T12: valor sem moeda aceito';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$ BEGIN RAISE NOTICE '105 test plan: todos os testes passaram'; END $$;
ROLLBACK;
