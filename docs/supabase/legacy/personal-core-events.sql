-- ============================================================
-- LOKAT OS — LEGACY BASELINE · PERSONAL CORE · personal_events
-- APLICADA EM PRODUÇÃO EM 13/08/2026 — NÃO REEXECUTAR
--
-- Prova: ledger supabase_migrations.schema_migrations do projeto
-- lokat-os, versão 20260813200949 (personal_core_events), conferido ao vivo em
-- 29/09/2026 (Meu PP V2 — Fase 0). O corpo executável abaixo é
-- IDÊNTICO ao SQL registrado no ledger (comparação normalizada, sem
-- comentários e espaços: md5 717d4c4f80369ac7e95ab7706a193cec). Schema vivo conferido objeto a
-- objeto (colunas, defaults, constraints, índices, triggers, policies,
-- GRANTs): sem drift. As tabelas estavam vazias na conferência.
--
-- Origem: branch origin/feat/personal-strategy-os, commit 85f3353,
-- arquivo histórico docs/supabase/96-personal-core-events.sql. A numeração 93–96
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
-- personal_events
--
--
-- Este arquivo não depende de 93/94/95 terem rodado antes -- pré-check
-- próprio de public.set_updated_at() (baseline do projeto, docs 18/33;
-- nunca redefinida pelo Personal Core).
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
-- POR QUE ESTA TABELA É SEGURA (nunca duplica o Calendário Global)
-- ─────────────────────────────────────────────────────────────
-- Auditoria confirmou (lendo src/lib/global-calendar.ts linha 1-8):
-- "Global Calendar — read-only aggregation model... This module has no
-- Supabase calls — it only transforms already-fetched rows." O Global
-- Calendar é um AGREGADOR/NORMALIZADOR, NUNCA uma tabela canônica
-- própria de eventos. `personal_events` é mais uma fonte real, nunca um
-- segundo calendário.
--
-- ─────────────────────────────────────────────────────────────
-- ALL-DAY EVENT — semântica
-- ─────────────────────────────────────────────────────────────
-- starts_at/ends_at continuam TIMESTAMPTZ mesmo para all_day=true --
-- garantir que o evento não "pule de dia" por conversão UTC é
-- responsabilidade da APLICAÇÃO (uma CHECK não consegue validar "qual
-- offset foi usado na escrita", TIMESTAMPTZ normaliza pra UTC e perde
-- essa informação): ao gravar all_day=true, a aplicação DEVE construir
-- starts_at usando a MESMA função que global-calendar.ts::
-- dateOnlyToStartAt() já usa -- `${dateKey}T00:00:00${FORTALEZA_OFFSET}`
-- (meia-noite no fuso fixo America/Fortaleza, -03:00), NUNCA
-- `new Date(dateKey)` (meia-noite UTC).
--
-- ENDS_AT NULLABLE — confirmado, sem mudança: compromisso sem duração
-- conhecida ainda é um caso real; CHECK já aceita NULL.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.personal_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ,
  all_day             BOOLEAN NOT NULL DEFAULT false,
  type                TEXT NOT NULL DEFAULT 'outro'
                      CHECK (type IN ('compromisso', 'estudo', 'gravacao', 'reuniao', 'outro')),
  status              TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  location            TEXT,
  -- Mesma restrição de personal_tasks: só o domínio real hoje
  -- (client_project). Sem FK física -- referência contextual, nunca
  -- cascata, UI trata ausência graciosamente.
  related_entity_type TEXT
                      CHECK (related_entity_type IS NULL OR related_entity_type IN ('client_project')),
  related_entity_id   UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

-- Serve: "eventos de hoje"/"esta semana" na Home -- a única consulta
-- real desta tabela na Fase 1.
CREATE INDEX IF NOT EXISTS idx_personal_events_user_starts
  ON public.personal_events (user_id, starts_at);

-- Privilégios explícitos (Fase 1A.3) — ver evidência/decisão completa
-- no cabeçalho do SQL 93.
REVOKE ALL ON TABLE public.personal_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_events TO authenticated;

ALTER TABLE public.personal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_events_owner_all" ON public.personal_events;
CREATE POLICY "personal_events_owner_all" ON public.personal_events
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

COMMENT ON TABLE public.personal_events IS
  'Agenda pessoal do operador -- uma fonte a mais para o padrão de '
  'agregação do Calendário Global (nunca client_id, nunca um segundo '
  'calendário). RLS restringe a authenticated + dono; NÃO protege '
  'contra service role (ver cabeçalho do SQL 93).';

COMMENT ON COLUMN public.personal_events.all_day IS
  'Quando true, starts_at DEVE ser gravado como meia-noite no fuso fixo '
  'America/Fortaleza (mesmo padrão de dateOnlyToStartAt() em '
  'global-calendar.ts), nunca meia-noite UTC -- ver cabeçalho do arquivo.';

CREATE TRIGGER trg_personal_events_updated_at BEFORE UPDATE ON public.personal_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
