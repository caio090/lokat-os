-- ============================================================
-- ROLLBACK — SQL 101 · Client Onboarding + Project Journey fields
-- Reverte exatamente o que foi adicionado, em ordem inversa.
-- ============================================================

BEGIN;

-- 5. client_projects
ALTER TABLE public.client_projects DROP COLUMN IF EXISTS onboarding_id;
ALTER TABLE public.client_projects DROP COLUMN IF EXISTS client_dependency;
ALTER TABLE public.client_projects DROP COLUMN IF EXISTS blocked_reason;
ALTER TABLE public.client_projects DROP COLUMN IF EXISTS next_action;
ALTER TABLE public.client_projects DROP COLUMN IF EXISTS owner_id;
ALTER TABLE public.client_projects DROP COLUMN IF EXISTS current_phase;
ALTER TABLE public.client_projects DROP COLUMN IF EXISTS project_type;

-- 4. commercial_meetings
DROP INDEX IF EXISTS public.idx_commercial_meetings_onboarding;
ALTER TABLE public.commercial_meetings DROP COLUMN IF EXISTS is_alignment_meeting;
ALTER TABLE public.commercial_meetings DROP COLUMN IF EXISTS onboarding_id;

-- 3. client_onboarding_items
DROP TRIGGER IF EXISTS trg_client_onboarding_items_updated_at ON public.client_onboarding_items;
DROP TABLE IF EXISTS public.client_onboarding_items;

-- 2. client_onboardings
DROP TRIGGER IF EXISTS trg_client_onboardings_updated_at ON public.client_onboardings;
DROP TABLE IF EXISTS public.client_onboardings;

-- 1. client_onboarding_templates / client_onboarding_template_items
DROP TABLE IF EXISTS public.client_onboarding_template_items;
DROP TABLE IF EXISTS public.client_onboarding_templates;

COMMIT;
