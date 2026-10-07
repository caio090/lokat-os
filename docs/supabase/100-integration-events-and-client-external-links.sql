-- ============================================================
-- LOKAT OS — SQL 100 · Integration Events (ponte genérica de webhooks)
-- + client_external_links
--
-- Contexto (FASE 1B — ponte de eventos): a auditoria (retomada do
-- produto) já tinha confirmado que `integration_webhook_events`
-- (`docs/supabase/86-provider-foundation.sql`) existe EM PRODUÇÃO
-- (alguém aplicou apesar do cabeçalho "PROPOSTA — NÃO EXECUTAR"), tem
-- 0 linhas, e NENHUM código da aplicação jamais a usou. Em vez de criar
-- uma tabela paralela (`integration_events`), esta migration
-- FORMALMENTE adota essa tabela já existente para o caso de uso real
-- descrito nesta fase -- estende com as colunas que faltam, nunca
-- redundante.
--
-- `idempotency_key` já tem UNIQUE **global** (não por provider) --
-- aproveitado como está: a aplicação grava a chave como
-- "{source_system}:{event_id}" (ver src/lib/integration-events/adapters.ts),
-- nunca o event_id cru -- isso já garante unicidade por source_system
-- sem precisar alterar a constraint existente.
--
-- `status` nunca teve CHECK -- adicionado agora pela primeira vez
-- (mesmo padrão de todo outro status* deste schema), com os 5 valores
-- do contrato desta fase.
--
-- client_external_links é tabela NOVA, genuinamente nova: nada no
-- schema atual mapeia "external_id de um sistema externo" -> client_id
-- (provider_user_links é o equivalente a nível de PROFILE, não de
-- Company -- propósito diferente, não reaproveitável aqui).
--
-- Rollback: docs/supabase/100-integration-events-and-client-external-links-rollback.sql
-- Test plan: docs/supabase/100-integration-events-and-client-external-links-test-plan.sql
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.integration_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'public.integration_webhook_events não existe. Aplique SQL 86 antes deste SQL.';
  END IF;
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'public.clients não existe. Aplique a baseline antes deste SQL.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    RAISE EXCEPTION 'public.set_updated_at() não existe. Aplique a baseline antes deste SQL.';
  END IF;
END $$;

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. integration_webhook_events — estender com as colunas que o
--    contrato de evento desta fase precisa. Tudo nullable/aditivo;
--    nenhuma coluna existente é alterada.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.integration_webhook_events
  ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE public.integration_webhook_events
  ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE public.integration_webhook_events
  ADD COLUMN IF NOT EXISTS entity_id TEXT;
ALTER TABLE public.integration_webhook_events
  ADD COLUMN IF NOT EXISTS source_reference TEXT;
ALTER TABLE public.integration_webhook_events
  ADD COLUMN IF NOT EXISTS requested_by_external_id TEXT;

ALTER TABLE public.integration_webhook_events
  DROP CONSTRAINT IF EXISTS integration_webhook_events_status_check;
ALTER TABLE public.integration_webhook_events
  ADD CONSTRAINT integration_webhook_events_status_check
  CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed'));

CREATE INDEX IF NOT EXISTS idx_integration_webhook_events_client
  ON public.integration_webhook_events (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_integration_webhook_events_provider_received
  ON public.integration_webhook_events (provider, received_at DESC);

COMMENT ON COLUMN public.integration_webhook_events.project_id IS
  'SQL 100 -- FASE 1B (ponte de eventos). Opcional: evento pode se referir a um projeto específico (client_projects.id), nunca obrigatório.';
COMMENT ON COLUMN public.integration_webhook_events.entity_type IS
  'SQL 100 -- tipo da entidade interna que o evento referencia/gerou (ex.: "opportunity", "decision", "meeting"), espelha o padrão já usado em activity_logs.entity_type.';
COMMENT ON COLUMN public.integration_webhook_events.entity_id IS
  'SQL 100 -- id da entidade interna gerada/afetada (texto, não FK -- entity_type varia, mesmo padrão polimórfico de roadmap_items.source_id).';
COMMENT ON COLUMN public.integration_webhook_events.source_reference IS
  'SQL 100 -- referência opcional no sistema de origem (ex.: id de uma automação n8n, url de um registro externo). Nunca secret/token.';
COMMENT ON COLUMN public.integration_webhook_events.requested_by_external_id IS
  'SQL 100 -- identificador de quem pediu no sistema externo (texto livre -- o sistema externo pode não ter um profiles.id correspondente).';

-- ─────────────────────────────────────────────────────────────
-- 2. client_external_links — mapeia external_id de um sistema externo
--    para um client_id interno, sem exigir que o sistema externo
--    conheça o UUID do LOKAT OS.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_external_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_system  TEXT NOT NULL CHECK (char_length(btrim(source_system)) BETWEEN 1 AND 100),
  external_id    TEXT NOT NULL CHECK (char_length(btrim(external_id)) BETWEEN 1 AND 200),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_client_external_links_source_external UNIQUE (source_system, external_id)
);

CREATE INDEX IF NOT EXISTS idx_client_external_links_client
  ON public.client_external_links (client_id);

ALTER TABLE public.client_external_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_external_links_admin_all" ON public.client_external_links;
CREATE POLICY "client_external_links_admin_all"
  ON public.client_external_links FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')));

REVOKE ALL ON TABLE public.client_external_links FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_external_links TO authenticated;

COMMENT ON TABLE public.client_external_links IS
  'SQL 100 -- FASE 1B (ponte de eventos). Mapeia um external_id estável de um sistema externo (ex.: "tayannara-carvalho" no Cérebro Tayannara, ou um agente n8n) para um client_id interno do LOKAT OS. Um sistema externo nunca precisa conhecer o UUID interno -- resolve_client_external_id() faz essa tradução. source_system+external_id é único: o mesmo par nunca aponta para dois clients diferentes.';

DROP TRIGGER IF EXISTS trg_client_external_links_updated_at ON public.client_external_links;
CREATE TRIGGER trg_client_external_links_updated_at BEFORE UPDATE ON public.client_external_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
