-- ============================================================
-- LOKAT OS — SQL 103 · commercial_leads/commercial_meetings/
-- commercial_proposals/commercial_activities não reconhecem super_admin
-- STATUS: DB MIGRATION PENDING -- NÃO APLICADA. Revisada na missão
-- PROMPT 04 após mapear TODOS os usos de is_admin() antes de corrigir
-- (confirmado via pg_policies: is_admin() só é referenciado nestas 4
-- policies, em nenhum outro lugar do schema -- nem em outra policy nem
-- dentro de outra função SQL. Blast radius real = exatamente essas 4
-- tabelas, nada mais).
--
-- CORREÇÃO MÍNIMA, NÃO GLOBAL (conforme pedido explícito da missão --
-- "não amplie privilégios de forma global"): NÃO redefine is_admin()
-- (que continuaria significando "só role=admin" em qualquer outro
-- lugar que algum dia a use). Em vez disso, troca QUAL função as 4
-- policies comerciais chamam, pra uma que JÁ EXISTE e JÁ é usada em
-- outras 7 tabelas do sistema com exatamente essa semântica
-- (`is_admin_or_super()`, idêntica a `is_admin_user()` -- duas funções
-- redundantes pré-existentes, nenhuma criada por esta missão):
--   SELECT EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND role IN ('admin','super_admin'))
-- Ou seja: super_admin passa a ter, em commercial_leads/meetings/
-- proposals/activities, o MESMO acesso que já tem em client_files,
-- client_portal_settings, client_project_tasks, client_projects,
-- client_user_access (todas já usam is_admin_or_super()) -- consistência
-- com um padrão já estabelecido, não um privilégio novo inventado.
--
-- OPERACIONAL: propositalmente NÃO incluído aqui. `clients` dá acesso
-- de equipe a admin/super_admin/operacional, mas client_files/
-- client_projects/etc. (que usam is_admin_or_super()) NÃO incluem
-- operacional -- há uma inconsistência real no sistema sobre se
-- operacional deveria ter esse nível de acesso em tabelas satélite.
-- Resolver isso exige confirmação humana da regra de negócio (a missão
-- pediu explicitamente para não ampliar o acesso de operacional sem
-- essa comprovação) -- fica registrado como pendência separada, não
-- decidido por este agente.
--
-- EVIDÊNCIA DO BUG (antes da correção, simulação real revertida):
-- super_admin tentando UPDATE commercial_leads -- 0 linhas afetadas,
-- RLS bloqueou silenciosamente (sem erro de SQL). Mesmo teste com
-- is_admin_or_super() no lugar de is_admin() nessas policies resolveria
-- (a função já existe e já teria permitido, confirmado por leitura do
-- código-fonte da função -- reaplicar o teste completo exige a
-- migration realmente aplicada, fora do escopo autorizado aqui).
--
-- Rollback: recriar as 4 policies com `is_admin()` no lugar de
-- `is_admin_or_super()` (texto original preservado nos comentários
-- abaixo de cada CREATE POLICY).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin_or_super' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'public.is_admin_or_super() não existe -- pré-requisito confirmado presente em 2026-11-21, reconfirme antes de aplicar.';
  END IF;
END $$;

BEGIN;

-- Original: USING (is_admin()) WITH CHECK (is_admin())
DROP POLICY IF EXISTS "admin_all_leads" ON public.commercial_leads;
CREATE POLICY "admin_all_leads" ON public.commercial_leads FOR ALL TO authenticated
  USING (public.is_admin_or_super())
  WITH CHECK (public.is_admin_or_super());

-- Original: USING (is_admin()) WITH CHECK (is_admin())
DROP POLICY IF EXISTS "admin_all_meetings" ON public.commercial_meetings;
CREATE POLICY "admin_all_meetings" ON public.commercial_meetings FOR ALL TO authenticated
  USING (public.is_admin_or_super())
  WITH CHECK (public.is_admin_or_super());

-- Original: USING (is_admin()) WITH CHECK (is_admin())
DROP POLICY IF EXISTS "admin_all_proposals" ON public.commercial_proposals;
CREATE POLICY "admin_all_proposals" ON public.commercial_proposals FOR ALL TO authenticated
  USING (public.is_admin_or_super())
  WITH CHECK (public.is_admin_or_super());

-- Original: USING (is_admin()) WITH CHECK (is_admin())
DROP POLICY IF EXISTS "admin_all_activities" ON public.commercial_activities;
CREATE POLICY "admin_all_activities" ON public.commercial_activities FOR ALL TO authenticated
  USING (public.is_admin_or_super())
  WITH CHECK (public.is_admin_or_super());

COMMIT;
