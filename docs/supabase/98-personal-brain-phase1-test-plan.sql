-- ============================================================
-- LOKAT OS — TEST PLAN do SQL 98 · Meu PP V2 · Fase 1
--
-- Executar DEPOIS do SQL 98, como postgres. Bloco único que SEMPRE termina
-- com RAISE EXCEPTION: a mensagem carrega PASS/FAIL e a transação inteira
-- é desfeita (nenhuma linha sobrevive, nenhum usuário criado).
--   OWNER = usuário real existente (só o id; nada dele é lido; tudo desfeito)
--   OUTRO = UUID aleatório só nos JWT claims (sem conta real)
-- ============================================================

DO $$
DECLARE
  owner_id uuid;
  other_id uuid := gen_random_uuid();
  today    date := (now() AT TIME ZONE 'America/Fortaleza')::date;
  r        jsonb;
  task_id  uuid; cap_id uuid; dec_id uuid; dec2_id uuid; old_dec uuid; refl_id uuid;
  n        int;
  ok       int := 0;
  fails    text[] := '{}';
  t        text;
BEGIN
  SELECT id INTO owner_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'TEST_ABORTED: nenhum usuário em auth.users'; END IF;

  -- ── GRANTs (tabelas e funções) ───────────────────────────────
  FOREACH t IN ARRAY ARRAY['personal_quick_captures','personal_reflections','personal_decisions'] LOOP
    IF NOT has_table_privilege('anon', 'public.' || t, 'SELECT') AND NOT has_table_privilege('service_role', 'public.' || t, 'SELECT')
       AND NOT has_table_privilege('service_role', 'public.' || t, 'INSERT') AND has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')
       AND (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass)
    THEN ok := ok + 1; ELSE fails := fails || ('grant/rls: ' || t); END IF;
  END LOOP;
  IF NOT has_function_privilege('anon', 'public.personal_confirm_capture(text,text,text,text,jsonb)', 'EXECUTE')
     AND NOT has_function_privilege('service_role', 'public.personal_confirm_capture(text,text,text,text,jsonb)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.personal_confirm_capture(text,text,text,text,jsonb)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.personal_supersede_decision(uuid,jsonb)', 'EXECUTE')
     AND NOT has_function_privilege('service_role', 'public.personal_supersede_decision(uuid,jsonb)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.personal_supersede_decision(uuid,jsonb)', 'EXECUTE')
  THEN ok := ok + 1; ELSE fails := fails || 'grant: funções'::text; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.personal_confirm_capture(text,text,text,text,jsonb)'::regprocedure) = false
     AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.personal_supersede_decision(uuid,jsonb)'::regprocedure) = false
  THEN ok := ok + 1; ELSE fails := fails || 'funções não podem ser SECURITY DEFINER'::text; END IF;

  -- ── OWNER ────────────────────────────────────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  -- cenário B: captura → tarefa (atômico: tarefa + captura confirmada + link)
  r := public.personal_confirm_capture('Ligar para Marcelo amanhã.', 'text', 'task', 'task',
        jsonb_build_object('title', 'Ligar para Marcelo', 'due_at', (today + 1)::text || 'T09:00:00-03:00'));
  task_id := (r->>'object_id')::uuid; cap_id := (r->>'capture_id')::uuid;
  SELECT count(*) INTO n FROM public.personal_tasks WHERE id = task_id AND title = 'Ligar para Marcelo' AND status = 'pending';
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'B: tarefa criada'::text; END IF;
  SELECT count(*) INTO n FROM public.personal_quick_captures WHERE id = cap_id AND status = 'confirmed' AND confirmed_type = 'task' AND processed_at IS NOT NULL;
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'B: captura confirmada'::text; END IF;
  SELECT count(*) INTO n FROM public.personal_entity_links WHERE source_type = 'task' AND source_id = task_id AND target_type = 'capture' AND target_id = cap_id AND relation_type = 'derived_from';
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'B: link derived_from'::text; END IF;

  -- nota = inbox, sem objeto
  r := public.personal_confirm_capture('Ideia: série de vídeos sobre bastidores', 'text', 'note', 'note', '{}'::jsonb);
  SELECT count(*) INTO n FROM public.personal_quick_captures WHERE id = (r->>'capture_id')::uuid AND status = 'inbox' AND confirmed_type = 'note';
  IF n = 1 AND r->>'object_id' IS NULL THEN ok := ok + 1; ELSE fails := fails || 'nota: inbox sem objeto'::text; END IF;

  -- evento
  r := public.personal_confirm_capture('Dentista às 15h', 'text', 'event', 'event',
        jsonb_build_object('title', 'Dentista', 'starts_at', today::text || 'T15:00:00-03:00', 'event_type', 'compromisso'));
  SELECT count(*) INTO n FROM public.personal_events WHERE id = (r->>'object_id')::uuid AND type = 'compromisso';
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'evento via captura'::text; END IF;

  -- reflexão: duas capturas no mesmo dia = um reflexo diário, texto acumulado
  r := public.personal_confirm_capture('Percebi que o cliente valoriza prazo.', 'text', 'reflection', 'reflection', jsonb_build_object('date', today));
  refl_id := (r->>'object_id')::uuid;
  r := public.personal_confirm_capture('Aprendi a dizer não mais cedo.', 'text', 'reflection', 'reflection', jsonb_build_object('date', today));
  SELECT count(*) INTO n FROM public.personal_reflections WHERE user_id = owner_id AND reflection_date = today AND kind = 'daily' AND text LIKE '%prazo.%' AND text LIKE '%mais cedo.%';
  IF n = 1 AND (r->>'object_id')::uuid = refl_id THEN ok := ok + 1; ELSE fails := fails || 'reflexo diário único e acumulado'::text; END IF;

  -- cenário C: captura → decisão
  r := public.personal_confirm_capture('Decidi não comprar o equipamento agora porque a parcela ultrapassa o limite.', 'text', 'decision', 'decision',
        jsonb_build_object('title', 'Não comprar o equipamento agora', 'rationale', 'a parcela ultrapassa o limite', 'date', today));
  dec_id := (r->>'object_id')::uuid;
  SELECT count(*) INTO n FROM public.personal_decisions WHERE id = dec_id AND status = 'active' AND rationale = 'a parcela ultrapassa o limite';
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'C: decisão criada'::text; END IF;

  -- cenário D: decisão antiga (criada há 3 dias) substituída por nova
  INSERT INTO public.personal_decisions (user_id, title, decision, decided_on, created_at)
  VALUES (owner_id, 'Comprar equipamento', 'Comprar o equipamento X', today - 3, now() - interval '3 days') RETURNING id INTO old_dec;
  dec2_id := public.personal_supersede_decision(old_dec, jsonb_build_object('title', 'Não comprar agora', 'decision', 'Não comprar agora', 'rationale', 'parcela acima do limite', 'date', today));
  SELECT count(*) INTO n FROM public.personal_decisions WHERE id = old_dec AND status = 'superseded' AND decision = 'Comprar o equipamento X';
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'D: antiga preservada como superseded'::text; END IF;
  SELECT count(*) INTO n FROM public.personal_decisions WHERE id = dec2_id AND supersedes_decision_id = old_dec AND status = 'active';
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'D: nova aponta para a antiga'::text; END IF;
  SELECT count(*) INTO n FROM public.personal_entity_links WHERE source_type = 'decision' AND source_id = dec2_id AND target_id = old_dec AND relation_type = 'supersedes';
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'D: link supersedes'::text; END IF;
  BEGIN
    PERFORM public.personal_supersede_decision(old_dec, jsonb_build_object('decision', 'outra', 'date', today));
    fails := fails || 'D: substituir decisão já substituída foi aceito'::text;
  EXCEPTION WHEN invalid_parameter_value THEN ok := ok + 1; END;

  -- imutabilidade prática: após 24h conteúdo não muda; review_at/status sim
  BEGIN
    UPDATE public.personal_decisions SET decision = 'Reescrevendo a história' WHERE id = old_dec;
    fails := fails || 'imutabilidade: conteúdo antigo reescrito'::text;
  EXCEPTION WHEN raise_exception THEN ok := ok + 1; END;
  BEGIN
    UPDATE public.personal_decisions SET status = 'active' WHERE id = old_dec;
    fails := fails || 'imutabilidade: superseded voltou a active'::text;
  EXCEPTION WHEN raise_exception THEN ok := ok + 1; END;
  UPDATE public.personal_decisions SET decision = 'Não comprar o equipamento agora (corrigido)' WHERE id = dec_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'janela de 24h: correção recente permitida'::text; END IF;
  UPDATE public.personal_decisions SET review_at = today, last_reviewed_at = now() WHERE id = dec2_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN ok := ok + 1; ELSE fails := fails || 'revisão (review_at) sempre permitida'::text; END IF;

  -- prioridade do dia (focus_date)
  UPDATE public.personal_tasks SET focus_date = today, sort_order = 1 WHERE id = task_id;
  SELECT count(*) INTO n FROM public.personal_tasks WHERE user_id = owner_id AND focus_date = today;
  IF n >= 1 THEN ok := ok + 1; ELSE fails := fails || 'focus_date'::text; END IF;

  -- constraint de estado da captura
  BEGIN
    INSERT INTO public.personal_quick_captures (user_id, raw_text, status, confirmed_type) VALUES (owner_id, 'x', 'confirmed', 'task');
    fails := fails || 'captura confirmada sem processed_at aceita'::text;
  EXCEPTION WHEN check_violation THEN ok := ok + 1; END;

  -- ── OUTRO usuário ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  SELECT (SELECT count(*) FROM public.personal_quick_captures) + (SELECT count(*) FROM public.personal_reflections WHERE user_id = owner_id)
       + (SELECT count(*) FROM public.personal_decisions WHERE user_id = owner_id) INTO n;
  IF n = 0 THEN ok := ok + 1; ELSE fails := fails || 'outro: lê dados do owner'::text; END IF;
  BEGIN
    PERFORM public.personal_supersede_decision(dec2_id, jsonb_build_object('decision', 'invasão', 'date', today));
    fails := fails || 'outro: substituiu decisão do owner'::text;
  EXCEPTION WHEN no_data_found THEN ok := ok + 1; END;
  UPDATE public.personal_decisions SET review_at = today WHERE id = dec2_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN ok := ok + 1; ELSE fails := fails || 'outro: altera decisão do owner'::text; END IF;

  -- ── anon / service_role ──────────────────────────────────────
  FOREACH t IN ARRAY ARRAY['anon','service_role'] LOOP
    PERFORM set_config('role', t, true);
    BEGIN
      SELECT count(*) INTO n FROM public.personal_decisions;
      fails := fails || (t || ': lê personal_decisions');
    EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;
    BEGIN
      SELECT count(*) INTO n FROM public.personal_reflections;
      fails := fails || (t || ': lê personal_reflections');
    EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;
    BEGIN
      SELECT count(*) INTO n FROM public.personal_quick_captures;
      fails := fails || (t || ': lê personal_quick_captures');
    EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;
    BEGIN
      PERFORM public.personal_confirm_capture('x', 'text', 'note', 'note', '{}'::jsonb);
      fails := fails || (t || ': executa personal_confirm_capture');
    EXCEPTION WHEN insufficient_privilege THEN ok := ok + 1; END;
  END LOOP;

  IF array_length(fails, 1) IS NULL THEN
    RAISE EXCEPTION 'PERSONAL_BRAIN_PHASE1_TEST: PASS % checks (rollback automático, nada gravado)', ok;
  ELSE
    RAISE EXCEPTION 'PERSONAL_BRAIN_PHASE1_TEST: FAIL % ok / falhas: %', ok, array_to_string(fails, ' | ');
  END IF;
END $$;
