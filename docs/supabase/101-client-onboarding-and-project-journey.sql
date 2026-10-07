-- ============================================================
-- LOKAT OS — SQL 101 · Client Onboarding + Project Journey fields
-- STATUS: DB MIGRATION PENDING -- NÃO APLICADA EM PRODUCTION.
-- NÃO EXECUTAR agora (mesmo bloqueio de permissão de SQL 99/SQL 100 --
-- ver relatório da FASE 1C). Escrita/testada localmente apenas.
--
-- Contexto (FASE 1C — Comercial + Jornada do Cliente + Onboarding
-- Operacional): auditoria confirmou que NÃO existe nenhuma entidade de
-- "onboarding como processo" (só `onboarding_profiles`, que é Company
-- DNA/briefing, e o wizard público /onboarding/*, que é cadastro
-- inicial de self-service -- propósitos diferentes, nunca
-- reaproveitáveis aqui). O único precedente conceitual é
-- `src/lib/client-lifecycle.ts#OnboardingChecklist` -- um struct fixo
-- de 6 booleans, órfão (zero importadores), fino demais para o que
-- esta fase precisa (itens dinâmicos, por template, com lado
-- responsável/visibilidade/bloqueio) -- não reaproveitável como
-- ENTIDADE, mas suas funções de transição de status
-- (isValidStatusTransition/getStatusFromEvent) finalmente ganham uso
-- real: src/lib/client-onboarding/adapters.ts as chama de verdade.
--
-- Deliberadamente NÃO cria um novo enum de "jornada macro" (LEAD,
-- QUALIFICACAO, ...) -- commercial_leads.pipeline_stage (SQL 15) já
-- cobre lead->fechado, e clients.status (baseline) já cobre
-- onboarding->ativo->pausado->encerrado. A jornada é uma PROJEÇÃO
-- computada em cima dos dois (src/lib/client-journey/), nunca um
-- terceiro status redundante.
--
-- Rollback: docs/supabase/101-client-onboarding-and-project-journey-rollback.sql
-- Test plan: docs/supabase/101-client-onboarding-and-project-journey-test-plan.sql
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'public.clients não existe. Aplique a baseline antes deste SQL.';
  END IF;
  IF to_regclass('public.client_projects') IS NULL OR to_regclass('public.commercial_meetings') IS NULL OR to_regclass('public.commercial_leads') IS NULL THEN
    RAISE EXCEPTION 'client_projects/commercial_meetings/commercial_leads não existem. Aplique as baselines correspondentes antes deste SQL.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'can_access_client_company'
  ) THEN
    RAISE EXCEPTION 'can_access_client_company()/can_write_client_company() não existem. Aplique SQL 91 antes deste SQL.';
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
-- 1. client_onboarding_templates (catálogo estático -- nunca
--    Company-scoped) + client_onboarding_template_items (os itens
--    padrão de cada template). Seção 8: "um cliente pode ter
--    combinação de templates" -- nunca hardcoded por cliente.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_onboarding_templates (
  code        TEXT PRIMARY KEY CHECK (code = upper(code)),
  label       TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_onboarding_template_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code           TEXT NOT NULL REFERENCES public.client_onboarding_templates(code) ON DELETE CASCADE,
  item_key                TEXT NOT NULL,
  category                TEXT,
  label                   TEXT NOT NULL,
  responsible_side        TEXT NOT NULL CHECK (responsible_side IN ('CLIENT', 'LOKAT', 'SHARED')),
  default_visibility      TEXT NOT NULL DEFAULT 'CLIENT_VISIBLE'
                          CHECK (default_visibility IN ('INTERNAL_ONLY', 'CLIENT_VISIBLE', 'CLIENT_ACTION_REQUIRED', 'CLIENT_APPROVAL_REQUIRED')),
  is_required_for_kickoff BOOLEAN NOT NULL DEFAULT false,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_template_item UNIQUE (template_code, item_key)
);

REVOKE ALL ON TABLE public.client_onboarding_templates, public.client_onboarding_template_items FROM PUBLIC, anon, service_role;
GRANT SELECT ON TABLE public.client_onboarding_templates, public.client_onboarding_template_items TO authenticated;
ALTER TABLE public.client_onboarding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_onboarding_template_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "onboarding_templates_select_all" ON public.client_onboarding_templates;
CREATE POLICY "onboarding_templates_select_all" ON public.client_onboarding_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "onboarding_templates_admin_write" ON public.client_onboarding_templates;
CREATE POLICY "onboarding_templates_admin_write" ON public.client_onboarding_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')));

DROP POLICY IF EXISTS "onboarding_template_items_select_all" ON public.client_onboarding_template_items;
CREATE POLICY "onboarding_template_items_select_all" ON public.client_onboarding_template_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "onboarding_template_items_admin_write" ON public.client_onboarding_template_items;
CREATE POLICY "onboarding_template_items_admin_write" ON public.client_onboarding_template_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')));

COMMENT ON TABLE public.client_onboarding_templates IS
  'FASE 1C -- catálogo de templates de onboarding por serviço LOKAT (MARKETING/SOCIAL_MEDIA/TRAFEGO/AUDIOVISUAL/SITE/AUTOMACAO/ESTRUTURA_DIGITAL/PROJETO_COMPLETO). Dado de referência, nunca Company-scoped. Não confundir com business-niche-packs.ts (nicho do NEGÓCIO do cliente, ex. food_service) -- eixo diferente.';
COMMENT ON TABLE public.client_onboarding_template_items IS
  'FASE 1C -- itens padrão de cada template; copiados (nunca referenciados por FK viva) para client_onboarding_items quando um onboarding real é criado a partir de um ou mais templates.';

-- ─────────────────────────────────────────────────────────────
-- 2. client_onboardings -- processo real de onboarding de UMA Company.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_onboardings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status                    TEXT NOT NULL DEFAULT 'NOT_STARTED'
                            CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INTERNAL', 'BLOCKED', 'READY_FOR_KICKOFF', 'COMPLETED', 'CANCELLED')),
  template_codes            TEXT[] NOT NULL DEFAULT '{}',
  started_at                TIMESTAMPTZ,
  target_completion_at      TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  owner_id                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  progress                  INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_from              TEXT NOT NULL DEFAULT 'manual' CHECK (created_from IN ('commercial_handoff', 'manual')),
  -- Seção 3/4: referências opcionais ao marco comercial que originou o onboarding.
  commercial_opportunity_id UUID REFERENCES public.commercial_leads(id) ON DELETE SET NULL,
  -- Nenhuma entidade de "contrato" existe no schema (confirmado pela
  -- auditoria da retomada do produto -- gap real, fora de escopo desta
  -- fase). Guardado sem FK de propósito -- não há para onde apontar
  -- ainda; quando essa entidade existir, uma migration futura adiciona
  -- a FK real.
  contract_id               UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_onboardings_client ON public.client_onboardings (client_id);
CREATE INDEX IF NOT EXISTS idx_client_onboardings_status ON public.client_onboardings (status);

ALTER TABLE public.client_onboardings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_onboardings_select" ON public.client_onboardings;
DROP POLICY IF EXISTS "client_onboardings_insert" ON public.client_onboardings;
DROP POLICY IF EXISTS "client_onboardings_update" ON public.client_onboardings;
DROP POLICY IF EXISTS "client_onboardings_delete" ON public.client_onboardings;
CREATE POLICY "client_onboardings_select" ON public.client_onboardings FOR SELECT TO authenticated USING (public.can_access_client_company(client_id));
CREATE POLICY "client_onboardings_insert" ON public.client_onboardings FOR INSERT TO authenticated WITH CHECK (public.can_write_client_company(client_id));
CREATE POLICY "client_onboardings_update" ON public.client_onboardings FOR UPDATE TO authenticated USING (public.can_write_client_company(client_id)) WITH CHECK (public.can_write_client_company(client_id));
CREATE POLICY "client_onboardings_delete" ON public.client_onboardings FOR DELETE TO authenticated USING (public.can_write_client_company(client_id));

REVOKE ALL ON TABLE public.client_onboardings FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_onboardings TO authenticated;

COMMENT ON TABLE public.client_onboardings IS
  'FASE 1C -- processo real de onboarding de uma Company (distinto de clients.status e de company_diagnostics). Criado tipicamente via handoff comercial (commercial_leads.pipeline_stage=fechado -> aqui), nunca automaticamente a partir de qualquer ideia.';
COMMENT ON COLUMN public.client_onboardings.contract_id IS
  'Sem FK de propósito -- nenhuma entidade de contrato existe hoje no schema (gap confirmado pela auditoria). Campo reservado para quando essa entidade existir.';

DROP TRIGGER IF EXISTS trg_client_onboardings_updated_at ON public.client_onboardings;
CREATE TRIGGER trg_client_onboardings_updated_at BEFORE UPDATE ON public.client_onboardings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. client_onboarding_items -- itens reais de UM onboarding (copiados
--    de templates e/ou ad-hoc). Seção 5/6/13.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_onboarding_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id           UUID NOT NULL REFERENCES public.client_onboardings(id) ON DELETE CASCADE,
  item_key                TEXT,
  category                TEXT,
  label                   TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  responsible_side        TEXT NOT NULL CHECK (responsible_side IN ('CLIENT', 'LOKAT', 'SHARED')),
  status                  TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'REQUESTED', 'RECEIVED', 'IN_REVIEW', 'APPROVED', 'NOT_REQUIRED', 'BLOCKED', 'COMPLETED')),
  -- Seção 13: o que o cliente pode ver/precisa agir -- nunca nota interna/margem/risco.
  visibility              TEXT NOT NULL DEFAULT 'CLIENT_VISIBLE'
                          CHECK (visibility IN ('INTERNAL_ONLY', 'CLIENT_VISIBLE', 'CLIENT_ACTION_REQUIRED', 'CLIENT_APPROVAL_REQUIRED')),
  is_required_for_kickoff BOOLEAN NOT NULL DEFAULT false,
  due_date                DATE,
  notes                   TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000),
  -- Seção 6: NUNCA um segredo/senha -- só uma referência (url de um
  -- arquivo já enviado, link de uma pasta, nunca um token de acesso).
  reference_url           TEXT,
  -- Seção 6: quem TEM o acesso hoje (texto livre -- "Fulano, perfil
  -- editor"), nunca o valor do acesso em si.
  access_holder           TEXT,
  depends_on_item_id       UUID REFERENCES public.client_onboarding_items(id) ON DELETE SET NULL,
  -- FASE 1C.1: quando o onboarding combina múltiplos templates e o
  -- mesmo requisito canônico (item_key) existe em mais de um, este
  -- item é UM SÓ (mesclado -- ver mergeTemplateItems no adapter);
  -- source_templates preserva quais templates o originaram, sem
  -- precisar de uma tabela de junção nova. [] quando o item não veio de
  -- nenhum template (criado fora desse fluxo).
  source_templates        TEXT[] NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_onboarding_item_not_self_dependency CHECK (depends_on_item_id IS NULL OR depends_on_item_id <> id),
  -- FASE 1C.1: defesa em profundidade além do merge na aplicação --
  -- nunca permite dois itens com o mesmo requisito canônico no MESMO
  -- onboarding (NULLs continuam livres -- itens fora do fluxo de
  -- templates nunca têm item_key).
  CONSTRAINT uq_onboarding_item_key UNIQUE (onboarding_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_client_onboarding_items_onboarding ON public.client_onboarding_items (onboarding_id);
CREATE INDEX IF NOT EXISTS idx_client_onboarding_items_status ON public.client_onboarding_items (onboarding_id, status);

ALTER TABLE public.client_onboarding_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_onboarding_items_select" ON public.client_onboarding_items;
DROP POLICY IF EXISTS "client_onboarding_items_insert" ON public.client_onboarding_items;
DROP POLICY IF EXISTS "client_onboarding_items_update" ON public.client_onboarding_items;
DROP POLICY IF EXISTS "client_onboarding_items_delete" ON public.client_onboarding_items;
CREATE POLICY "client_onboarding_items_select" ON public.client_onboarding_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_onboardings o WHERE o.id = onboarding_id AND public.can_access_client_company(o.client_id)));
CREATE POLICY "client_onboarding_items_insert" ON public.client_onboarding_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.client_onboardings o WHERE o.id = onboarding_id AND public.can_write_client_company(o.client_id)));
CREATE POLICY "client_onboarding_items_update" ON public.client_onboarding_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_onboardings o WHERE o.id = onboarding_id AND public.can_write_client_company(o.client_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.client_onboardings o WHERE o.id = onboarding_id AND public.can_write_client_company(o.client_id)));
CREATE POLICY "client_onboarding_items_delete" ON public.client_onboarding_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_onboardings o WHERE o.id = onboarding_id AND public.can_write_client_company(o.client_id)));

REVOKE ALL ON TABLE public.client_onboarding_items FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_onboarding_items TO authenticated;

COMMENT ON TABLE public.client_onboarding_items IS
  'FASE 1C -- itens reais de um onboarding. responsible_side/status/visibility seguem exatamente o contrato do brief (seção 5/13). access_holder/reference_url NUNCA guardam segredo/senha (seção 6) -- apenas metadado de quem tem acesso e uma referência, nunca o valor sensível em si.';

DROP TRIGGER IF EXISTS trg_client_onboarding_items_updated_at ON public.client_onboarding_items;
CREATE TRIGGER trg_client_onboarding_items_updated_at BEFORE UPDATE ON public.client_onboarding_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. commercial_meetings -- reunião de alinhamento é um MARCO do
--    onboarding, nunca um sistema de reunião paralelo (seção 7).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.commercial_meetings ADD COLUMN IF NOT EXISTS onboarding_id UUID REFERENCES public.client_onboardings(id) ON DELETE SET NULL;
ALTER TABLE public.commercial_meetings ADD COLUMN IF NOT EXISTS is_alignment_meeting BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_commercial_meetings_onboarding ON public.commercial_meetings (onboarding_id) WHERE onboarding_id IS NOT NULL;

COMMENT ON COLUMN public.commercial_meetings.onboarding_id IS 'FASE 1C -- liga uma reunião (client_id já existente de SQL 99) ao onboarding específico, quando aplicável.';
COMMENT ON COLUMN public.commercial_meetings.is_alignment_meeting IS 'FASE 1C -- marca a reunião de alinhamento (primeiro marco pós-contrato, seção 7) -- nunca mais de uma por onboarding, validado na aplicação, não por constraint (reagendamento legítimo pode criar uma segunda linha).';

-- ─────────────────────────────────────────────────────────────
-- 5. client_projects -- campos de visualização (seção 19) + origem no
--    escopo confirmado do onboarding (seção 17: projeto nasce do
--    escopo, nunca de qualquer ideia solta).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS project_type TEXT;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS current_phase TEXT;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS client_dependency TEXT;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS onboarding_id UUID REFERENCES public.client_onboardings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_client_projects_onboarding ON public.client_projects (onboarding_id) WHERE onboarding_id IS NOT NULL;

COMMENT ON COLUMN public.client_projects.current_phase IS 'FASE 1C -- fase descritiva de execução (ex.: "Planejamento", "Produção", "Revisão", "Entrega"), eixo independente de status (lifecycle: active/paused/completed/archived). Texto livre, nunca um enum fechado nesta fase -- cada tipo de projeto tem fases diferentes.';
COMMENT ON COLUMN public.client_projects.blocked_reason IS 'FASE 1C -- presença (não-null) = projeto bloqueado; motivo em texto. NULL = sem bloqueio.';
COMMENT ON COLUMN public.client_projects.onboarding_id IS 'FASE 1C -- projeto nasce do escopo confirmado de um onboarding (seção 17) -- NULL para projetos criados fora desse fluxo (nunca obrigatório).';

-- ─────────────────────────────────────────────────────────────
-- 6. Catálogo de templates (seção 8) -- dado de REFERÊNCIA/plataforma,
--    nunca de um cliente ("não hardcodar Tayannara"). Sem isto a tabela
--    fica vazia e nenhum onboarding pode ser criado pela UI. Checklist
--    base = seção 5 do brief, igual para os 8 serviços (o brief não
--    diferencia item por serviço, só a COMBINAÇÃO de templates por
--    cliente via client_onboardings.template_codes). Idempotente
--    (ON CONFLICT DO NOTHING) -- seguro rodar esta migration mais de
--    uma vez.
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.client_onboarding_templates (code, label, description) VALUES
  ('MARKETING',         'Marketing',               'Posicionamento, conteúdo e gestão de marca.'),
  ('SOCIAL_MEDIA',      'Social Media',             'Gestão de redes sociais e conteúdo recorrente.'),
  ('TRAFEGO',           'Tráfego pago',             'Campanhas de mídia paga e performance.'),
  ('AUDIOVISUAL',       'Audiovisual',              'Produção de vídeo/fotografia.'),
  ('SITE',              'Site',                     'Criação/manutenção de site institucional ou e-commerce.'),
  ('AUTOMACAO',         'Automação',                'Fluxos de automação e integrações operacionais.'),
  ('ESTRUTURA_DIGITAL', 'Estrutura digital',        'Infraestrutura digital: domínio, hospedagem, ferramentas.'),
  ('PROJETO_COMPLETO',  'Projeto completo',         'Combinação ampla de frentes -- operação completa.')
ON CONFLICT (code) DO NOTHING;

-- Checklist base (seção 5) -- replicado para cada template. sort_order
-- preserva a ordem sugerida pelo brief; is_required_for_kickoff só nos
-- itens que o brief trata como mínimos pra liberar operação (seção 18).
WITH base_items (item_key, category, label, responsible_side, default_visibility, is_required_for_kickoff, sort_order) AS (
  VALUES
    ('contrato_confirmado',   'Comercial',  'Contrato confirmado',                       'LOKAT',  'CLIENT_VISIBLE',          true,  1),
    ('dados_cadastrais',      'Cadastro',   'Dados cadastrais completos',                 'CLIENT', 'CLIENT_ACTION_REQUIRED', true,  2),
    ('responsavel_cliente',   'Cadastro',   'Responsável do lado do cliente definido',    'CLIENT', 'CLIENT_ACTION_REQUIRED', true,  3),
    ('responsavel_lokat',     'Cadastro',   'Responsável do lado LOKAT definido',         'LOKAT',  'CLIENT_VISIBLE',          true,  4),
    ('reuniao_alinhamento',   'Alinhamento','Reunião de alinhamento realizada',           'SHARED', 'CLIENT_VISIBLE',          true,  5),
    ('escopo_confirmado',     'Escopo',     'Escopo confirmado',                           'SHARED', 'CLIENT_APPROVAL_REQUIRED', true, 6),
    ('identidade_visual',     'Materiais',  'Identidade visual / logo em alta resolução',  'CLIENT', 'CLIENT_ACTION_REQUIRED', false, 7),
    ('fotos',                 'Materiais',  'Fotos',                                       'CLIENT', 'CLIENT_ACTION_REQUIRED', false, 8),
    ('videos',                'Materiais',  'Vídeos',                                      'CLIENT', 'CLIENT_ACTION_REQUIRED', false, 9),
    ('acesso_redes_sociais',  'Acessos',    'Acesso a redes sociais / Meta / Google',      'CLIENT', 'CLIENT_ACTION_REQUIRED', false, 10),
    ('dominio',               'Acessos',    'Domínio',                                     'CLIENT', 'CLIENT_ACTION_REQUIRED', false, 11),
    ('hospedagem',            'Acessos',    'Hospedagem',                                  'CLIENT', 'CLIENT_ACTION_REQUIRED', false, 12),
    ('whatsapp',              'Acessos',    'WhatsApp comercial',                          'CLIENT', 'CLIENT_ACTION_REQUIRED', false, 13),
    ('materiais_institucionais','Materiais','Materiais institucionais',                    'CLIENT', 'CLIENT_ACTION_REQUIRED', false, 14),
    ('calendario',            'Planejamento','Calendário definido',                        'SHARED', 'CLIENT_VISIBLE',         false, 15),
    ('integracoes',           'Técnico',    'Integrações necessárias mapeadas',            'LOKAT',  'INTERNAL_ONLY',          false, 16),
    ('aprovacoes_iniciais',   'Aprovações', 'Aprovações iniciais',                          'CLIENT', 'CLIENT_APPROVAL_REQUIRED', false, 17),
    ('datas_importantes',     'Planejamento','Datas importantes registradas',               'SHARED', 'CLIENT_VISIBLE',         false, 18),
    ('primeiro_plano',        'Planejamento','Primeiro plano definido',                      'LOKAT',  'CLIENT_VISIBLE',         false, 19),
    ('kickoff',               'Kickoff',    'Kickoff realizado',                             'SHARED', 'CLIENT_VISIBLE',        true,  20)
)
INSERT INTO public.client_onboarding_template_items (template_code, item_key, category, label, responsible_side, default_visibility, is_required_for_kickoff, sort_order)
SELECT t.code, b.item_key, b.category, b.label, b.responsible_side, b.default_visibility, b.is_required_for_kickoff, b.sort_order
FROM public.client_onboarding_templates t CROSS JOIN base_items b
WHERE t.code IN ('MARKETING', 'SOCIAL_MEDIA', 'TRAFEGO', 'AUDIOVISUAL', 'SITE', 'AUTOMACAO', 'ESTRUTURA_DIGITAL', 'PROJETO_COMPLETO')
ON CONFLICT (template_code, item_key) DO NOTHING;

COMMIT;
