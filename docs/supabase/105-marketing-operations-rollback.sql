-- Rollback da 105 (operação de marketing). Apaga só objetos criados pela 105.
-- ATENÇÃO: apaga os dados dessas tabelas. Fazer backup antes se houver uso real.
BEGIN;
DROP TABLE IF EXISTS public.mkt_metric_benchmarks;
DROP TABLE IF EXISTS public.mkt_decision_links;
DROP TABLE IF EXISTS public.mkt_performance_daily;
DROP TABLE IF EXISTS public.mkt_conversion_events;
DROP TABLE IF EXISTS public.mkt_opportunities;
DROP TABLE IF EXISTS public.mkt_leads;
DROP TABLE IF EXISTS public.mkt_ads;
DROP TABLE IF EXISTS public.mkt_creatives;
DROP TABLE IF EXISTS public.mkt_ad_sets;
DROP TABLE IF EXISTS public.mkt_campaigns;
DROP TABLE IF EXISTS public.mkt_ad_accounts;
DROP TABLE IF EXISTS public.mkt_launches;
DROP TABLE IF EXISTS public.mkt_funnel_stages;
DROP TABLE IF EXISTS public.mkt_funnels;
DROP FUNCTION IF EXISTS public.mkt_stamp_campaign_workflow();
DROP FUNCTION IF EXISTS public.mkt_guard_publication_workflow();
DROP FUNCTION IF EXISTS public.mkt_touch_updated_at();
DROP FUNCTION IF EXISTS public.mkt_is_approver();
DROP FUNCTION IF EXISTS public.mkt_can_manage(uuid);
ALTER TABLE public.client_projects DROP CONSTRAINT IF EXISTS uq_client_projects_id_client;
COMMIT;
