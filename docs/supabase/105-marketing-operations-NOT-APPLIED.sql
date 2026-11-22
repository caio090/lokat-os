-- ============================================================================
-- 105 — Operação de marketing: funis, lançamentos, campanhas, criativos,
--       CRM por cliente, eventos de conversão, desempenho e decisões.
--
-- ESTADO: NÃO APLICADA. Não rodar em produção sem revisão e autorização.
-- Testada localmente (PGlite / Postgres 18) com o plano em
-- 105-marketing-operations-test-plan.sql. Rollback: 105-...-rollback.sql.
--
-- Princípios
--  * Tudo é escopo de cliente (client_id NOT NULL). A Lokat usa as mesmas
--    tabelas com o client_id da própria organização.
--  * Integridade entre clientes por FK composta (id, client_id): um filho
--    nunca aponta para pai de outro cliente, mesmo via service role.
--  * Leitura: public.can_access_client_company() (migração 91, helper único
--    de ownership). Escrita: public.mkt_can_manage() = acesso + papel de
--    equipe (admin, super_admin, agency, gestor_trafego). Cliente lê, não
--    escreve.
--  * Fluxo de publicação separado: rascunho → em_revisao → aprovada →
--    publicada. "aprovada" exige admin/super_admin. "publicada" só via
--    service_role (servidor), e o objeto nasce PAUSADO na plataforma.
--    Ativar veiculação exige autorização específica registrada
--    (activation_authorized_*), nunca automática.
--  * Nenhuma coluna guarda token de plataforma. Tokens continuam em
--    meta_connections (ver 106 para o endurecimento de acesso).
--  * Métricas não têm metas universais: benchmark é opcional, por cliente,
--    com fonte declarada.
-- ============================================================================

BEGIN;

-- ── 0. Pré-requisitos aditivos ──────────────────────────────────────────────
-- Permite FK composta (project_id, client_id) → client_projects.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_client_projects_id_client') THEN
    ALTER TABLE public.client_projects ADD CONSTRAINT uq_client_projects_id_client UNIQUE (id, client_id);
  END IF;
END $$;

-- ── 1. Helper de escrita ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mkt_can_manage(target_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    public.can_access_client_company(target_client_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'agency', 'gestor_trafego')
    );
$$;
COMMENT ON FUNCTION public.mkt_can_manage(uuid) IS
  '105 — escrita no domínio de marketing: acesso Company-scoped (can_access_client_company) + papel de equipe. Nunca conceder só por papel.';
REVOKE ALL ON FUNCTION public.mkt_can_manage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mkt_can_manage(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mkt_can_manage(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mkt_is_approver()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
  );
$$;
REVOKE ALL ON FUNCTION public.mkt_is_approver() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mkt_is_approver() FROM anon;
GRANT EXECUTE ON FUNCTION public.mkt_is_approver() TO authenticated;

CREATE OR REPLACE FUNCTION public.mkt_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ── 2. Funis (referência: Russell Brunson — escada de valor e tipos de funil)
CREATE TABLE IF NOT EXISTS public.mkt_funnels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id      uuid,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  -- Referência de planejamento, nunca garantia: ver src/lib/marketing-ops/frameworks.ts
  framework       text NOT NULL DEFAULT 'custom'
                  CHECK (framework IN ('custom', 'brunson_value_ladder', 'brunson_funnel', 'erico_launch')),
  funnel_type     text CHECK (funnel_type IS NULL OR char_length(funnel_type) <= 60),
  objective       text CHECK (objective IS NULL OR char_length(objective) <= 2000),
  audience        text CHECK (audience IS NULL OR char_length(audience) <= 4000),
  offer           text CHECK (offer IS NULL OR char_length(offer) <= 4000),
  value_ladder_position text CHECK (value_ladder_position IS NULL OR value_ladder_position IN ('isca', 'entrada', 'principal', 'premium', 'continuidade')),
  diagnostic_id   uuid REFERENCES public.company_diagnostics(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'ativo', 'pausado', 'arquivado')),
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 8000),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_funnels_id_client UNIQUE (id, client_id),
  CONSTRAINT fk_mkt_funnels_project FOREIGN KEY (project_id, client_id)
    REFERENCES public.client_projects (id, client_id) ON DELETE SET NULL (project_id)
);
CREATE INDEX IF NOT EXISTS mkt_funnels_client_idx ON public.mkt_funnels (client_id, status);

CREATE TABLE IF NOT EXISTS public.mkt_funnel_stages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  funnel_id       uuid NOT NULL,
  position        integer NOT NULL CHECK (position BETWEEN 1 AND 50),
  stage_key       text NOT NULL CHECK (stage_key ~ '^[a-z0-9_]{1,60}$'),
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  kind            text NOT NULL CHECK (kind IN ('trafego', 'captura', 'nutricao', 'conversao', 'upsell', 'entrega', 'retencao')),
  -- Evento que marca a entrada nesta etapa (casa com mkt_conversion_events.event_key).
  entry_event_key text CHECK (entry_event_key IS NULL OR entry_event_key ~ '^[a-z0-9_]{1,60}$'),
  channel         text CHECK (channel IS NULL OR channel IN ('meta', 'google', 'site', 'whatsapp', 'email', 'organico', 'indicacao', 'offline', 'outro')),
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_funnel_stages_id_client UNIQUE (id, client_id),
  CONSTRAINT uq_mkt_funnel_stages_position UNIQUE (funnel_id, position),
  CONSTRAINT uq_mkt_funnel_stages_key UNIQUE (funnel_id, stage_key),
  CONSTRAINT fk_mkt_funnel_stages_funnel FOREIGN KEY (funnel_id, client_id)
    REFERENCES public.mkt_funnels (id, client_id) ON DELETE CASCADE
);

-- ── 3. Lançamentos (referência: Érico Rocha — Fórmula de Lançamento) ───────
CREATE TABLE IF NOT EXISTS public.mkt_launches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  funnel_id       uuid,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  launch_model    text NOT NULL CHECK (launch_model IN ('semente', 'interno', 'parceria', 'perpetuo', 'relampago', 'outro')),
  product         text CHECK (product IS NULL OR char_length(product) <= 2000),
  -- Fases planejadas: [{key, name, starts_on, ends_on, goal}] (ver frameworks.ts)
  phases          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(phases) = 'array'),
  cart_opens_at   timestamptz,
  cart_closes_at  timestamptz,
  timezone_name   text NOT NULL DEFAULT 'America/Sao_Paulo',
  status          text NOT NULL DEFAULT 'planejamento' CHECK (status IN ('planejamento', 'pre_lancamento', 'carrinho_aberto', 'encerrado', 'cancelado')),
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 8000),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_launches_id_client UNIQUE (id, client_id),
  CONSTRAINT chk_mkt_launches_cart CHECK (cart_closes_at IS NULL OR cart_opens_at IS NULL OR cart_closes_at > cart_opens_at),
  CONSTRAINT fk_mkt_launches_funnel FOREIGN KEY (funnel_id, client_id)
    REFERENCES public.mkt_funnels (id, client_id) ON DELETE SET NULL (funnel_id)
);

-- ── 4. Contas de anúncio (sem token; moeda e fuso são da conta) ────────────
CREATE TABLE IF NOT EXISTS public.mkt_ad_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('meta', 'google')),
  external_account_id text NOT NULL CHECK (char_length(external_account_id) BETWEEN 1 AND 64),
  name                text,
  currency            text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  timezone_name       text,
  -- Conexão OAuth usada para ler (tokens ficam só em meta_connections).
  meta_connection_id  uuid REFERENCES public.meta_connections(id) ON DELETE SET NULL,
  access_level        text CHECK (access_level IS NULL OR access_level IN ('leitura', 'gestao')),
  last_synced_at      timestamptz,
  status              text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'sem_acesso', 'desconectada')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_ad_accounts_id_client UNIQUE (id, client_id),
  CONSTRAINT uq_mkt_ad_accounts_external UNIQUE (client_id, platform, external_account_id)
);

-- ── 5. Campanhas / conjuntos / criativos / anúncios ────────────────────────
-- Status interno (fluxo de trabalho) é separado de platform_status (o que a
-- plataforma reporta: PAUSED, ACTIVE, ARCHIVED...).
CREATE TABLE IF NOT EXISTS public.mkt_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ad_account_id         uuid,
  funnel_id             uuid,
  funnel_stage_id       uuid,
  launch_id             uuid,
  channel               text NOT NULL CHECK (channel IN ('meta', 'google', 'site', 'whatsapp', 'email', 'organico', 'outro')),
  name                  text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  objective             text CHECK (objective IS NULL OR char_length(objective) <= 60),
  buying_type           text CHECK (buying_type IS NULL OR buying_type IN ('AUCTION', 'RESERVED')),
  budget_type           text CHECK (budget_type IS NULL OR budget_type IN ('diario', 'vitalicio', 'no_conjunto')),
  budget_amount         numeric(14, 2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  currency              text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  starts_at             timestamptz,
  ends_at               timestamptz,
  external_id           text,
  status                text NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho', 'em_revisao', 'aprovada', 'publicada', 'pausada', 'encerrada', 'arquivada')),
  platform_status       text,
  submitted_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at          timestamptz,
  approved_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  published_at          timestamptz,
  activation_authorized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activation_authorized_at timestamptz,
  review_notes          text CHECK (review_notes IS NULL OR char_length(review_notes) <= 4000),
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_campaigns_id_client UNIQUE (id, client_id),
  CONSTRAINT chk_mkt_campaigns_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT fk_mkt_campaigns_account FOREIGN KEY (ad_account_id, client_id)
    REFERENCES public.mkt_ad_accounts (id, client_id) ON DELETE SET NULL (ad_account_id),
  CONSTRAINT fk_mkt_campaigns_funnel FOREIGN KEY (funnel_id, client_id)
    REFERENCES public.mkt_funnels (id, client_id) ON DELETE SET NULL (funnel_id),
  CONSTRAINT fk_mkt_campaigns_stage FOREIGN KEY (funnel_stage_id, client_id)
    REFERENCES public.mkt_funnel_stages (id, client_id) ON DELETE SET NULL (funnel_stage_id),
  CONSTRAINT fk_mkt_campaigns_launch FOREIGN KEY (launch_id, client_id)
    REFERENCES public.mkt_launches (id, client_id) ON DELETE SET NULL (launch_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_campaigns_external ON public.mkt_campaigns (client_id, channel, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mkt_campaigns_client_idx ON public.mkt_campaigns (client_id, status);

CREATE TABLE IF NOT EXISTS public.mkt_ad_sets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  campaign_id           uuid NOT NULL,
  name                  text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  optimization_goal     text CHECK (optimization_goal IS NULL OR char_length(optimization_goal) <= 60),
  billing_event         text CHECK (billing_event IS NULL OR char_length(billing_event) <= 40),
  conversion_event_key  text CHECK (conversion_event_key IS NULL OR conversion_event_key ~ '^[a-z0-9_]{1,60}$'),
  audience              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience) = 'object'),
  placements            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(placements) = 'object'),
  budget_amount         numeric(14, 2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  external_id           text,
  status                text NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho', 'em_revisao', 'aprovada', 'publicada', 'pausada', 'encerrada', 'arquivada')),
  platform_status       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_ad_sets_id_client UNIQUE (id, client_id),
  CONSTRAINT fk_mkt_ad_sets_campaign FOREIGN KEY (campaign_id, client_id)
    REFERENCES public.mkt_campaigns (id, client_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_ad_sets_external ON public.mkt_ad_sets (client_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.mkt_creatives (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  format            text NOT NULL CHECK (format IN ('imagem', 'video', 'carrossel', 'texto', 'colecao')),
  primary_text      text CHECK (primary_text IS NULL OR char_length(primary_text) <= 5000),
  headline          text CHECK (headline IS NULL OR char_length(headline) <= 255),
  description       text CHECK (description IS NULL OR char_length(description) <= 500),
  call_to_action    text CHECK (call_to_action IS NULL OR char_length(call_to_action) <= 40),
  landing_url       text CHECK (landing_url IS NULL OR landing_url ~ '^https://'),
  utm               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(utm) = 'object'),
  -- Referências a mídia (Drive, Storage, content_items) — nunca o arquivo em si.
  media_refs        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media_refs) = 'array'),
  content_item_id   uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  external_id       text,
  status            text NOT NULL DEFAULT 'rascunho'
                    CHECK (status IN ('rascunho', 'em_revisao', 'aprovada', 'publicada', 'pausada', 'encerrada', 'arquivada')),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_creatives_id_client UNIQUE (id, client_id)
);

CREATE TABLE IF NOT EXISTS public.mkt_ads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ad_set_id         uuid NOT NULL,
  creative_id       uuid,
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  external_id       text,
  status            text NOT NULL DEFAULT 'rascunho'
                    CHECK (status IN ('rascunho', 'em_revisao', 'aprovada', 'publicada', 'pausada', 'encerrada', 'arquivada')),
  platform_status   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_ads_id_client UNIQUE (id, client_id),
  CONSTRAINT fk_mkt_ads_ad_set FOREIGN KEY (ad_set_id, client_id)
    REFERENCES public.mkt_ad_sets (id, client_id) ON DELETE CASCADE,
  CONSTRAINT fk_mkt_ads_creative FOREIGN KEY (creative_id, client_id)
    REFERENCES public.mkt_creatives (id, client_id) ON DELETE SET NULL (creative_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_ads_external ON public.mkt_ads (client_id, external_id) WHERE external_id IS NOT NULL;

-- ── 6. CRM do cliente (o CRM comercial da Lokat — commercial_leads — não é
--      segmentado por cliente; ver src/lib/crm/workspace-context.ts) ───────
CREATE TABLE IF NOT EXISTS public.mkt_leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name               text CHECK (name IS NULL OR char_length(name) <= 200),
  email              text CHECK (email IS NULL OR char_length(email) <= 320),
  phone              text CHECK (phone IS NULL OR char_length(phone) <= 40),
  -- Origem (primeiro toque). Nunca inventada: null quando desconhecida.
  source_channel     text CHECK (source_channel IS NULL OR source_channel IN ('meta', 'google', 'site', 'whatsapp', 'email', 'organico', 'indicacao', 'offline', 'outro')),
  utm                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(utm) = 'object'),
  first_campaign_id  uuid,
  first_ad_id        uuid,
  funnel_id          uuid,
  current_stage_id   uuid,
  status             text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_contato', 'qualificado', 'desqualificado', 'cliente', 'perdido')),
  -- Vínculo opcional com o CRM comercial da própria Lokat.
  commercial_lead_id uuid REFERENCES public.commercial_leads(id) ON DELETE SET NULL,
  owner_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_leads_id_client UNIQUE (id, client_id),
  CONSTRAINT fk_mkt_leads_campaign FOREIGN KEY (first_campaign_id, client_id)
    REFERENCES public.mkt_campaigns (id, client_id) ON DELETE SET NULL (first_campaign_id),
  CONSTRAINT fk_mkt_leads_ad FOREIGN KEY (first_ad_id, client_id)
    REFERENCES public.mkt_ads (id, client_id) ON DELETE SET NULL (first_ad_id),
  CONSTRAINT fk_mkt_leads_funnel FOREIGN KEY (funnel_id, client_id)
    REFERENCES public.mkt_funnels (id, client_id) ON DELETE SET NULL (funnel_id),
  CONSTRAINT fk_mkt_leads_stage FOREIGN KEY (current_stage_id, client_id)
    REFERENCES public.mkt_funnel_stages (id, client_id) ON DELETE SET NULL (current_stage_id)
);
CREATE INDEX IF NOT EXISTS mkt_leads_client_idx ON public.mkt_leads (client_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mkt_opportunities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  lead_id        uuid NOT NULL,
  title          text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  amount         numeric(14, 2) CHECK (amount IS NULL OR amount >= 0),
  currency       text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  stage          text NOT NULL DEFAULT 'aberta' CHECK (stage IN ('aberta', 'proposta', 'negociacao', 'ganha', 'perdida')),
  won_at         timestamptz,
  lost_reason    text CHECK (lost_reason IS NULL OR char_length(lost_reason) <= 1000),
  owner_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_opportunities_id_client UNIQUE (id, client_id),
  CONSTRAINT chk_mkt_opportunities_won CHECK ((stage = 'ganha') = (won_at IS NOT NULL)),
  CONSTRAINT fk_mkt_opportunities_lead FOREIGN KEY (lead_id, client_id)
    REFERENCES public.mkt_leads (id, client_id) ON DELETE CASCADE
);

-- ── 7. Eventos de conversão (Pixel, API de Conversões, site, WhatsApp, CRM)
CREATE TABLE IF NOT EXISTS public.mkt_conversion_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_key          text NOT NULL CHECK (event_key ~ '^[a-z0-9_]{1,60}$'),
  source             text NOT NULL CHECK (source IN ('meta_pixel', 'meta_capi', 'google_ads', 'site', 'whatsapp', 'crm', 'manual', 'importacao')),
  -- Deduplicação Pixel × API de Conversões usa o mesmo event_id.
  external_event_id  text CHECK (external_event_id IS NULL OR char_length(external_event_id) <= 200),
  occurred_at        timestamptz NOT NULL,
  value              numeric(14, 2) CHECK (value IS NULL OR value >= 0),
  currency           text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  lead_id            uuid,
  opportunity_id     uuid,
  campaign_id        uuid,
  ad_set_id          uuid,
  ad_id              uuid,
  funnel_stage_id    uuid,
  utm                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(utm) = 'object'),
  -- Como a atribuição foi feita (janela, modelo, fonte). Nunca misturar
  -- janelas diferentes no mesmo indicador.
  attribution        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attribution) = 'object'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_mkt_events_value_currency CHECK (value IS NULL OR currency IS NOT NULL),
  CONSTRAINT fk_mkt_events_lead FOREIGN KEY (lead_id, client_id) REFERENCES public.mkt_leads (id, client_id) ON DELETE SET NULL (lead_id),
  CONSTRAINT fk_mkt_events_opportunity FOREIGN KEY (opportunity_id, client_id) REFERENCES public.mkt_opportunities (id, client_id) ON DELETE SET NULL (opportunity_id),
  CONSTRAINT fk_mkt_events_campaign FOREIGN KEY (campaign_id, client_id) REFERENCES public.mkt_campaigns (id, client_id) ON DELETE SET NULL (campaign_id),
  CONSTRAINT fk_mkt_events_ad_set FOREIGN KEY (ad_set_id, client_id) REFERENCES public.mkt_ad_sets (id, client_id) ON DELETE SET NULL (ad_set_id),
  CONSTRAINT fk_mkt_events_ad FOREIGN KEY (ad_id, client_id) REFERENCES public.mkt_ads (id, client_id) ON DELETE SET NULL (ad_id),
  CONSTRAINT fk_mkt_events_stage FOREIGN KEY (funnel_stage_id, client_id) REFERENCES public.mkt_funnel_stages (id, client_id) ON DELETE SET NULL (funnel_stage_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_events_dedupe ON public.mkt_conversion_events (client_id, event_key, external_event_id) WHERE external_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mkt_events_client_time_idx ON public.mkt_conversion_events (client_id, occurred_at DESC);

-- ── 8. Desempenho diário importado das plataformas ─────────────────────────
-- "date" é o dia NO FUSO DA CONTA de anúncios (account_timezone), como a
-- plataforma reporta. Valores na moeda da conta. Uma linha por
-- (objeto, dia, configuração de atribuição).
CREATE TABLE IF NOT EXISTS public.mkt_performance_daily (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ad_account_id       uuid NOT NULL,
  platform            text NOT NULL CHECK (platform IN ('meta', 'google')),
  level               text NOT NULL CHECK (level IN ('account', 'campaign', 'adset', 'ad')),
  external_object_id  text NOT NULL,
  campaign_id         uuid,
  ad_set_id           uuid,
  ad_id               uuid,
  date                date NOT NULL,
  account_timezone    text NOT NULL,
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  attribution_setting text NOT NULL DEFAULT 'padrao_da_conta',
  spend               numeric(14, 2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  impressions         bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  reach               bigint CHECK (reach IS NULL OR reach >= 0),
  clicks              bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  link_clicks         bigint CHECK (link_clicks IS NULL OR link_clicks >= 0),
  -- Ações reportadas pela plataforma: [{action_type, value}] — sem reinterpretar.
  actions             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actions) = 'array'),
  action_values       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(action_values) = 'array'),
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_perf_row UNIQUE (client_id, platform, level, external_object_id, date, attribution_setting),
  CONSTRAINT fk_mkt_perf_account FOREIGN KEY (ad_account_id, client_id) REFERENCES public.mkt_ad_accounts (id, client_id) ON DELETE CASCADE,
  CONSTRAINT fk_mkt_perf_campaign FOREIGN KEY (campaign_id, client_id) REFERENCES public.mkt_campaigns (id, client_id) ON DELETE SET NULL (campaign_id),
  CONSTRAINT fk_mkt_perf_ad_set FOREIGN KEY (ad_set_id, client_id) REFERENCES public.mkt_ad_sets (id, client_id) ON DELETE SET NULL (ad_set_id),
  CONSTRAINT fk_mkt_perf_ad FOREIGN KEY (ad_id, client_id) REFERENCES public.mkt_ads (id, client_id) ON DELETE SET NULL (ad_id)
);
CREATE INDEX IF NOT EXISTS mkt_perf_client_date_idx ON public.mkt_performance_daily (client_id, date DESC);

-- ── 9. Decisões estratégicas: reaproveita company_decisions (migração 99,
--      origin 'campaign_result') e só liga a decisão aos objetos de marketing.
CREATE TABLE IF NOT EXISTS public.mkt_decision_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  decision_id   uuid NOT NULL,
  entity_type   text NOT NULL CHECK (entity_type IN ('funnel', 'funnel_stage', 'launch', 'campaign', 'ad_set', 'ad', 'creative')),
  entity_id     uuid NOT NULL,
  -- Evidência que embasou a decisão (período, métricas, fonte).
  evidence      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkt_decision_links UNIQUE (decision_id, entity_type, entity_id),
  CONSTRAINT fk_mkt_decision_links_decision FOREIGN KEY (decision_id, client_id)
    REFERENCES public.company_decisions (id, client_id) ON DELETE CASCADE
);

-- Benchmarks opcionais, sempre por cliente e com fonte (nunca meta universal).
CREATE TABLE IF NOT EXISTS public.mkt_metric_benchmarks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  metric_key    text NOT NULL CHECK (metric_key ~ '^[a-z0-9_]{1,60}$'),
  target_value  numeric NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('maior_melhor', 'menor_melhor')),
  source        text NOT NULL CHECK (char_length(btrim(source)) BETWEEN 3 AND 500),
  valid_from    date NOT NULL DEFAULT CURRENT_DATE,
  valid_until   date,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_mkt_benchmarks_period CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

-- ── 10. Fluxo de publicação (trigger) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mkt_guard_publication_workflow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
  old_status text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Tudo nasce rascunho; só o servidor importa objetos já existentes na plataforma.
    IF NEW.status <> 'rascunho' AND NOT is_service THEN
      RAISE EXCEPTION 'mkt: objeto novo precisa começar como rascunho (status=%)', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM old_status THEN
    -- Permissão primeiro (mensagem diz o motivo real), depois a transição.
    IF NEW.status = 'publicada' AND NOT is_service THEN
      RAISE EXCEPTION 'mkt: publicação só pelo servidor após aprovação' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'aprovada' AND NOT is_service AND NOT public.mkt_is_approver() THEN
      RAISE EXCEPTION 'mkt: só admin/super_admin aprova' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT is_service AND NOT (
         (old_status = 'rascunho'   AND NEW.status IN ('em_revisao', 'arquivada'))
      OR (old_status = 'em_revisao' AND NEW.status IN ('rascunho', 'aprovada', 'arquivada'))
      OR (old_status = 'aprovada'   AND NEW.status IN ('rascunho', 'arquivada'))
      OR (old_status = 'publicada'  AND NEW.status IN ('pausada', 'encerrada'))
      OR (old_status = 'pausada'    AND NEW.status IN ('encerrada', 'arquivada'))
      OR (old_status = 'encerrada'  AND NEW.status = 'arquivada')
    ) THEN
      RAISE EXCEPTION 'mkt: transição % → % não permitida', old_status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'publicada' AND old_status <> 'aprovada' THEN
      RAISE EXCEPTION 'mkt: só publica o que foi aprovado' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.mkt_stamp_campaign_workflow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'em_revisao' THEN NEW.submitted_by := auth.uid(); NEW.submitted_at := now(); END IF;
    IF NEW.status = 'aprovada'   THEN NEW.approved_by  := auth.uid(); NEW.approved_at  := now(); END IF;
    IF NEW.status = 'rascunho'   THEN NEW.approved_by := NULL; NEW.approved_at := NULL; END IF;
    IF NEW.status = 'publicada'  THEN NEW.published_at := now(); END IF;
  END IF;
  -- Autorização de veiculação: só aprovador humano, só depois de publicada.
  IF TG_OP = 'UPDATE' AND NEW.activation_authorized_at IS DISTINCT FROM OLD.activation_authorized_at THEN
    IF NEW.activation_authorized_at IS NOT NULL THEN
      IF NEW.status NOT IN ('publicada', 'pausada') THEN
        RAISE EXCEPTION 'mkt: autorizar veiculação exige campanha publicada (pausada na plataforma)' USING ERRCODE = 'check_violation';
      END IF;
      IF is_service OR NOT public.mkt_is_approver() THEN
        RAISE EXCEPTION 'mkt: autorização de veiculação é ato humano de admin/super_admin' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.activation_authorized_by := auth.uid();
      NEW.activation_authorized_at := now();
    ELSE
      NEW.activation_authorized_by := NULL;
    END IF;
  END IF;
  -- Campos de aprovação nunca são escritos à mão.
  IF TG_OP = 'UPDATE' AND NOT is_service AND NEW.status = OLD.status AND (
       NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.external_id IS DISTINCT FROM OLD.external_id
    OR NEW.platform_status IS DISTINCT FROM OLD.platform_status) THEN
    RAISE EXCEPTION 'mkt: campos de aprovação/publicação são controlados pelo fluxo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Editar conteúdo de algo aprovado devolve para rascunho (precisa nova revisão).
  IF TG_OP = 'UPDATE' AND NOT is_service AND OLD.status = 'aprovada' AND NEW.status = 'aprovada' AND (
       NEW.name IS DISTINCT FROM OLD.name OR NEW.budget_amount IS DISTINCT FROM OLD.budget_amount
    OR NEW.objective IS DISTINCT FROM OLD.objective OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.ends_at IS DISTINCT FROM OLD.ends_at) THEN
    NEW.status := 'rascunho'; NEW.approved_by := NULL; NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

-- Ordem: carimbo (pode rebaixar aprovada→rascunho) roda antes do guard (alfabética: a_ < b_).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_campaigns', 'mkt_ad_sets', 'mkt_ads', 'mkt_creatives'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS b_guard_workflow ON public.%I', t);
    EXECUTE format('CREATE TRIGGER b_guard_workflow BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mkt_guard_publication_workflow()', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS a_stamp_workflow ON public.mkt_campaigns;
CREATE TRIGGER a_stamp_workflow BEFORE UPDATE ON public.mkt_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.mkt_stamp_campaign_workflow();

-- updated_at
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_funnels', 'mkt_funnel_stages', 'mkt_launches', 'mkt_ad_accounts', 'mkt_campaigns',
                           'mkt_ad_sets', 'mkt_creatives', 'mkt_ads', 'mkt_leads', 'mkt_opportunities'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS c_touch_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER c_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at()', t);
  END LOOP;
END $$;

-- ── 11. RLS ────────────────────────────────────────────────────────────────
-- Leitura: quem acessa o cliente. Escrita: equipe com acesso ao cliente.
-- Desempenho importado e contas de anúncio: escrita só pelo servidor
-- (service_role ignora RLS); equipe só lê.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_funnels', 'mkt_funnel_stages', 'mkt_launches', 'mkt_ad_accounts', 'mkt_campaigns',
                           'mkt_ad_sets', 'mkt_creatives', 'mkt_ads', 'mkt_leads', 'mkt_opportunities',
                           'mkt_conversion_events', 'mkt_performance_daily', 'mkt_decision_links', 'mkt_metric_benchmarks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_access_client_company(client_id))', t || '_select', t);
    IF t NOT IN ('mkt_performance_daily', 'mkt_ad_accounts') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.mkt_can_manage(client_id))', t || '_insert', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.mkt_can_manage(client_id)) WITH CHECK (public.mkt_can_manage(client_id))', t || '_update', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.mkt_can_manage(client_id) AND public.mkt_is_approver())', t || '_delete', t);
    END IF;
  END LOOP;
END $$;

-- Dados pessoais de leads: cliente (role 'cliente') lê os próprios; equipe
-- só com acesso ao cliente — já garantido pela policy acima.

COMMIT;
