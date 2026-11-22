-- ============================================================================
-- 106 — meta_connections: tokens deixam de ser legíveis pela sessão do navegador.
--
-- ESTADO: NÃO APLICADA. Aplicar SÓ depois do deploy do commit que faz
-- /api/meta/assets ler o token pelo cliente de servidor (service role).
-- Antes disso, a rota /api/meta/assets quebraria.
--
-- Motivo: a policy de SELECT de meta_connections libera a linha inteira para
-- o próprio usuário e admins pela API REST (chave pública + sessão), o que
-- inclui as colunas de token. Todas as rotas do app que usam o token já leem
-- pelo servidor, com exceção de /api/meta/assets (corrigida no mesmo commit).
--
-- O que muda: privilégio de coluna. A RLS continua igual; o navegador segue
-- lendo id, página, status, validade e escopos — só não lê os tokens.
-- service_role (servidor) não é afetado.
--
-- Pendente (não coberto aqui): criptografia dos tokens em repouso e limpeza
-- de conexões antigas. Ambos mudam dados de produção: decidir antes.
-- ============================================================================
BEGIN;

REVOKE SELECT ON public.meta_connections FROM anon, authenticated;
REVOKE INSERT, UPDATE ON public.meta_connections FROM anon;

GRANT SELECT (
  id, connected_by, client_id, account_type, provider, meta_app_id, meta_user_id,
  page_id, page_name, instagram_business_account_id, instagram_username,
  token_expires_at, scopes, status, is_active, created_at, updated_at
) ON public.meta_connections TO authenticated;

COMMIT;

-- Rollback:
-- BEGIN;
-- GRANT SELECT ON public.meta_connections TO authenticated;
-- COMMIT;
