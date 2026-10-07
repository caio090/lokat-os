-- ============================================================
-- ROLLBACK — SQL 99 · Company Decisions + Relationship Lifecycle Links
-- Reverte exatamente o que 99-company-decisions-and-relationship-links.sql
-- adicionou, em ordem inversa. 100% aditivo na ida -> 100% seguro de
-- remover na volta (nenhuma tabela/coluna pré-existente é tocada além
-- de remover as colunas/constraints que o SQL 99 criou).
-- ============================================================

BEGIN;

-- 5. client_projects.scope_category
ALTER TABLE public.client_projects DROP CONSTRAINT IF EXISTS client_projects_scope_category_check;
ALTER TABLE public.client_projects DROP COLUMN IF EXISTS scope_category;

-- 4. roadmap_items — planning_stage / horizon / decision_id
DROP INDEX IF EXISTS public.idx_roadmap_items_decision;
DROP INDEX IF EXISTS public.idx_roadmap_items_client_horizon;
ALTER TABLE public.roadmap_items DROP COLUMN IF EXISTS decision_id;
ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;
ALTER TABLE public.roadmap_items DROP COLUMN IF EXISTS horizon;
ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_planning_stage_check;
ALTER TABLE public.roadmap_items DROP COLUMN IF EXISTS planning_stage;

-- 3. commercial_proposals.client_id
DROP INDEX IF EXISTS public.idx_commercial_proposals_client;
ALTER TABLE public.commercial_proposals DROP CONSTRAINT IF EXISTS chk_commercial_proposals_lead_or_client;
ALTER TABLE public.commercial_proposals DROP COLUMN IF EXISTS client_id;

-- 3. commercial_meetings.client_id
DROP INDEX IF EXISTS public.idx_commercial_meetings_client;
ALTER TABLE public.commercial_meetings DROP CONSTRAINT IF EXISTS chk_commercial_meetings_lead_or_client;
ALTER TABLE public.commercial_meetings DROP COLUMN IF EXISTS client_id;

-- 2. company_supersede_decision
DROP FUNCTION IF EXISTS public.company_supersede_decision(UUID, UUID, JSONB);

-- 1. company_decisions
DROP TRIGGER IF EXISTS trg_company_decisions_updated_at ON public.company_decisions;
DROP TRIGGER IF EXISTS trg_company_decisions_history ON public.company_decisions;
DROP FUNCTION IF EXISTS public.forbid_company_decision_rewrite();
DROP TABLE IF EXISTS public.company_decisions;

COMMIT;
