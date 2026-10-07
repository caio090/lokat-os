-- ============================================================
-- LOKAT OS — SQL 99 · Company Decisions + Relationship Lifecycle Links
--
-- Contexto (retomada do produto, "cliente como centro do sistema"):
-- a auditoria confirmou que NÃO existe, em lugar nenhum, uma entidade
-- "Decisão" no nível da Company (só personal_decisions, PERSONAL ONLY,
-- RLS por user_id) -- e que commercial_meetings/commercial_proposals só
-- têm lead_id, então uma reunião ou proposta para um cliente JÁ FECHADO
-- (upsell, revisão trimestral) não tem onde morar hoje. Esta migration
-- fecha os dois gaps SEM criar nenhuma tabela paralela de autorização:
-- reaproveita can_access_client_company()/can_write_client_company()
-- (SQL 91, já em produção) para o Decision Ledger, e só adiciona uma
-- coluna nullable às duas tabelas comerciais já existentes.
--
-- Também adiciona, de forma aditiva e nunca-destrutiva:
--   - roadmap_items.planning_stage  (ideia -> aprovado, nunca pula pra
--     execução sem decisão explícita -- "Próxima Janela")
--   - roadmap_items.horizon         (retrospectiva/imediato/próxima
--     janela -- os "três tempos" do planejamento contínuo)
--   - roadmap_items.decision_id     (uma Decisão pode gerar um item de
--     roadmap -- fecha o link Decisão -> Execução)
--   - client_projects.scope_category (contratado/bônus/planejamento/
--     fora do escopo/orçamento pendente/extra aprovado)
--
-- Nenhuma tabela existente é renomeada, nenhuma coluna é removida,
-- nenhum dado real é alterado. 100% aditivo.
--
-- Rollback: docs/supabase/99-company-decisions-and-relationship-links-rollback.sql
-- Test plan: docs/supabase/99-company-decisions-and-relationship-links-test-plan.sql
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'public.clients não existe. Aplique a baseline antes deste SQL.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'can_access_client_company'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'can_write_client_company'
  ) THEN
    RAISE EXCEPTION 'can_access_client_company()/can_write_client_company() não existem. Aplique SQL 91 antes deste SQL.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    RAISE EXCEPTION 'public.set_updated_at() não existe. Aplique a baseline antes deste SQL.';
  END IF;
  IF to_regclass('public.commercial_meetings') IS NULL OR to_regclass('public.commercial_proposals') IS NULL THEN
    RAISE EXCEPTION 'commercial_meetings/commercial_proposals não existem. Aplique SQL 15 (comercial-os) antes deste SQL.';
  END IF;
  IF to_regclass('public.roadmap_items') IS NULL OR to_regclass('public.client_projects') IS NULL THEN
    RAISE EXCEPTION 'roadmap_items/client_projects não existem. Aplique as baselines correspondentes antes deste SQL.';
  END IF;
END $$;

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. company_decisions — Decision Ledger no nível da Company
--    Mesmo princípio de personal_decisions (SQL 98): histórico
--    imutável, correção livre só nas primeiras 24h, depois disso
--    mudar de posição = NOVA decisão via company_supersede_decision()
--    (cadeia linear, nunca reescreve a antiga). Diferença: escopo é
--    client_id (várias pessoas da equipe podem ver/registrar, não só
--    quem criou) em vez de user_id -- por isso a autorização reaproveita
--    can_access_client_company()/can_write_client_company() (SQL 91),
--    nunca uma policy de ownership individual.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_decisions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  decision                TEXT NOT NULL CHECK (char_length(btrim(decision)) BETWEEN 1 AND 4000),
  context                 TEXT CHECK (context IS NULL OR char_length(context) <= 4000),
  -- Seção 8 do brief: de onde a decisão nasceu.
  origin                  TEXT NOT NULL DEFAULT 'manual'
                          CHECK (origin IN ('meeting', 'diagnostic', 'client', 'strategy', 'approval', 'project_review', 'campaign_result', 'manual')),
  impact                  TEXT CHECK (impact IS NULL OR impact IN ('low', 'medium', 'high')),
  -- Seção 9 do brief: nem toda decisão volta pro cliente -- cinco
  -- estados explícitos, nunca "aprovação" como default universal.
  client_validation       TEXT NOT NULL DEFAULT 'internal'
                          CHECK (client_validation IN ('internal', 'client_view', 'client_approval', 'client_choice', 'needs_meeting')),
  belongs_to_scope        BOOLEAN,
  generates_task          BOOLEAN NOT NULL DEFAULT false,
  generates_project       BOOLEAN NOT NULL DEFAULT false,
  generates_budget        BOOLEAN NOT NULL DEFAULT false,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  supersedes_decision_id  UUID,
  decided_on              DATE NOT NULL DEFAULT CURRENT_DATE,
  review_at               DATE,
  last_reviewed_at        TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_decisions_id_client UNIQUE (id, client_id),
  CONSTRAINT chk_company_decisions_not_self CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id),
  CONSTRAINT fk_company_decisions_supersedes
    FOREIGN KEY (supersedes_decision_id, client_id)
    REFERENCES public.company_decisions (id, client_id)
);

-- cadeia linear: cada decisão é substituída no máximo uma vez (mesma regra de personal_decisions)
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_decisions_supersedes
  ON public.company_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_decisions_client_decided
  ON public.company_decisions (client_id, decided_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_decisions_client_review
  ON public.company_decisions (client_id, review_at)
  WHERE status = 'active' AND review_at IS NOT NULL;

ALTER TABLE public.company_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_decisions_select" ON public.company_decisions;
DROP POLICY IF EXISTS "company_decisions_insert" ON public.company_decisions;
DROP POLICY IF EXISTS "company_decisions_update" ON public.company_decisions;
DROP POLICY IF EXISTS "company_decisions_delete" ON public.company_decisions;

CREATE POLICY "company_decisions_select"
  ON public.company_decisions FOR SELECT TO authenticated
  USING (public.can_access_client_company(client_id));

CREATE POLICY "company_decisions_insert"
  ON public.company_decisions FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client_company(client_id));

CREATE POLICY "company_decisions_update"
  ON public.company_decisions FOR UPDATE TO authenticated
  USING (public.can_write_client_company(client_id))
  WITH CHECK (public.can_write_client_company(client_id));

CREATE POLICY "company_decisions_delete"
  ON public.company_decisions FOR DELETE TO authenticated
  USING (public.can_write_client_company(client_id));

REVOKE ALL ON TABLE public.company_decisions FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_decisions TO authenticated;

COMMENT ON TABLE public.company_decisions IS
  'Decision Ledger no nível da Company (reaproveita o padrão de '
  'personal_decisions/SQL 98, mas escopado por client_id via '
  'can_access_client_company/can_write_client_company de SQL 91, não '
  'por user_id). Histórico: conteúdo só corrigível nas primeiras 24h; '
  'depois, mudar de posição = nova decisão via company_supersede_decision(), '
  'nunca reescrita silenciosa.';

CREATE OR REPLACE FUNCTION public.forbid_company_decision_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.supersedes_decision_id IS DISTINCT FROM OLD.supersedes_decision_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'company_decisions: client_id/supersedes_decision_id/created_at são imutáveis';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status IS DISTINCT FROM 'superseded' THEN
    RAISE EXCEPTION 'company_decisions: uma decisão substituída não volta a ficar ativa -- registre uma nova decisão';
  END IF;
  IF OLD.created_at < now() - interval '24 hours' AND (
       NEW.title IS DISTINCT FROM OLD.title
    OR NEW.decision IS DISTINCT FROM OLD.decision
    OR NEW.context IS DISTINCT FROM OLD.context
    OR NEW.origin IS DISTINCT FROM OLD.origin
    OR NEW.impact IS DISTINCT FROM OLD.impact
    OR NEW.client_validation IS DISTINCT FROM OLD.client_validation
    OR NEW.belongs_to_scope IS DISTINCT FROM OLD.belongs_to_scope
    OR NEW.decided_on IS DISTINCT FROM OLD.decided_on
  ) THEN
    RAISE EXCEPTION 'company_decisions: conteúdo só pode ser corrigido nas primeiras 24h -- para mudar de posição, registre uma nova decisão que substitui esta';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.forbid_company_decision_rewrite() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_company_decisions_history ON public.company_decisions;
CREATE TRIGGER trg_company_decisions_history BEFORE UPDATE ON public.company_decisions
  FOR EACH ROW EXECUTE FUNCTION public.forbid_company_decision_rewrite();

DROP TRIGGER IF EXISTS trg_company_decisions_updated_at ON public.company_decisions;
CREATE TRIGGER trg_company_decisions_updated_at BEFORE UPDATE ON public.company_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. company_supersede_decision — "decidimos X, agora decidimos Y",
--    atômico. Mesmo mecanismo de personal_supersede_decision (SQL 98),
--    SECURITY INVOKER (roda com RLS/GRANTs de quem chama -- nunca
--    bypass), autorização via can_write_client_company(p_client_id).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.company_supersede_decision(
  p_old_id     UUID,
  p_client_id  UUID,
  p_payload    JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old     public.company_decisions%ROWTYPE;
  v_new_id  UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.can_write_client_company(p_client_id) THEN
    RAISE EXCEPTION 'not_authorized_for_company' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old FROM public.company_decisions
   WHERE id = p_old_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decision_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_old.status <> 'active' THEN RAISE EXCEPTION 'decision_already_superseded' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.company_decisions (
    client_id, created_by, title, decision, context, origin, impact,
    client_validation, belongs_to_scope, generates_task, generates_project, generates_budget,
    decided_on, review_at, supersedes_decision_id
  ) VALUES (
    p_client_id,
    auth.uid(),
    coalesce(nullif(btrim(coalesce(p_payload->>'title', '')), ''), v_old.title),
    btrim(p_payload->>'decision'),
    nullif(btrim(coalesce(p_payload->>'context', '')), ''),
    coalesce(nullif(p_payload->>'origin', ''), v_old.origin),
    nullif(p_payload->>'impact', ''),
    coalesce(nullif(p_payload->>'client_validation', ''), v_old.client_validation),
    (p_payload->>'belongs_to_scope')::boolean,
    coalesce((p_payload->>'generates_task')::boolean, false),
    coalesce((p_payload->>'generates_project')::boolean, false),
    coalesce((p_payload->>'generates_budget')::boolean, false),
    coalesce((p_payload->>'decided_on')::date, CURRENT_DATE),
    nullif(p_payload->>'review_at', '')::date,
    v_old.id
  )
  RETURNING id INTO v_new_id;

  UPDATE public.company_decisions SET status = 'superseded' WHERE id = v_old.id;

  RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.company_supersede_decision(UUID, UUID, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.company_supersede_decision(UUID, UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. commercial_meetings / commercial_proposals — permitir vínculo a
--    uma Company JÁ FECHADA (clients), não só a um lead em negociação.
--    Aditivo: lead_id já era nullable (confirmado antes de escrever
--    este SQL -- nunca suposto), então só ADICIONA client_id + exige
--    que pelo menos um dos dois esteja presente. RLS existente
--    (is_admin()/has_comercial_role()) já cobre ambos os casos --
--    nenhuma policy nova necessária.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.commercial_meetings
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.commercial_meetings
  DROP CONSTRAINT IF EXISTS chk_commercial_meetings_lead_or_client;
ALTER TABLE public.commercial_meetings
  ADD CONSTRAINT chk_commercial_meetings_lead_or_client
  CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_commercial_meetings_client
  ON public.commercial_meetings (client_id) WHERE client_id IS NOT NULL;

COMMENT ON COLUMN public.commercial_meetings.client_id IS
  'SQL 99 -- reunião com uma Company já fechada (QBR, revisão mensal, '
  'upsell). lead_id continua existindo para reuniões em negociação -- '
  'uma linha nunca tem os dois ao mesmo tempo por regra de produto '
  '(a aplicação decide qual preencher conforme a tela de origem), mas o '
  'banco só exige pelo menos um presente.';

ALTER TABLE public.commercial_proposals
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.commercial_proposals
  DROP CONSTRAINT IF EXISTS chk_commercial_proposals_lead_or_client;
ALTER TABLE public.commercial_proposals
  ADD CONSTRAINT chk_commercial_proposals_lead_or_client
  CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_commercial_proposals_client
  ON public.commercial_proposals (client_id) WHERE client_id IS NOT NULL;

COMMENT ON COLUMN public.commercial_proposals.client_id IS
  'SQL 99 -- proposta para uma Company já fechada (upsell/extra), '
  'distinta de uma proposta de fechamento inicial (lead_id). Mesma regra '
  'de commercial_meetings.client_id acima.';

-- ─────────────────────────────────────────────────────────────
-- 4. roadmap_items — "Próxima Janela": estágio de planejamento (nunca
--    pula direto pra execução) + horizonte (retrospectiva/imediato/
--    próxima janela) + link opcional pra qual Decisão originou o item.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.roadmap_items
  ADD COLUMN IF NOT EXISTS planning_stage TEXT NOT NULL DEFAULT 'idea';
ALTER TABLE public.roadmap_items
  DROP CONSTRAINT IF EXISTS roadmap_items_planning_stage_check;
ALTER TABLE public.roadmap_items
  ADD CONSTRAINT roadmap_items_planning_stage_check
  CHECK (planning_stage IN ('idea', 'pre_planning', 'in_analysis', 'awaiting_decision', 'approved', 'cancelled'));

ALTER TABLE public.roadmap_items
  ADD COLUMN IF NOT EXISTS horizon TEXT;
ALTER TABLE public.roadmap_items
  DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;
ALTER TABLE public.roadmap_items
  ADD CONSTRAINT roadmap_items_horizon_check
  CHECK (horizon IS NULL OR horizon IN ('retrospective', 'immediate', 'next_window'));

ALTER TABLE public.roadmap_items
  ADD COLUMN IF NOT EXISTS decision_id UUID REFERENCES public.company_decisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_items_client_horizon
  ON public.roadmap_items (client_id, horizon) WHERE horizon IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roadmap_items_decision
  ON public.roadmap_items (decision_id) WHERE decision_id IS NOT NULL;

COMMENT ON COLUMN public.roadmap_items.planning_stage IS
  'SQL 99 -- "Próxima Janela" (seção 11 do brief de retomada): uma ideia '
  'nunca vira execução sozinha. idea -> pre_planning -> in_analysis -> '
  'awaiting_decision -> approved (só approved é elegível pra status '
  'virar in_progress) ou cancelled. Nunca inferido a partir de `status` '
  '-- eixo independente.';
COMMENT ON COLUMN public.roadmap_items.horizon IS
  'SQL 99 -- planejamento contínuo em três tempos (seção 10 do brief): '
  'retrospective (o que já aconteceu), immediate (próximo período, já '
  'decidido), next_window (começando a surgir, ainda não é hora de '
  'executar). NULL = item antigo, sem horizonte classificado ainda.';

-- ─────────────────────────────────────────────────────────────
-- 5. client_projects — separação de escopo (seção 17 do brief).
--    Projeto-level (não task-level, por ora -- granularidade mínima
--    que já resolve o caso de uso descrito: "uma ideia pode fazer parte
--    da estratégia sem autorização automática de execução").
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.client_projects
  ADD COLUMN IF NOT EXISTS scope_category TEXT NOT NULL DEFAULT 'contratado';
ALTER TABLE public.client_projects
  DROP CONSTRAINT IF EXISTS client_projects_scope_category_check;
ALTER TABLE public.client_projects
  ADD CONSTRAINT client_projects_scope_category_check
  CHECK (scope_category IN ('contratado', 'bonus', 'planejamento', 'fora_do_escopo', 'orcamento_pendente', 'extra_aprovado'));

COMMENT ON COLUMN public.client_projects.scope_category IS
  'SQL 99 -- contratado (padrão) / bonus / planejamento (ainda não '
  'autorizado a executar) / fora_do_escopo / orcamento_pendente / '
  'extra_aprovado. Nunca inferido -- sempre setado explicitamente pela '
  'aplicação.';

COMMIT;
