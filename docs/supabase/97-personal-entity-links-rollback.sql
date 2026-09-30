-- ============================================================
-- LOKAT OS — ROLLBACK do SQL 97 · personal_entity_links (Meu PP V2 · Fase 0)
--
-- Remove SOMENTE a tabela nova da Fase 0 (e o trigger/policy/índices que
-- morrem com ela). NUNCA toca a fundação Personal Core
-- (personal_tasks, personal_routines, personal_routine_entries,
-- gratitude_entries, personal_events) nem public.set_updated_at(), que é
-- um helper compartilhado da baseline.
--
-- ATENÇÃO: apaga todas as relações pessoais gravadas. Executar só com
-- aprovação explícita do dono dos dados.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS public.personal_entity_links;

COMMIT;
