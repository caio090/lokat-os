-- ============================================================
-- LOKAT OS — LEGACY BASELINE · PERSONAL CORE · personal_tasks
-- APLICADA EM PRODUÇÃO EM 13/08/2026 — NÃO REEXECUTAR
--
-- Prova: ledger supabase_migrations.schema_migrations do projeto
-- lokat-os, versão 20260813200621 (personal_core_tasks), conferido ao vivo em
-- 29/09/2026 (Meu PP V2 — Fase 0). O corpo executável abaixo é
-- IDÊNTICO ao SQL registrado no ledger (comparação normalizada, sem
-- comentários e espaços: md5 69de08b9e1bcf72f1606811788ed8401). Schema vivo conferido objeto a
-- objeto (colunas, defaults, constraints, índices, triggers, policies,
-- GRANTs): sem drift. As tabelas estavam vazias na conferência.
--
-- Origem: branch origin/feat/personal-strategy-os, commit 85f3353,
-- arquivo histórico docs/supabase/93-personal-core-tasks.sql. A numeração 93–96
-- colidia com arquivos da main (93-identity-links,
-- 93-studio-visual-assets-storage) e foi abandonada: este arquivo não
-- tem número. Referências internas a "SQL 93/94/95/96" (inclusive nos
-- COMMENT ON já gravados no banco) = legacy/personal-core-{tasks,
-- routines,gratitude,events}.sql.
--
-- Rollback histórico: NÃO trazido para a main (derrubaria tabelas
-- pessoais reais). Permanece apenas no commit 85f3353 como histórico.
-- Documento canônico do módulo: docs/meu-pp/README.md
-- ============================================================
--
-- [HISTÓRICO] Cabeçalho original da Fase 1A.3, preservado abaixo sem as
-- linhas de status antigas (marcavam o SQL como proposta ainda não
-- executada), desmentidas pelo ledger.
-- personal_tasks
--
-- Faz parte da Fase 1A (fundação técnica) do "Meu Painel". Revisão
-- 1A.2 (final SQL review) sobre a revisão 1A.1 desta mesma sprint.
--
--
-- ─────────────────────────────────────────────────────────────
-- DEPENDÊNCIA — public.set_updated_at() (Fase 1A.2, item 2 e 9)
-- ─────────────────────────────────────────────────────────────
-- Auditado: a função JÁ EXISTE na baseline do projeto
-- (docs/supabase/18-contentos-architecture-and-permissions.sql linha 74
-- e docs/supabase/33-financeos-charges-and-payments.sql linha 84, corpo
-- idêntico: `NEW.updated_at = now(); RETURN NEW;`). O Personal Core NÃO
-- é dono desse helper compartilhado e NUNCA a redefine -- só reutiliza
-- via `EXECUTE FUNCTION public.set_updated_at()` no trigger abaixo.
-- Cada um dos 4 arquivos desta série (93-96) faz seu PRÓPRIO pré-check
-- independente (não só este) -- nenhum depende de outro já ter rodado
-- primeiro; cada um depende só de infraestrutura canônica anterior do
-- LOKAT OS (18/33), nunca de um helper "do Personal Core".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    RAISE EXCEPTION 'public.set_updated_at() não existe. Aplique docs/supabase/18 e/ou /33 (ou a baseline equivalente do ambiente) antes deste SQL -- o Personal Core não redefine esse helper compartilhado.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- RLS NÃO PROTEGE CONTRA SERVICE ROLE -- regra de aplicação, não de banco
-- ─────────────────────────────────────────────────────────────
-- Credenciais com BYPASSRLS (a service role key do Supabase é
-- exatamente isso) IGNORAM toda policy de RLS -- estruturalmente
-- impossível de impedir via RLS. A proteção real:
--   1. RLS aqui protege acesso normal authenticated (sessão do próprio
--      usuário).
--   2. APIs do domínio Personal (/api/admin/personal/*) DEVEM usar a
--      sessão autenticada (createServerSupabaseClient()), NUNCA
--      createSupabaseAdminClient()/service role, para leitura OU
--      escrita normal nestas tabelas.
--   3. Nenhum helper "Personal" pode ser escrito para consultar estas
--      tabelas com service role -- acesso privilegiado futuro exige
--      decisão arquitetural nova e explícita, nunca por conveniência.
--   4. Jobs administrativos futuros NÃO ganham acesso automático só por
--      rodarem com privilégio maior.
--
-- ─────────────────────────────────────────────────────────────
-- GRANTS EXPLÍCITOS (Fase 1A.3) — nunca depender de default privileges
-- ─────────────────────────────────────────────────────────────
-- Correção sobre a Fase 1A.2: ali a segurança de GRANT ficava implícita
-- (herdada dos default privileges do projeto Supabase). Esta revisão
-- torna os privilégios de tabela EXPLÍCITOS para as 5 tabelas Personal,
-- como uma segunda camada independente da RLS -- nenhuma das duas
-- depende sozinha da outra pra negar acesso indevido.
--
-- Evidência técnica (Fase 1A.3, item 4) sobre por que revogar de
-- service_role tem efeito real, mesmo com BYPASSRLS: GRANT/REVOKE de
-- tabela e RLS são DUAS camadas de autorização independentes no
-- Postgres. GRANT/REVOKE decide se uma operação é permitida NA TABELA,
-- checado ANTES de qualquer coisa; RLS só filtra QUAIS LINHAS, checado
-- DEPOIS que o GRANT já autorizou a operação. BYPASSRLS isenta uma role
-- só da camada 2 (RLS) -- nunca implica nem restaura privilégio de
-- tabela da camada 1. Ou seja: `REVOKE ALL ... FROM service_role`
-- bloqueia de verdade, independente do BYPASSRLS.
--
-- Decisão: nenhuma funcionalidade existente do produto usa estas 5
-- tabelas (são novas, o módulo Personal Strategy OS ainda não tem
-- código de aplicação) e as APIs Personal foram desenhadas para nunca
-- usar service role -- não há requisito real de infraestrutura que
-- exija o privilégio. `service_role` é revogado nas 5 tabelas como
-- defesa adicional contra uso acidental de
-- createSupabaseAdminClient()/service role nestas tabelas
-- especificamente. `postgres`/table owner NUNCA é tocado (autoridade
-- administrativa do banco, fora do escopo de REVOKE de role).
--
--   anon:          REVOKE ALL -- sem caso de uso legítimo no Personal Core.
--   authenticated: REVOKE ALL, depois GRANT explícito só de
--                  SELECT/INSERT/UPDATE/DELETE -- nunca TRUNCATE,
--                  REFERENCES, TRIGGER, nunca GRANT ALL por comodidade.
--                  RLS (`user_id = (select auth.uid())`) continua
--                  responsável por limitar a linhas do próprio dono.
--   service_role:  REVOKE ALL -- ver evidência acima; nenhuma
--                  infraestrutura real depende disso hoje.
--   PUBLIC:        REVOKE ALL -- defensivo, fecha qualquer privilégio
--                  herdado por qualquer role futura que não seja
--                  explicitamente listada.
-- ============================================================

BEGIN;

-- ── 1. personal_tasks ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  -- Fase 1A.2 (item 6) — 'postponed' REMOVIDO de personal_tasks (existia
  -- no draft 1A.1). Decisão: para uma TAREFA, "adiar" na prática sempre
  -- significa reagendar (mudar due_at) e continuar pending -- um status
  -- 'postponed' separado só criava um terceiro estado sem comportamento
  -- próprio bem definido (a Home/filtros/revisão teriam que tratar
  -- 'postponed' como quase-pending mesmo assim). Simplifica para
  -- pending|done. Diferente de personal_routine_entries, onde
  -- 'postponed' TEM significado real e distinto: é o histórico de UM
  -- dia específico daquela rotina (ver 94-personal-core-routines.sql).
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'done')),
  priority            TEXT
                      CHECK (priority IS NULL OR priority IN ('high', 'medium', 'low')),
  due_at              TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  -- Referência contextual restrita ao mínimo real hoje: só client_project
  -- (via client_projects.id). Lista cresce só quando um novo domínio
  -- (Project Workspace, Content Lab) existir de verdade. Sem FK física:
  -- a entidade referenciada pode ser removida sem cascatear aqui -- vira
  -- referência solta, a UI trata "não encontrada" graciosamente.
  related_entity_type TEXT
                      CHECK (related_entity_type IS NULL OR related_entity_type IN ('client_project')),
  related_entity_id   UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_tasks_user_id ON public.personal_tasks (user_id);
-- Serve: listagem geral por status (ex. "tarefas concluídas" na Revisão).
CREATE INDEX IF NOT EXISTS idx_personal_tasks_user_status ON public.personal_tasks (user_id, status);
-- Serve: a regra das "3 prioridades" (ver comentário completo no fim do
-- arquivo) -- tarefas pendentes de um usuário, por prazo. Parcial (só
-- pending) porque é exatamente o subconjunto consultado pela Home todo dia.
CREATE INDEX IF NOT EXISTS idx_personal_tasks_user_pending_due
  ON public.personal_tasks (user_id, due_at)
  WHERE status = 'pending';

-- Privilégios de tabela explícitos (Fase 1A.3) — ver evidência/decisão
-- no cabeçalho do arquivo. Revoga tudo de todo mundo primeiro (nunca
-- depende do que os default privileges do projeto tenham concedido),
-- depois concede só o necessário a authenticated.
REVOKE ALL ON TABLE public.personal_tasks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_tasks TO authenticated;

ALTER TABLE public.personal_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_tasks_owner_all" ON public.personal_tasks;
-- Fase 1A.2 (item 3) — auth.uid() envolto em (select ...): permite ao
-- Postgres avaliar a função UMA VEZ por query (InitPlan) em vez de uma
-- vez por linha -- otimização recomendada atualmente pela Supabase
-- (Performance Advisor sinaliza auth.uid() "nu" em RLS). Semântica
-- idêntica à forma direta: cada usuário só acessa a própria linha.
-- Nenhuma policy existente no repositório usa esta forma ainda (auditado
-- em todo docs/supabase/) -- é uma melhoria estritamente compatível,
-- não um padrão divergente do que já existe.
CREATE POLICY "personal_tasks_owner_all" ON public.personal_tasks
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

COMMENT ON TABLE public.personal_tasks IS
  'Tarefas pessoais do operador -- scope PERSONAL, nunca Company-scoped. '
  'RLS restringe acesso authenticated ao próprio dono; NÃO protege contra '
  'service role (BYPASSRLS) -- ver regra de aplicação no cabeçalho deste '
  'arquivo: APIs Personal nunca usam service role nestas tabelas.';

COMMENT ON COLUMN public.personal_tasks.status IS
  'pending = a fazer; done = concluída. Adiar = PATCH due_at mantendo '
  'pending (nunca um status "postponed" separado nesta tabela).';

CREATE TRIGGER trg_personal_tasks_updated_at BEFORE UPDATE ON public.personal_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- REGRA DAS "3 PRIORIDADES DO DIA" (Fase 1A.2, item 5 — final)
-- ─────────────────────────────────────────────────────────────
-- A Home NUNCA deve escolher uma tarefa de daqui a 20 dias só porque
-- tem due_at, na frente de algo urgente de hoje sem prioridade alta.
-- Camadas em ordem estrita: (0) atrasada, (1) vence hoje, (2) resto
-- (futura ou sem data) -- dentro de cada camada, prioridade > sort_order
-- > prazo > data de criação (desempate estável, nunca aleatório).
--
--   SELECT * FROM personal_tasks
--   WHERE user_id = :me AND status = 'pending'
--   ORDER BY
--     CASE
--       WHEN due_at IS NOT NULL AND due_at < :start_of_today    THEN 0  -- atrasada
--       WHEN due_at IS NOT NULL AND due_at < :start_of_tomorrow THEN 1  -- vence hoje
--       ELSE 2                                                          -- futura/sem data
--     END ASC,
--     CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC,
--     sort_order ASC,
--     due_at ASC NULLS LAST,
--     created_at ASC
--   LIMIT 3;
--
-- :start_of_today / :start_of_tomorrow são calculados pela APLICAÇÃO via
-- getFortalezaToday() (nunca CURRENT_DATE do Postgres, que pode divergir
-- do fuso fixo do produto) e passados como parâmetros bind, nunca
-- literal SQL. Nenhuma tabela `daily_priorities` -- é só uma query sobre
-- personal_tasks.

COMMIT;
