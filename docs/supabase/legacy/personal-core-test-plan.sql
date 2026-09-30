-- ============================================================
-- LOKAT OS — LEGACY BASELINE · PERSONAL CORE · TEST PLAN (histórico)
-- Roteiro manual de verificação da fundação Personal Core, aplicada em
-- produção em 13/08/2026. SQL "93-96" citado abaixo =
-- legacy/personal-core-{tasks,routines,gratitude,events}.sql.
-- Só leitura/transações com ROLLBACK; requer dois usuários de TESTE.
-- Documento canônico: docs/meu-pp/README.md
-- ============================================================
--
-- ============================================================
-- LOKAT OS — TEST PLAN: Personal Core Foundation (SQL 93-96)
-- Fase 1A.3 do Personal Strategy OS (privilege gate).
--
-- NÃO É PARA EXECUTAR AUTOMATICAMENTE. Roteiro de verificação manual
-- para rodar DEPOIS dos SQL 93-96 serem aplicados (e SOMENTE depois).
-- Este arquivo testa SOMENTE o que é verificável no banco: schema,
-- constraints, FKs, RLS, GRANTs de tabela, isolamento cross-user,
-- UNIQUE, CHECK, CRUD via SQL. Ele NÃO testa (e não pode testar)
-- classifyQuickCapture(), transcrição de voz, preview de UI, ou
-- cancelamento de UI -- ver seção "APP TESTS — FUTURE" no final,
-- claramente marcada como não executada por este SQL.
--
-- ─────────────────────────────────────────────────────────────
-- DUAS CAMADAS INDEPENDENTES: GRANT DE TABELA + RLS
-- ─────────────────────────────────────────────────────────────
-- Desde a Fase 1A.3, as 5 tabelas têm GRANT/REVOKE explícito (ver
-- cabeçalho de docs/supabase/93-personal-core-tasks.sql): anon e
-- service_role foram REVOGADOS por completo (não é mais "RLS nega por
-- padrão", é "a operação nem é permitida na tabela"), authenticated
-- recebeu só SELECT/INSERT/UPDATE/DELETE. O Bloco 5 abaixo testa as
-- DUAS camadas separadamente: primeiro o GRANT (has_table_privilege,
-- nem chega a tentar uma query), depois o RLS (isolamento de linha
-- entre Alfa/Beta). Nenhum teste de isolamento usa service role para
-- "provar" RLS -- service role ignoraria RLS de qualquer forma
-- (BYPASSRLS); com o REVOKE desta fase, service role agora nem passa da
-- primeira camada, o que o Bloco 5.3 verifica diretamente.
--
-- ─────────────────────────────────────────────────────────────
-- COMO SIMULAR DOIS USUÁRIOS (Alfa/Beta) NO SQL EDITOR
-- ─────────────────────────────────────────────────────────────
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claims" = '{"sub":"<ALFA_USER_ID>","role":"authenticated"}';
--   -- auth.uid() dentro desta transação retorna <ALFA_USER_ID>
--   -- rodar as queries do Bloco 1-4 como Alfa aqui
--   ROLLBACK;  -- ou COMMIT se o teste for de escrita real controlada
-- Repetir trocando "sub" para <BETA_USER_ID> para os testes de
-- isolamento cross-user. Alfa e Beta precisam ser dois usuários reais de
-- teste (auth.users), nunca contas de produção.
--
-- ─────────────────────────────────────────────────────────────
-- PRÉ-REQUISITO IMPLÍCITO — public.set_updated_at()
-- ─────────────────────────────────────────────────────────────
-- Os 4 arquivos forward (93-96) já falham alto e claro na aplicação se
-- public.set_updated_at() não existir (DO block no início de cada um,
-- RAISE EXCEPTION com mensagem explícita) -- não há necessidade de um
-- teste separado aqui: se você chegou a rodar os testes abaixo, a
-- migration já validou isso sozinha ao ser aplicada.
-- ============================================================

-- ── Bloco 1 — personal_tasks ──────────────────────────────────

-- 1.1 Alfa: create own → sucesso.
-- INSERT INTO public.personal_tasks (user_id, title) VALUES (auth.uid(), 'Comprar tripé');

-- 1.2 Alfa: read own → retorna a linha criada.
-- SELECT * FROM public.personal_tasks WHERE user_id = auth.uid();

-- 1.3 Alfa: update own (status/priority/sort_order) → sucesso.
-- UPDATE public.personal_tasks SET status = 'done', completed_at = now() WHERE user_id = auth.uid();

-- 1.4 Alfa: delete own → sucesso.
-- DELETE FROM public.personal_tasks WHERE user_id = auth.uid() AND status = 'done';

-- 1.5 Alfa: tentar INSERT com user_id de Beta (impersonando Alfa) → DEVE FALHAR (WITH CHECK).
-- INSERT INTO public.personal_tasks (user_id, title) VALUES ('<BETA_USER_ID>', 'Tarefa forjada');

-- 1.6 Alfa: SELECT de tarefas de Beta → 0 linhas (nunca erro).
-- SELECT * FROM public.personal_tasks WHERE user_id = '<BETA_USER_ID>';

-- 1.7 Alfa: UPDATE/DELETE em linha de Beta (por id conhecido) → 0 linhas afetadas.
-- UPDATE public.personal_tasks SET status = 'done' WHERE id = '<BETA_TASK_ID>';

-- 1.8 related_entity_type fora da allowlist → DEVE FALHAR (CHECK).
-- INSERT INTO public.personal_tasks (user_id, title, related_entity_type) VALUES (auth.uid(), 'X', 'content_item');

-- 1.9 priority fora do enum → DEVE FALHAR (CHECK).
-- INSERT INTO public.personal_tasks (user_id, title, priority) VALUES (auth.uid(), 'X', 'urgent');

-- 1.10 Fase 1A.2 — status='postponed' NÃO é mais válido em personal_tasks → DEVE FALHAR (CHECK).
-- INSERT INTO public.personal_tasks (user_id, title, status) VALUES (auth.uid(), 'X', 'postponed');
-- -- esperado: erro de CHECK -- só 'pending'/'done' são válidos agora. "Adiar" = PATCH due_at, ver 93.

-- 1.11 Regra das 3 prioridades (query documentada no fim de 93-personal-core-tasks.sql) --
--      confirmar manualmente com dados de teste que uma tarefa ATRASADA aparece antes de uma
--      tarefa futura com priority='high':
-- INSERT INTO public.personal_tasks (user_id, title, due_at, priority) VALUES (auth.uid(), 'Atrasada sem prioridade', now() - interval '2 days', NULL);
-- INSERT INTO public.personal_tasks (user_id, title, due_at, priority) VALUES (auth.uid(), 'Futura importante', now() + interval '20 days', 'high');
-- -- rodar a query documentada em 93 com :start_of_today/:start_of_tomorrow = hoje real -- esperado:
-- -- "Atrasada sem prioridade" aparece ANTES de "Futura importante" (camada 0 vence camada 2, mesmo com priority menor).

-- ── Bloco 2 — personal_routines + personal_routine_entries ───

-- 2.1 Alfa: criar rotina diária → sucesso.
-- INSERT INTO public.personal_routines (user_id, name, frequency_type) VALUES (auth.uid(), 'Estudo', 'daily');

-- 2.2 Alfa: criar rotina 'daily' COM days_of_week preenchido → DEVE FALHAR (chk_personal_routines_frequency_shape).
-- INSERT INTO public.personal_routines (user_id, name, frequency_type, days_of_week) VALUES (auth.uid(), 'X', 'daily', ARRAY[1,3]);

-- 2.3 Alfa: criar rotina 'weekly' com 2 dias → DEVE FALHAR (weekly exige exatamente 1).
-- INSERT INTO public.personal_routines (user_id, name, frequency_type, days_of_week) VALUES (auth.uid(), 'X', 'weekly', ARRAY[1,3]);

-- 2.4 Alfa: criar rotina 'weekly' com 1 dia → sucesso.
-- INSERT INTO public.personal_routines (user_id, name, frequency_type, days_of_week) VALUES (auth.uid(), 'Revisão semanal', 'weekly', ARRAY[1]);

-- 2.5 Alfa: criar rotina 'monthly' sem day_of_month → DEVE FALHAR.
-- INSERT INTO public.personal_routines (user_id, name, frequency_type) VALUES (auth.uid(), 'X', 'monthly');

-- 2.6 Alfa: criar rotina 'monthly' com day_of_month=15 → sucesso.
-- INSERT INTO public.personal_routines (user_id, name, frequency_type, day_of_month) VALUES (auth.uid(), 'Revisão financeira', 'monthly', 15);

-- 2.7 Alfa: days_of_week com valor fora de 0..6 → DEVE FALHAR.
-- INSERT INTO public.personal_routines (user_id, name, frequency_type, days_of_week) VALUES (auth.uid(), 'X', 'specific_days', ARRAY[1,7]);

-- 2.8 Alfa: days_of_week com duplicado → aceito (duplicado não é validado no banco, é
--     inofensivo -- ver comentário na coluna em 94; a API deve deduplicar antes de gravar).
-- INSERT INTO public.personal_routines (user_id, name, frequency_type, days_of_week) VALUES (auth.uid(), 'X', 'specific_days', ARRAY[1,1,3]);
-- -- esperado: sucesso (não é um teste de falha).

-- 2.9 Alfa: marcar ocorrência de hoje como 'done' com completed_at → sucesso.
-- INSERT INTO public.personal_routine_entries (routine_id, user_id, entry_date, status, completed_at)
--   VALUES ('<ROUTINE_ID>', auth.uid(), current_date, 'done', now());
-- -- nota: current_date aqui é só ilustrativo do teste manual em SQL -- a aplicação real
-- -- NUNCA usa CURRENT_DATE do Postgres, sempre getFortalezaToday() (ver 95).

-- 2.10 Alfa: tentar inserir entry com status='pending' → DEVE FALHAR (CHECK só aceita done/postponed).
-- INSERT INTO public.personal_routine_entries (routine_id, user_id, entry_date, status) VALUES ('<ROUTINE_ID>', auth.uid(), current_date + 1, 'pending');

-- 2.11 Fase 1A.2 — status='postponed' COM completed_at preenchido → DEVE FALHAR
--      (chk_personal_routine_entries_completed_at).
-- INSERT INTO public.personal_routine_entries (routine_id, user_id, entry_date, status, completed_at)
--   VALUES ('<ROUTINE_ID>', auth.uid(), current_date + 2, 'postponed', now());
-- -- esperado: erro de CHECK -- postponed nunca tem completed_at.

-- 2.12 Alfa: status='postponed' SEM completed_at → sucesso.
-- INSERT INTO public.personal_routine_entries (routine_id, user_id, entry_date, status)
--   VALUES ('<ROUTINE_ID>', auth.uid(), current_date + 2, 'postponed');

-- 2.13 Confirmar que NENHUMA linha existe para uma data sem marcação (estado reinicia por
--      ausência de linha, não por status).
-- SELECT * FROM public.personal_routine_entries WHERE routine_id = '<ROUTINE_ID>' AND entry_date = current_date + 3;
-- -- esperado: 0 linhas.

-- 2.14 Alfa: "desfazer" a marcação de hoje → DELETE da linha (nunca UPDATE para 'pending' inexistente).
-- DELETE FROM public.personal_routine_entries WHERE routine_id = '<ROUTINE_ID>' AND entry_date = current_date;

-- 2.15 CRÍTICO — Alfa: tentar inserir entry para uma rotina de Beta, com user_id=Alfa → DEVE FALHAR
--      NO BANCO (FK composta fk_personal_routine_entries_owner), não só por RLS.
-- INSERT INTO public.personal_routine_entries (routine_id, user_id, entry_date, status)
--   VALUES ('<BETA_ROUTINE_ID>', auth.uid(), current_date, 'done');
-- -- esperado: erro de foreign key violation -- o par (routine_id, user_id) não existe em
-- -- personal_routines(id, user_id), porque essa rotina pertence a Beta, não a Alfa.

-- 2.16 Alfa: tentar mudar routine_id de uma entrada existente → DEVE FALHAR (trigger forbid_routine_entry_reassignment).
-- UPDATE public.personal_routine_entries SET routine_id = '<OUTRA_ROTINA_DO_ALFA_ID>' WHERE routine_id = '<ROUTINE_ID>' AND entry_date = current_date;

-- 2.17 Alfa: SELECT de rotinas/entries de Beta → 0 linhas.
-- SELECT * FROM public.personal_routines WHERE user_id = '<BETA_USER_ID>';
-- SELECT * FROM public.personal_routine_entries WHERE user_id = '<BETA_USER_ID>';

-- ── Bloco 3 — gratitude_entries ────────────────────────────────

-- 3.1 Alfa: criar entrada de hoje com só gratitude_1 preenchido (preenchimento progressivo) → sucesso.
-- INSERT INTO public.gratitude_entries (user_id, entry_date, gratitude_1) VALUES (auth.uid(), current_date, 'Saúde');

-- 3.2 Alfa: tentar criar SEGUNDA entrada para o mesmo dia → DEVE FALHAR (UNIQUE user_id+entry_date).
-- INSERT INTO public.gratitude_entries (user_id, entry_date, gratitude_1) VALUES (auth.uid(), current_date, 'Outra');

-- 3.3 Alfa: completar a mesma entrada (gratitude_2/3/best_moment/learning) mais tarde no mesmo dia → sucesso (UPDATE, não INSERT).
-- UPDATE public.gratitude_entries SET gratitude_2 = 'Família', best_moment = 'Reunião com a equipe' WHERE user_id = auth.uid() AND entry_date = current_date;

-- 3.4 Alfa: SELECT de entrada de Beta → 0 linhas, mesmo sabendo a entry_date exata.
-- SELECT * FROM public.gratitude_entries WHERE user_id = '<BETA_USER_ID>' AND entry_date = current_date;

-- ── Bloco 4 — personal_events ──────────────────────────────────

-- 4.1 Alfa: criar evento de hoje com horário definido → sucesso.
-- INSERT INTO public.personal_events (user_id, title, starts_at, type) VALUES (auth.uid(), 'Gravar vídeo', now(), 'gravacao');

-- 4.2 Alfa: criar evento SEM ends_at (duração ainda não conhecida) → sucesso (ends_at nullable).
-- INSERT INTO public.personal_events (user_id, title, starts_at) VALUES (auth.uid(), 'Reunião', now());

-- 4.3 Alfa: criar evento com ends_at ANTES de starts_at → DEVE FALHAR (CHECK).
-- INSERT INTO public.personal_events (user_id, title, starts_at, ends_at) VALUES (auth.uid(), 'Evento inválido', now(), now() - interval '1 hour');

-- 4.4 Alfa: filtrar eventos de hoje (mesma janela usada pela Home).
-- SELECT * FROM public.personal_events WHERE user_id = auth.uid() AND starts_at::date = current_date;

-- 4.5 Alfa: filtrar eventos futuros (semana).
-- SELECT * FROM public.personal_events WHERE user_id = auth.uid() AND starts_at BETWEEN now() AND now() + interval '7 days';

-- 4.6 Alfa: editar horário do evento → sucesso.
-- UPDATE public.personal_events SET starts_at = starts_at + interval '1 hour' WHERE user_id = auth.uid();

-- 4.7 Alfa: cancelar evento (status='cancelled') → sucesso.
-- UPDATE public.personal_events SET status = 'cancelled' WHERE user_id = auth.uid();

-- 4.8 Alfa: related_entity_type fora da allowlist → DEVE FALHAR (CHECK, mesma regra do Bloco 1.8).
-- INSERT INTO public.personal_events (user_id, title, starts_at, related_entity_type) VALUES (auth.uid(), 'X', now(), 'creator_profile');

-- 4.9 Alfa: SELECT de eventos de Beta → 0 linhas (isolamento cross-user).
-- SELECT * FROM public.personal_events WHERE user_id = '<BETA_USER_ID>';

-- ── Bloco 5 — políticas, RLS habilitada e GRANTs de tabela ────

-- 5.1 Confirmar que nenhuma policy `TO anon` (nem `TO public`) existe em nenhuma das 5 tabelas.
-- SELECT tablename, policyname, roles FROM pg_policies
--   WHERE tablename IN ('personal_tasks', 'personal_routines', 'personal_routine_entries', 'gratitude_entries', 'personal_events');
-- -- esperado: só policies com roles={authenticated}, nenhuma com 'anon' nem 'public'.

-- 5.2 Confirmar que RLS está de fato habilitada nas 5 tabelas (não só policies criadas).
-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('personal_tasks', 'personal_routines', 'personal_routine_entries', 'gratitude_entries', 'personal_events');
-- -- esperado: relrowsecurity = true em todas.

-- 5.3 Fase 1A.3 — CAMADA DE GRANT (independente de RLS): confirmar privilégios exatos
--     de anon/authenticated/service_role nas 5 tabelas, numa única query:
-- SELECT
--   t.tbl,
--   has_table_privilege('anon',          t.tbl, 'SELECT') AS anon_select,
--   has_table_privilege('anon',          t.tbl, 'INSERT') AS anon_insert,
--   has_table_privilege('anon',          t.tbl, 'UPDATE') AS anon_update,
--   has_table_privilege('anon',          t.tbl, 'DELETE') AS anon_delete,
--   has_table_privilege('authenticated', t.tbl, 'SELECT')   AS auth_select,
--   has_table_privilege('authenticated', t.tbl, 'INSERT')   AS auth_insert,
--   has_table_privilege('authenticated', t.tbl, 'UPDATE')   AS auth_update,
--   has_table_privilege('authenticated', t.tbl, 'DELETE')   AS auth_delete,
--   has_table_privilege('authenticated', t.tbl, 'TRUNCATE') AS auth_truncate,
--   has_table_privilege('service_role',  t.tbl, 'SELECT') AS service_select
-- FROM (VALUES
--   ('public.personal_tasks'), ('public.personal_routines'),
--   ('public.personal_routine_entries'), ('public.gratitude_entries'),
--   ('public.personal_events')
-- ) AS t(tbl);
-- -- esperado: anon_* = false em TODAS as colunas/tabelas; auth_select/insert/update/delete =
-- -- true, auth_truncate = false; service_select = false (revogado nesta fase -- ver evidência
-- -- BYPASSRLS-vs-GRANT no cabeçalho do SQL 93). Este teste NÃO precisa impersonar ninguém --
-- -- has_table_privilege() consulta o catálogo de permissões diretamente.

-- 5.4 Confirmar na prática (não só via catálogo) que anon não lê nenhuma linha, impersonando de verdade:
--   BEGIN;
--   SET LOCAL ROLE anon;
--   SELECT * FROM public.personal_tasks;
--   ROLLBACK;
-- -- esperado: erro "permission denied for table personal_tasks" (não mais "0 linhas
-- -- silenciosas" como na Fase 1A.2 -- agora é a camada de GRANT barrando, não RLS filtrando).

-- ============================================================
-- APP TESTS — FUTURE (NÃO EXECUTADO POR ESTE ARQUIVO SQL)
-- ============================================================
-- Dependem de código de aplicação (classificador, transcrição de voz,
-- preview de UI) que ainda não existe nesta fase (1A/1A.1/1A.2 são só
-- schema/RLS/migration). Documentadas aqui só para não perder o
-- contrato -- viram teste de verdade (Playwright/unit test TS) quando a
-- API/UI forem implementadas, nunca rodadas via psql/SQL Editor.
--
-- Quick Capture:
--   - texto "comprar tripé amanhã" → preview classifica TASK → confirmar → aparece em personal_tasks.
--   - voz "grato pela reunião de hoje" → /api/jarvis/transcribe → preview classifica GRATITUDE → confirmar → aparece em gratitude_entries.
--   - texto "estudar RLS toda terça" → preview classifica ROUTINE (specific_days, days_of_week=[2]) → confirmar → aparece em personal_routines.
--   - texto "reunião amanhã às 15h" → preview classifica EVENT → confirmar → aparece em personal_events.
--   - cancelar o preview em qualquer um dos casos acima → nenhuma linha gravada em nenhuma tabela.
--   - entrada malformada/vazia → preview não permite confirmar, nenhuma escrita.
-- ============================================================

-- FIM DO PLANO DE VERIFICAÇÃO
