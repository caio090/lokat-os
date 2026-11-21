-- ============================================================
-- LOKAT OS — SQL 102 · Unicidade real de clients.email/phone
-- STATUS: DB MIGRATION PENDING -- NÃO APLICADA. Preparada na missão
-- PROMPT 03 (comercial/conversão), NUNCA executada -- fora de escopo
-- desta missão aplicar em Production/banco compartilhado.
--
-- Contexto: convertLeadToClient() (src/lib/commercial-leads/convert-
-- to-client.ts) faz dedup "check-then-act" por email/phone antes de
-- inserir um cliente -- protege contra reenvio sequencial, mas NÃO é
-- atômico contra duas requisições verdadeiramente simultâneas (sem
-- lock/constraint de banco, duas checagens podem ambas concluir "não
-- existe" antes de qualquer insert acontecer). Confirmado por teste
-- dedicado (ver convert-to-client.structural.test.ts, cenário de
-- corrida) que reproduz exatamente essa janela com o código atual.
--
-- Verificação ANTES de propor isto (exigida pela missão): rodado em
-- Production via execute_sql (só leitura) em 2026-11-21 --
--   SELECT lower(email), count(*) FROM clients GROUP BY lower(email) HAVING count(*)>1
--   SELECT phone, count(*) FROM clients GROUP BY phone HAVING count(*)>1
-- Resultado: ZERO duplicatas hoje (só 2 clientes reais no banco). Seguro
-- aplicar sem migração de dados/limpeza prévia.
--
-- AMBIGUIDADE DE NEGÓCIO NÃO RESOLVIDA (documentada, não adivinhada):
-- `clients.agency_id`/`parent_agency_id` já existem no schema (modelo
-- de sub-agência/white-label), mas hoje são NULL nos 2 clientes reais
-- -- o modelo multi-tenant existe na estrutura, mas não está em uso.
-- Se um UNIQUE for GLOBAL (email/phone únicos em toda a base), duas
-- agências diferentes nunca poderão ter cada uma seu próprio registro
-- pro mesmo e-mail/telefone (pode ser correto -- mesma empresa real --
-- ou incorreto, dependendo da regra de negócio real de white-label,
-- que não foi confirmada nesta missão). Por isso este arquivo contém
-- a opção GLOBAL (recomendada pelo estado real de hoje) e deixa
-- registrado que a alternativa escopada por agency_id existe e precisa
-- de decisão humana explícita antes de aplicar, caso o white-label
-- vire uso real.
--
-- Rollback: DROP INDEX IF EXISTS uq_clients_email_norm; DROP INDEX IF EXISTS uq_clients_phone;
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'public.clients não existe.';
  END IF;
END $$;

BEGIN;

-- Opção GLOBAL (recomendada pelo uso real atual -- agency_id sempre NULL hoje).
-- Parcial (WHERE email IS NOT NULL AND email <> ''): nunca conflita com os
-- muitos clientes legados sem e-mail cadastrado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_email_norm
  ON public.clients (lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_phone
  ON public.clients (phone)
  WHERE phone IS NOT NULL AND phone <> '';

COMMENT ON INDEX public.uq_clients_email_norm IS
  'SQL 102 -- garante no banco (não só na aplicação) que dois clientes nunca compartilham e-mail. Revisar se o white-label (agency_id) virar uso real -- pode precisar escopar por agência em vez de ser global.';

-- Se o white-label virar uso real ANTES desta migration ser aplicada,
-- a alternativa escopada seria (NÃO aplicada, só documentada aqui):
--   CREATE UNIQUE INDEX uq_clients_email_norm_per_agency
--     ON public.clients (agency_id, lower(email))
--     WHERE email IS NOT NULL AND email <> '';
-- Decisão de qual das duas usar precisa de um humano confirmando a
-- regra de negócio real, nunca presumida por este agente.

COMMIT;
