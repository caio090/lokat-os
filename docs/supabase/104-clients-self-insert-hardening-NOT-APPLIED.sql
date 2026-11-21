-- ============================================================
-- LOKAT OS — SQL 104 · "clients: cliente insere o próprio" sem filtro de role
-- STATUS: DB MIGRATION PENDING -- NÃO APLICADA. Preparada na missão
-- PROMPT 04, achado confirmado por simulação real de RLS (transação
-- revertida) + leitura de todo código que insere em `clients`.
--
-- GAP CONFIRMADO: `with_check: (owner_id = auth.uid())`, SEM nenhuma
-- checagem de role. Isso não restringe a usuários role='cliente' apesar
-- do nome da policy -- QUALQUER usuário autenticado, de qualquer role,
-- consegue inserir uma linha arbitrária em `clients` desde que
-- `owner_id = auth.uid()`. Confirmado via simulação real (role
-- 'cliente' conseguiu inserir; o mesmo aconteceria com qualquer role).
--
-- INVESTIGAÇÃO DO USO REAL (antes de propor a correção, conforme
-- pedido): os únicos 3 pontos do código que inserem em `clients` são:
--   1. src/app/api/admin/clients/route.ts -- usa createServerSupabaseClient()
--      (sessão do admin chamador), depende da policy "admin/equipe insere"
--      (role admin/super_admin/operacional) -- NUNCA depende desta policy.
--   2. src/app/onboarding/conclusao/page.tsx (self-signup real) -- NÃO usa
--      INSERT direto: chama a RPC create_client_on_signup() (SECURITY
--      DEFINER), que faz sua própria autorização interna e BYPASSA esta
--      policy inteiramente.
--   3. src/lib/commercial-leads/convert-to-client.ts (esta missão) -- roda
--      como o usuário admin/operacional logado no pipeline, também
--      satisfaz a policy de equipe, nunca dependeu desta policy específica.
-- CONCLUSÃO: nenhum fluxo real e legítimo hoje depende de
-- "clients: cliente insere o próprio" permitir INSERT direto e aberto.
-- Ela é a definição mais permissiva possível sem nenhum consumidor
-- confirmado -- pura superfície de risco.
--
-- CORREÇÃO (conservadora, não remove a policy -- só a restringe, caso
-- exista algum uso futuro planejado de autocadastro direto que este
-- agente não encontrou): exige role literal 'cliente' E limita a UM
-- registro próprio por usuário (nunca permite criar uma 2ª empresa
-- arbitrária depois da primeira).
--
-- Rollback: recriar a policy original (with_check: owner_id = auth.uid(),
-- sem mais nada).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "clients: cliente insere o próprio" ON public.clients;
CREATE POLICY "clients: cliente insere o próprio" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND current_user_role() = 'cliente'
    AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.owner_id = auth.uid())
  );

COMMENT ON POLICY "clients: cliente insere o próprio" ON public.clients IS
  'SQL 104 -- restringe a role=cliente literal (antes aceitava qualquer role autenticado) e a no máximo 1 registro próprio (antes permitia criar quantos quisesse). Nenhum fluxo real confirmado depende do comportamento antigo -- ver investigação no cabeçalho deste arquivo.';

COMMIT;
