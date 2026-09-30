-- ============================================================
-- LOKAT OS — ROLLBACK do SQL 98 · Meu PP V2 · Fase 1
--
-- Remove SOMENTE o que o SQL 98 criou:
--   funções personal_confirm_capture / personal_supersede_decision /
--   forbid_personal_decision_rewrite; tabelas personal_quick_captures,
--   personal_reflections, personal_decisions; índice e coluna
--   personal_tasks.focus_date.
-- NUNCA toca personal_entity_links (SQL 97), as demais tabelas Personal
-- Core, nem public.set_updated_at() (helper compartilhado da baseline).
--
-- ATENÇÃO: apaga capturas, reflexos, decisões e a marcação de prioridade
-- (focus_date) das tarefas — as tarefas em si permanecem. Links em
-- personal_entity_links que apontavam para esses objetos ficam órfãos
-- (tolerados pela aplicação). Executar só com aprovação explícita do dono.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.personal_supersede_decision(UUID, JSONB);
DROP FUNCTION IF EXISTS public.personal_confirm_capture(TEXT, TEXT, TEXT, TEXT, JSONB);

DROP TABLE IF EXISTS public.personal_decisions;
DROP FUNCTION IF EXISTS public.forbid_personal_decision_rewrite();
DROP TABLE IF EXISTS public.personal_reflections;
DROP TABLE IF EXISTS public.personal_quick_captures;

DROP INDEX IF EXISTS public.idx_personal_tasks_user_focus;
ALTER TABLE public.personal_tasks DROP COLUMN IF EXISTS focus_date;

COMMIT;
