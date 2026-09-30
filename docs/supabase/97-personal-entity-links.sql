-- ============================================================
-- LOKAT OS — SQL 97 · MEU PP V2 · FASE 0
-- personal_entity_links — relações genéricas entre objetos PESSOAIS
--
-- Escopo: PERSONAL ONLY. Mesmo padrão de segurança da fundação Personal
-- Core (docs/supabase/legacy/personal-core-*.sql, aplicada em 13/08/2026):
--   1. RLS: o dono (user_id = auth.uid()) é o único que lê/escreve;
--   2. GRANT explícito: só `authenticated` recebe SELECT/INSERT/UPDATE/
--      DELETE; PUBLIC, anon e service_role são REVOGADOS -- service role
--      (BYPASSRLS) nem passa da camada de GRANT;
--   3. Regra de aplicação: o domínio Meu PP nunca usa
--      createSupabaseAdminClient()/service role nesta tabela (teste em
--      src/lib/meu-pp/__tests__/meu-pp-foundation.structural.test.ts).
--
-- Por que esta tabela existe (decisão aprovada na Fase 0): em vez de
-- adicionar deal_id/decision_id/reflection_id/project_id/document_id em
-- dezenas de tabelas, qualquer objeto pessoal A se relaciona a B por
-- (source_type, source_id) → relation_type → (target_type, target_id).
--
-- LIMITAÇÃO DOCUMENTADA — FK POLIMÓRFICA: source_id/target_id podem
-- apontar para tabelas diferentes, então NÃO há FK real para eles (uma
-- FK "universal" não existe em Postgres e não é simulada aqui). A
-- integridade da entidade (o objeto existe? pertence ao mesmo dono?) é
-- validada na camada de aplicação (src/lib/meu-pp/entity-links.ts),
-- sempre com a sessão do próprio usuário -- ou seja, sob RLS das tabelas
-- de origem. Links órfãos (objeto apagado depois) são tolerados e devem
-- ser ignorados/limpos pela aplicação.
--
-- CLIENT PROJECT: quando um objeto pessoal aponta para `client_project`,
-- guarda-se APENAS o id (target_id). Nome, status, cliente e dados
-- financeiros nunca são copiados -- a fonte da verdade continua sendo
-- public.client_projects, lida com as permissões Company de sempre.
--
-- TIPOS: sem ENUM (difícil de evoluir). O banco só garante o FORMATO
-- (slug minúsculo); o vocabulário permitido vive em
-- src/lib/meu-pp/entity-links.ts e é validado na aplicação.
--
-- Nenhuma tabela Personal Core existente é alterada por este arquivo.
-- Numeração: 97 = próximo slot livre real da main (93–96 não são
-- reutilizados -- ver docs/meu-pp/README.md).
-- Rollback: docs/supabase/97-personal-entity-links-rollback.sql
-- Test plan: docs/supabase/97-personal-entity-links-test-plan.sql
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    RAISE EXCEPTION 'public.set_updated_at() não existe. Aplique a baseline (docs/supabase/18 ou /33) antes deste SQL.';
  END IF;
END $$;

BEGIN;

CREATE TABLE IF NOT EXISTS public.personal_entity_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type    TEXT NOT NULL CHECK (source_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  source_id      UUID NOT NULL,
  target_type    TEXT NOT NULL CHECK (target_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  target_id      UUID NOT NULL,
  relation_type  TEXT NOT NULL DEFAULT 'related_to' CHECK (relation_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 4096),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_personal_entity_links_not_self
    CHECK (NOT (source_type = target_type AND source_id = target_id)),
  CONSTRAINT uq_personal_entity_links_edge
    UNIQUE (user_id, source_type, source_id, target_type, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_personal_entity_links_source
  ON public.personal_entity_links (user_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_personal_entity_links_target
  ON public.personal_entity_links (user_id, target_type, target_id);

REVOKE ALL ON TABLE public.personal_entity_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_entity_links TO authenticated;

ALTER TABLE public.personal_entity_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_entity_links_owner_all" ON public.personal_entity_links;
CREATE POLICY "personal_entity_links_owner_all" ON public.personal_entity_links
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

COMMENT ON TABLE public.personal_entity_links IS
  'Meu PP -- relações genéricas A -> relation_type -> B entre objetos PESSOAIS. '
  'PERSONAL ONLY: RLS do dono + GRANT só para authenticated (anon/service_role '
  'revogados). source_id/target_id são polimórficos (sem FK): integridade '
  'validada na aplicação. client_project guarda só o id.';

COMMENT ON COLUMN public.personal_entity_links.metadata IS
  'Objeto JSON pequeno (<= 4 KB) e opcional. Nunca copiar dados de Company/cliente.';

CREATE TRIGGER trg_personal_entity_links_updated_at BEFORE UPDATE ON public.personal_entity_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
