-- ============================================================
-- LOKAT OS — SQL 98 · MEU PP V2 · FASE 1 (cérebro pessoal)
--   personal_tasks.focus_date          (prioridades do dia, sem tabela nova)
--   personal_quick_captures            (captura confirmada; notas = inbox)
--   personal_reflections               (reflexo do dia)
--   personal_decisions                 (Decision Ledger, versionado)
--   personal_confirm_capture(...)      (captura → objeto + link, atômico)
--   personal_supersede_decision(...)   (nova decisão substitui a anterior, atômico)
--
-- Escopo: PERSONAL ONLY — mesmo padrão da baseline Personal Core e do SQL 97:
--   1. RLS do dono (user_id = auth.uid()) em USING e WITH CHECK;
--   2. GRANT só para `authenticated`; PUBLIC/anon/service_role REVOGADOS
--      (tabelas E funções) — service role (BYPASSRLS) é barrado no GRANT;
--   3. funções SECURITY INVOKER: rodam com as permissões e o RLS de quem
--      chama; nunca SECURITY DEFINER, nunca bypass.
--   4. aplicação: rotas /api/admin/meu-pp/* usam só a sessão do usuário.
--
-- Decisões de modelo (docs/meu-pp/README.md, Fase 1):
--   - Prioridade = tarefa existente destacada para um dia (focus_date).
--     Não duplica conteúdo; limite de 3 por dia validado na aplicação.
--   - Captura só é gravada na CONFIRMAÇÃO (analisar/sugerir/preview são
--     do lado do cliente). Descartar antes de confirmar = nada é gravado.
--     "Ideia/Nota" fica como captura status 'inbox' até ser convertida ou
--     descartada ('dismissed', mantida — sem auto delete).
--   - Uma reflexão 'daily' por dia (índice único parcial); o tipo fica
--     aberto para reflexões contextuais futuras.
--   - Decisão é histórica: conteúdo só pode ser corrigido nas primeiras
--     24h (erro de digitação); depois disso, mudar de posição = NOVA
--     decisão com supersedes_decision_id (trigger abaixo). Cadeia linear:
--     uma decisão é substituída no máximo uma vez.
--   - Relações entre objetos: personal_entity_links (SQL 97), nunca FKs
--     espalhadas. Única FK nova entre objetos: supersedes_decision_id
--     (auto-relação da própria tabela, mesmo dono via FK composta).
--
-- Numeração: 98 = próximo slot livre real da main.
-- Rollback: docs/supabase/98-personal-brain-phase1-rollback.sql
-- Test plan: docs/supabase/98-personal-brain-phase1-test-plan.sql
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    RAISE EXCEPTION 'public.set_updated_at() não existe. Aplique a baseline (docs/supabase/18 ou /33) antes deste SQL.';
  END IF;
  IF to_regclass('public.personal_tasks') IS NULL OR to_regclass('public.personal_entity_links') IS NULL THEN
    RAISE EXCEPTION 'Personal Core (legacy baseline) e SQL 97 precisam existir antes do SQL 98.';
  END IF;
END $$;

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. personal_tasks.focus_date — "prioridade do dia"
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.personal_tasks ADD COLUMN IF NOT EXISTS focus_date DATE;

COMMENT ON COLUMN public.personal_tasks.focus_date IS
  'Meu PP Fase 1 -- dia (America/Fortaleza) em que a tarefa é uma das 3 '
  'prioridades. NULL = não é prioridade. Limite de 3 por dia validado na '
  'aplicação; ordem = sort_order.';

CREATE INDEX IF NOT EXISTS idx_personal_tasks_user_focus
  ON public.personal_tasks (user_id, focus_date)
  WHERE focus_date IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. personal_quick_captures
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_quick_captures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_text        TEXT NOT NULL CHECK (char_length(btrim(raw_text)) BETWEEN 1 AND 4000),
  source          TEXT NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice')),
  suggested_type  TEXT CHECK (suggested_type IS NULL OR suggested_type IN ('task', 'reflection', 'decision', 'event', 'note')),
  confirmed_type  TEXT CHECK (confirmed_type IS NULL OR confirmed_type IN ('task', 'reflection', 'decision', 'event', 'note')),
  status          TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'confirmed', 'dismissed')),
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_personal_quick_captures_state CHECK (
    (status = 'inbox'     AND confirmed_type = 'note' AND processed_at IS NULL)
    OR (status = 'confirmed' AND confirmed_type IN ('task', 'reflection', 'decision', 'event') AND processed_at IS NOT NULL)
    OR (status = 'dismissed' AND processed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_personal_quick_captures_user_status
  ON public.personal_quick_captures (user_id, status, created_at DESC);

REVOKE ALL ON TABLE public.personal_quick_captures FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_quick_captures TO authenticated;
ALTER TABLE public.personal_quick_captures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "personal_quick_captures_owner_all" ON public.personal_quick_captures;
CREATE POLICY "personal_quick_captures_owner_all" ON public.personal_quick_captures
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

COMMENT ON TABLE public.personal_quick_captures IS
  'Meu PP -- capturas CONFIRMADAS pelo dono (nunca classificação automática '
  'gravada sozinha). inbox = nota/ideia aguardando; confirmed = virou objeto '
  '(link derived_from em personal_entity_links); dismissed = descartada e mantida. '
  'PERSONAL ONLY: RLS do dono + GRANT só authenticated.';

CREATE TRIGGER trg_personal_quick_captures_updated_at BEFORE UPDATE ON public.personal_quick_captures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. personal_reflections
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_reflections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reflection_date  DATE NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily')),
  text             TEXT CHECK (text IS NULL OR char_length(text) <= 8000),
  what_changed     TEXT CHECK (what_changed IS NULL OR char_length(what_changed) <= 4000),
  learning         TEXT CHECK (learning IS NULL OR char_length(learning) <= 4000),
  open_loops       TEXT CHECK (open_loops IS NULL OR char_length(open_loops) <= 4000),
  next_action      TEXT CHECK (next_action IS NULL OR char_length(next_action) <= 4000),
  changed_mind     TEXT CHECK (changed_mind IS NULL OR char_length(changed_mind) <= 4000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_reflections_daily
  ON public.personal_reflections (user_id, reflection_date)
  WHERE kind = 'daily';
CREATE INDEX IF NOT EXISTS idx_personal_reflections_user_date
  ON public.personal_reflections (user_id, reflection_date DESC);

REVOKE ALL ON TABLE public.personal_reflections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_reflections TO authenticated;
ALTER TABLE public.personal_reflections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "personal_reflections_owner_all" ON public.personal_reflections;
CREATE POLICY "personal_reflections_owner_all" ON public.personal_reflections
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

COMMENT ON TABLE public.personal_reflections IS
  'Meu PP -- reflexo do dia (memória estratégica, não diário terapêutico: '
  'sem humor/score). reflection_date = dia civil America/Fortaleza. '
  'Gratidão continua em gratitude_entries (não duplicada aqui). '
  'Relações (decisões, tarefas) via personal_entity_links. PERSONAL ONLY.';

CREATE TRIGGER trg_personal_reflections_updated_at BEFORE UPDATE ON public.personal_reflections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. personal_decisions (Decision Ledger)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_decisions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  decision                TEXT NOT NULL CHECK (char_length(btrim(decision)) BETWEEN 1 AND 4000),
  context                 TEXT CHECK (context IS NULL OR char_length(context) <= 4000),
  rationale               TEXT CHECK (rationale IS NULL OR char_length(rationale) <= 4000),
  alternatives            TEXT CHECK (alternatives IS NULL OR char_length(alternatives) <= 4000),
  assumptions             TEXT CHECK (assumptions IS NULL OR char_length(assumptions) <= 4000),
  accepted_risks          TEXT CHECK (accepted_risks IS NULL OR char_length(accepted_risks) <= 4000),
  review_trigger          TEXT CHECK (review_trigger IS NULL OR char_length(review_trigger) <= 2000),
  review_at               DATE,
  decided_on              DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  supersedes_decision_id  UUID,
  last_reviewed_at        TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_personal_decisions_id_user UNIQUE (id, user_id),
  CONSTRAINT chk_personal_decisions_not_self CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id),
  CONSTRAINT fk_personal_decisions_supersedes
    FOREIGN KEY (supersedes_decision_id, user_id)
    REFERENCES public.personal_decisions (id, user_id)
);

-- cadeia linear: cada decisão é substituída no máximo uma vez
CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_decisions_supersedes
  ON public.personal_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_decisions_user_review
  ON public.personal_decisions (user_id, review_at)
  WHERE status = 'active' AND review_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_decisions_user_decided
  ON public.personal_decisions (user_id, decided_on DESC, created_at DESC);

REVOKE ALL ON TABLE public.personal_decisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_decisions TO authenticated;
ALTER TABLE public.personal_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "personal_decisions_owner_all" ON public.personal_decisions;
CREATE POLICY "personal_decisions_owner_all" ON public.personal_decisions
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

COMMENT ON TABLE public.personal_decisions IS
  'Meu PP -- Decision Ledger. Histórico: conteúdo corrigível só nas primeiras '
  '24h; depois, mudar de posição = nova decisão com supersedes_decision_id '
  '(a antiga vira status superseded e permanece). PERSONAL ONLY.';

CREATE OR REPLACE FUNCTION public.forbid_personal_decision_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.supersedes_decision_id IS DISTINCT FROM OLD.supersedes_decision_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'personal_decisions: user_id/supersedes_decision_id/created_at são imutáveis';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status IS DISTINCT FROM 'superseded' THEN
    RAISE EXCEPTION 'personal_decisions: uma decisão substituída não volta a ficar ativa -- registre uma nova decisão';
  END IF;
  IF OLD.created_at < now() - interval '24 hours' AND (
       NEW.title IS DISTINCT FROM OLD.title
    OR NEW.decision IS DISTINCT FROM OLD.decision
    OR NEW.context IS DISTINCT FROM OLD.context
    OR NEW.rationale IS DISTINCT FROM OLD.rationale
    OR NEW.alternatives IS DISTINCT FROM OLD.alternatives
    OR NEW.assumptions IS DISTINCT FROM OLD.assumptions
    OR NEW.accepted_risks IS DISTINCT FROM OLD.accepted_risks
    OR NEW.review_trigger IS DISTINCT FROM OLD.review_trigger
    OR NEW.decided_on IS DISTINCT FROM OLD.decided_on
  ) THEN
    RAISE EXCEPTION 'personal_decisions: conteúdo só pode ser corrigido nas primeiras 24h -- para mudar de posição, registre uma nova decisão que substitui esta';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.forbid_personal_decision_rewrite() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_personal_decisions_history BEFORE UPDATE ON public.personal_decisions
  FOR EACH ROW EXECUTE FUNCTION public.forbid_personal_decision_rewrite();
CREATE TRIGGER trg_personal_decisions_updated_at BEFORE UPDATE ON public.personal_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 5. personal_confirm_capture — captura confirmada → objeto + captura + link
--    (uma transação; SECURITY INVOKER = RLS e GRANTs de quem chama)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.personal_confirm_capture(
  p_raw_text        TEXT,
  p_source          TEXT,
  p_suggested_type  TEXT,
  p_confirmed_type  TEXT,
  p_payload         JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_object_id   UUID;
  v_capture_id  UUID;
  v_date        DATE;
  v_title       TEXT := nullif(btrim(coalesce(p_payload->>'title', '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_confirmed_type NOT IN ('task', 'reflection', 'decision', 'event', 'note') THEN
    RAISE EXCEPTION 'invalid_type' USING ERRCODE = '22023';
  END IF;

  IF p_confirmed_type = 'task' THEN
    INSERT INTO public.personal_tasks (user_id, title, description, priority, due_at, focus_date)
    VALUES (
      v_uid,
      coalesce(v_title, btrim(p_raw_text)),
      nullif(btrim(coalesce(p_payload->>'description', '')), ''),
      nullif(p_payload->>'priority', ''),
      nullif(p_payload->>'due_at', '')::timestamptz,
      nullif(p_payload->>'focus_date', '')::date
    )
    RETURNING id INTO v_object_id;

  ELSIF p_confirmed_type = 'decision' THEN
    INSERT INTO public.personal_decisions (user_id, title, decision, rationale, review_trigger, review_at, decided_on)
    VALUES (
      v_uid,
      coalesce(v_title, left(btrim(p_raw_text), 200)),
      coalesce(nullif(btrim(coalesce(p_payload->>'decision', '')), ''), btrim(p_raw_text)),
      nullif(btrim(coalesce(p_payload->>'rationale', '')), ''),
      nullif(btrim(coalesce(p_payload->>'review_trigger', '')), ''),
      nullif(p_payload->>'review_at', '')::date,
      (p_payload->>'date')::date
    )
    RETURNING id INTO v_object_id;

  ELSIF p_confirmed_type = 'reflection' THEN
    v_date := (p_payload->>'date')::date;
    -- um reflexo diário por dia: a captura acrescenta ao texto do dia
    INSERT INTO public.personal_reflections (user_id, reflection_date, kind, text)
    VALUES (v_uid, v_date, 'daily', btrim(p_raw_text))
    ON CONFLICT (user_id, reflection_date) WHERE kind = 'daily'
    DO UPDATE SET text = CASE
      WHEN public.personal_reflections.text IS NULL OR public.personal_reflections.text = '' THEN EXCLUDED.text
      ELSE public.personal_reflections.text || E'\n\n' || EXCLUDED.text
    END
    RETURNING id INTO v_object_id;

  ELSIF p_confirmed_type = 'event' THEN
    INSERT INTO public.personal_events (user_id, title, starts_at, ends_at, all_day, type)
    VALUES (
      v_uid,
      coalesce(v_title, left(btrim(p_raw_text), 200)),
      (p_payload->>'starts_at')::timestamptz,
      nullif(p_payload->>'ends_at', '')::timestamptz,
      coalesce((p_payload->>'all_day')::boolean, false),
      coalesce(nullif(p_payload->>'event_type', ''), 'outro')
    )
    RETURNING id INTO v_object_id;
  END IF;

  INSERT INTO public.personal_quick_captures (user_id, raw_text, source, suggested_type, confirmed_type, status, processed_at)
  VALUES (
    v_uid, btrim(p_raw_text), coalesce(p_source, 'text'), p_suggested_type, p_confirmed_type,
    CASE WHEN p_confirmed_type = 'note' THEN 'inbox' ELSE 'confirmed' END,
    CASE WHEN p_confirmed_type = 'note' THEN NULL ELSE now() END
  )
  RETURNING id INTO v_capture_id;

  IF v_object_id IS NOT NULL THEN
    INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id, relation_type)
    VALUES (v_uid, p_confirmed_type, v_object_id, 'capture', v_capture_id, 'derived_from');
  END IF;

  RETURN jsonb_build_object('capture_id', v_capture_id, 'object_type', p_confirmed_type, 'object_id', v_object_id);
END;
$$;
REVOKE ALL ON FUNCTION public.personal_confirm_capture(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.personal_confirm_capture(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. personal_supersede_decision — "eu pensava → agora penso", atômico
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.personal_supersede_decision(
  p_old_id   UUID,
  p_payload  JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_old     public.personal_decisions%ROWTYPE;
  v_new_id  UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_old FROM public.personal_decisions
   WHERE id = p_old_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decision_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_old.status <> 'active' THEN RAISE EXCEPTION 'decision_already_superseded' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.personal_decisions (
    user_id, title, decision, context, rationale, alternatives, assumptions, accepted_risks,
    review_trigger, review_at, decided_on, supersedes_decision_id
  ) VALUES (
    v_uid,
    coalesce(nullif(btrim(coalesce(p_payload->>'title', '')), ''), v_old.title),
    btrim(p_payload->>'decision'),
    nullif(btrim(coalesce(p_payload->>'context', '')), ''),
    nullif(btrim(coalesce(p_payload->>'rationale', '')), ''),
    nullif(btrim(coalesce(p_payload->>'alternatives', '')), ''),
    nullif(btrim(coalesce(p_payload->>'assumptions', '')), ''),
    nullif(btrim(coalesce(p_payload->>'accepted_risks', '')), ''),
    nullif(btrim(coalesce(p_payload->>'review_trigger', '')), ''),
    nullif(p_payload->>'review_at', '')::date,
    (p_payload->>'date')::date,
    v_old.id
  )
  RETURNING id INTO v_new_id;

  UPDATE public.personal_decisions SET status = 'superseded' WHERE id = v_old.id;

  INSERT INTO public.personal_entity_links (user_id, source_type, source_id, target_type, target_id, relation_type)
  VALUES (v_uid, 'decision', v_new_id, 'decision', v_old.id, 'supersedes');

  RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.personal_supersede_decision(UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.personal_supersede_decision(UUID, JSONB) TO authenticated;

COMMIT;
