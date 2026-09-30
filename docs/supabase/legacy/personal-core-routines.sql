-- ============================================================
-- LOKAT OS — LEGACY BASELINE · PERSONAL CORE · personal_routines + personal_routine_entries
-- APLICADA EM PRODUÇÃO EM 13/08/2026 — NÃO REEXECUTAR
--
-- Prova: ledger supabase_migrations.schema_migrations do projeto
-- lokat-os, versão 20260813200750 (personal_core_routines), conferido ao vivo em
-- 29/09/2026 (Meu PP V2 — Fase 0). O corpo executável abaixo é
-- IDÊNTICO ao SQL registrado no ledger (comparação normalizada, sem
-- comentários e espaços: md5 f4222749e61c46f3e8b6795729805e5b). Schema vivo conferido objeto a
-- objeto (colunas, defaults, constraints, índices, triggers, policies,
-- GRANTs): sem drift. As tabelas estavam vazias na conferência.
--
-- Origem: branch origin/feat/personal-strategy-os, commit 85f3353,
-- arquivo histórico docs/supabase/94-personal-core-routines.sql. A numeração 93–96
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
-- personal_routines + personal_routine_entries
--
--
-- Este arquivo NÃO depende de 93 ter rodado antes -- faz seu próprio
-- pré-check independente de public.set_updated_at() (já existente na
-- baseline do projeto, docs/supabase/18 e /33; nunca redefinida pelo
-- Personal Core). Ver 93-personal-core-tasks.sql para a explicação
-- completa da regra de service role/RLS/GRANTs (evidência técnica
-- BYPASSRLS-vs-GRANT incluída), idêntica para este domínio -- aplicada
-- às duas tabelas abaixo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    RAISE EXCEPTION 'public.set_updated_at() não existe. Aplique docs/supabase/18 e/ou /33 (ou a baseline equivalente do ambiente) antes deste SQL.';
  END IF;
END $$;
--
-- ─────────────────────────────────────────────────────────────
-- MODELO DE RECORRÊNCIA — mínimo representável, nunca RRULE completo
-- ─────────────────────────────────────────────────────────────
-- daily:         days_of_week NULL, day_of_month NULL.
-- specific_days: days_of_week com 1+ elementos, day_of_month NULL.
-- weekly:        days_of_week com EXATAMENTE 1 elemento (reaproveita a
--                mesma coluna de specific_days, sem coluna nova).
-- monthly:       day_of_month obrigatório (1..31), days_of_week NULL.
--
-- Decisão pendente registrada, NÃO resolvida neste SQL gate (Fase 1A.3,
-- item 9): quando day_of_month=29/30/31 e o mês corrente não tiver esse
-- dia (ex. fevereiro), a Fase 1 não deve inventar comportamento
-- silencioso. A futura API precisa escolher explicitamente entre "não
-- ocorre naquele mês" OU "cai no último dia disponível do mês" -- sem
-- mudança de schema necessária para nenhuma das duas opções, é lógica
-- de leitura/cálculo de ocorrência, não uma constraint aqui.
--
-- Convenção de days_of_week, documentada em SQL (não só na app): 0=domingo,
-- 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado (convenção
-- Date.getDay() do JS). Validado por CHECK: cada valor precisa estar em
-- 0..6 (duplicado não é validado no banco -- CHECK não aceita subquery/
-- unnest correlacionado; duplicado é inofensivo, ver comentário na coluna).
-- ============================================================

BEGIN;

-- ── 1. personal_routines (a definição) ────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_routines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  frequency_type  TEXT NOT NULL
                  CHECK (frequency_type IN ('daily', 'specific_days', 'weekly', 'monthly')),
  -- Validação de duplicados NÃO entra como CHECK: constraints do
  -- Postgres não podem conter subquery, e um duplicado aqui é inofensivo
  -- por natureza (ARRAY[1,1,3] se comporta como ARRAY[1,3] pra qualquer
  -- consumidor que trate isto como conjunto de dias) -- a API deve
  -- deduplicar antes de gravar por limpeza, não por integridade.
  days_of_week    INTEGER[]
                  CHECK (days_of_week IS NULL OR days_of_week <@ ARRAY[0,1,2,3,4,5,6]),  -- só valores 0..6, nunca -1/7/99
  day_of_month    SMALLINT
                  CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  preferred_time  TIME,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Só o campo certo é preenchido por tipo de frequência -- nunca daily
  -- com dias marcados, nunca monthly sem dia do mês.
  CONSTRAINT chk_personal_routines_frequency_shape CHECK (
    (frequency_type = 'daily'         AND days_of_week IS NULL     AND day_of_month IS NULL)
    OR (frequency_type = 'specific_days' AND days_of_week IS NOT NULL AND array_length(days_of_week, 1) >= 1 AND day_of_month IS NULL)
    OR (frequency_type = 'weekly'        AND days_of_week IS NOT NULL AND array_length(days_of_week, 1) = 1  AND day_of_month IS NULL)
    OR (frequency_type = 'monthly'       AND days_of_week IS NULL     AND day_of_month IS NOT NULL)
  ),
  -- Necessária para a FK composta de personal_routine_entries abaixo --
  -- garante NO BANCO que uma entry nunca pode ter user_id diferente do
  -- dono real da rotina.
  CONSTRAINT uq_personal_routines_id_user UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_personal_routines_user_active
  ON public.personal_routines (user_id) WHERE active = true;

-- Privilégios explícitos (Fase 1A.3) — ver evidência/decisão completa
-- no cabeçalho do SQL 93.
REVOKE ALL ON TABLE public.personal_routines FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_routines TO authenticated;

ALTER TABLE public.personal_routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_routines_owner_all" ON public.personal_routines;
CREATE POLICY "personal_routines_owner_all" ON public.personal_routines
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

COMMENT ON TABLE public.personal_routines IS
  'Rotinas pessoais -- RLS restringe acesso authenticated ao próprio '
  'dono; NÃO protege contra service role (ver cabeçalho do SQL 93).';

COMMENT ON COLUMN public.personal_routines.days_of_week IS
  '0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado '
  '(convenção Date.getDay() do JS). Documentado em SQL, não só na app.';

CREATE TRIGGER trg_personal_routines_updated_at BEFORE UPDATE ON public.personal_routines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. personal_routine_entries (o histórico, 1 linha por dia) ─
--
-- 'pending' NUNCA é persistido: a tabela só registra EXCEÇÃO/AÇÃO real
-- (done/postponed). Ausência de linha para uma (routine_id, entry_date)
-- = pending implícito. "Desfazer" uma marcação = a API deleta a linha
-- (volta a implícito), nunca escreve status='pending'. Aqui, diferente
-- de personal_tasks, 'postponed' TEM significado real e distinto: é o
-- histórico de UM dia específico daquela rotina (nunca afeta outros dias).
CREATE TABLE IF NOT EXISTS public.personal_routine_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id    UUID NOT NULL,
  -- Denormalizado de propósito (regra do repositório: toda linha
  -- precisa de ownership direto) -- consistência com o dono real da
  -- rotina é GARANTIDA NO BANCO pela FK composta abaixo, nunca só pela API.
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date    DATE NOT NULL,
  status        TEXT NOT NULL
                CHECK (status IN ('done', 'postponed')),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (routine_id, entry_date),
  -- Impossível no banco ter routine_id de um usuário com user_id de
  -- outro: a FK só aceita o PAR (routine_id, user_id) que exista em
  -- personal_routines(id, user_id).
  CONSTRAINT fk_personal_routine_entries_owner
    FOREIGN KEY (routine_id, user_id)
    REFERENCES public.personal_routines (id, user_id)
    ON DELETE CASCADE,
  -- Fase 1A.2 (item 7) — completed_at só pode estar preenchido quando
  -- status='done'; para 'postponed' é sempre NULL (adiar não é concluir).
  CONSTRAINT chk_personal_routine_entries_completed_at
    CHECK (completed_at IS NULL OR status = 'done')
);

CREATE INDEX IF NOT EXISTS idx_personal_routine_entries_user_date
  ON public.personal_routine_entries (user_id, entry_date);

-- Privilégios explícitos (Fase 1A.3) — ver evidência/decisão completa
-- no cabeçalho do SQL 93.
REVOKE ALL ON TABLE public.personal_routine_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_routine_entries TO authenticated;

ALTER TABLE public.personal_routine_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_routine_entries_owner_all" ON public.personal_routine_entries;
CREATE POLICY "personal_routine_entries_owner_all" ON public.personal_routine_entries
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- routine_id/user_id imutáveis por higiene de dado (uma entrada de
-- histórico não deveria "pular" de rotina) -- a garantia de SEGURANÇA
-- (nunca outro dono) já vem da FK composta acima, independente deste
-- trigger; este trigger é só sobre integridade de histórico, não RLS.
CREATE OR REPLACE FUNCTION public.forbid_routine_entry_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.routine_id IS DISTINCT FROM OLD.routine_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'routine_id/user_id são imutáveis em personal_routine_entries';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_personal_routine_entries_immutable
  BEFORE UPDATE ON public.personal_routine_entries
  FOR EACH ROW EXECUTE FUNCTION public.forbid_routine_entry_reassignment();

COMMIT;
