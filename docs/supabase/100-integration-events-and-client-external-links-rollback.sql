-- ============================================================
-- ROLLBACK — SQL 100 · Integration Events + client_external_links
-- Reverte exatamente o que foi adicionado, em ordem inversa.
-- integration_webhook_events em si (SQL 86) NUNCA é removida -- só as
-- colunas/constraint que este SQL acrescentou.
-- ============================================================

BEGIN;

-- 2. client_external_links
DROP TRIGGER IF EXISTS trg_client_external_links_updated_at ON public.client_external_links;
DROP TABLE IF EXISTS public.client_external_links;

-- 1. integration_webhook_events
DROP INDEX IF EXISTS public.idx_integration_webhook_events_provider_received;
DROP INDEX IF EXISTS public.idx_integration_webhook_events_client;
ALTER TABLE public.integration_webhook_events DROP CONSTRAINT IF EXISTS integration_webhook_events_status_check;
ALTER TABLE public.integration_webhook_events DROP COLUMN IF EXISTS requested_by_external_id;
ALTER TABLE public.integration_webhook_events DROP COLUMN IF EXISTS source_reference;
ALTER TABLE public.integration_webhook_events DROP COLUMN IF EXISTS entity_id;
ALTER TABLE public.integration_webhook_events DROP COLUMN IF EXISTS entity_type;
ALTER TABLE public.integration_webhook_events DROP COLUMN IF EXISTS project_id;

COMMIT;
