-- ============================================================
-- LOKAT OS — SQL 103 · is_admin() não reconhece super_admin/operacional
-- STATUS: DB MIGRATION PENDING -- NÃO APLICADA. Preparada na missão
-- PROMPT 03 (comercial/conversão), achado via simulação REAL de RLS
-- (transação com SET LOCAL ROLE authenticated + request.jwt.claims,
-- revertida -- nunca tocou dado real), não por leitura de policy.
--
-- GAP CONFIRMADO (pré-existente, não introduzido pela conversão nova):
-- `public.is_admin()` só retorna true pra role = 'admin' literal.
-- A policy `admin_all_leads` em `commercial_leads` (FOR ALL USING
-- is_admin()) por isso NUNCA libera super_admin nem operacional --
-- só comercial/sdr/closer DONOS do próprio lead conseguem escrever.
--
-- IMPACTO REAL: um usuário super_admin ou operacional, hoje, NÃO
-- consegue:
--   - mover um lead de estágio no pipeline (`moveTo()`,
--     src/app/operacional/comercial/pipeline/_client-content.tsx --
--     já existia antes desta missão, sempre teve esse problema);
--   - completar "Converter em cliente" (convertLeadToClient) -- o
--     cliente chega a ser criado, mas o vínculo final falha
--     silenciosamente (0 linhas afetadas pela RLS, sem erro de SQL --
--     o código já trata isso como link_lead_failed, nunca finge
--     sucesso, mas a OPERAÇÃO REAL fica incompleta pra esses 2 perfis);
--   - completar "Recuperar vínculo" de diagnóstico (recoverDiagnosticLead),
--     pelo mesmo motivo.
--
-- Correção proposta (NÃO aplicada): redefinir is_admin() pra reconhecer
-- também super_admin, e dar a operacional o mesmo acesso de equipe já
-- previsto nas próprias policies de `clients`.
--
-- Rollback: reverter is_admin() pra definição anterior (só role='admin')
-- e DROP POLICY da nova policy de operacional abaixo.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'SQL 103 -- corrigido pra reconhecer super_admin além de admin (gap confirmado via simulação real de RLS: super_admin não conseguia escrever em commercial_leads, quebrando o pipeline comercial e a conversão lead->cliente pra esse perfil).';

-- operacional precisa do mesmo acesso de equipe que já tem em `clients`
-- -- hoje não tem nenhuma policy própria em commercial_leads.
DROP POLICY IF EXISTS "operacional_all_leads" ON public.commercial_leads;
CREATE POLICY "operacional_all_leads" ON public.commercial_leads FOR ALL TO authenticated
  USING (public.current_user_role() = 'operacional')
  WITH CHECK (public.current_user_role() = 'operacional');

COMMIT;
