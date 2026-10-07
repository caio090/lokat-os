-- ============================================================
-- SEED (companion) — Onboarding real da TAYANNARA (FASE 1C, seção 9)
-- STATUS: NÃO APLICADO. NÃO EXECUTAR AUTOMATICAMENTE.
--
-- Complementa docs/seeds/tayannara-carvalho-NOT-APPLIED.sql (o cliente
-- em si, já escrito na Fatia 1). Este arquivo só existe pra registrar
-- o PROCESSO de onboarding dela -- nunca duplica o cliente/projeto/
-- decisão já seedados lá.
--
-- Estado esperado pela seção 9 do brief: Jornada=CLIENTE_GANHO/
-- ONBOARDING, primeiro marco=reunião de alinhamento (ainda NÃO
-- realizada -- por isso esta seed NUNCA cria a reunião em si, só o
-- processo de onboarding que vai recebê-la quando for marcada pela UI
-- em /admin/empresa). client-journey/adapters.ts já resolve a jornada
-- como ONBOARDING sozinho a partir de um client_onboardings.status
-- ativo -- nenhuma mudança em clients.status é necessária aqui.
--
-- Pré-requisitos ANTES de rodar este seed:
--   1. docs/seeds/tayannara-carvalho-NOT-APPLIED.sql já aplicado (este
--      seed localiza o client_id dela por company_name -- não recria).
--   2. docs/supabase/101-client-onboarding-and-project-journey.sql já
--      aplicado em Production (client_onboardings/items + catálogo de
--      templates, incluindo o seed do catálogo MARKETING no próprio
--      arquivo da migration).
--   3. Confirmar que ela ainda não tem nenhum client_onboardings antes
--      de rodar (este seed falha com EXCEPTION se já existir, nunca
--      duplica).
--
-- Execução: colar inteiro no SQL Editor do Supabase e rodar de uma vez.
-- ============================================================

DO $$
DECLARE
  v_client_id       UUID;
  v_owner_id        UUID;
  v_onboarding_id   UUID;
BEGIN
  SELECT id, owner_id INTO v_client_id, v_owner_id
  FROM public.clients WHERE company_name = 'TAYANNARA' LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Cliente TAYANNARA não encontrado -- rode docs/seeds/tayannara-carvalho-NOT-APPLIED.sql primeiro.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.client_onboardings WHERE client_id = v_client_id) THEN
    RAISE EXCEPTION 'Já existe um client_onboardings para TAYANNARA -- este seed nunca duplica. Nada foi alterado.';
  END IF;

  -- ── 1. Onboarding -- template MARKETING (posicionamento/conteúdo, o
  --    mais próximo do escopo real contratado: Outlet). created_from=
  --    'manual' -- honesto: não existe um commercial_leads real pra ela
  --    hoje (cliente pré-existente sendo retroalimentado no sistema novo). ──
  INSERT INTO public.client_onboardings (client_id, status, template_codes, started_at, owner_id, created_from)
  VALUES (v_client_id, 'IN_PROGRESS', ARRAY['MARKETING'], now(), v_owner_id, 'manual')
  RETURNING id INTO v_onboarding_id;

  RAISE NOTICE 'Onboarding da TAYANNARA criado: onboarding_id=%', v_onboarding_id;

  -- ── 2. Itens -- copiados do template MARKETING, com status real (nunca
  --    inventado): só o que já sabemos de fato ser verdade hoje avança,
  --    o resto fica PENDING. ──
  INSERT INTO public.client_onboarding_items (onboarding_id, item_key, category, label, responsible_side, status, visibility, is_required_for_kickoff)
  SELECT
    v_onboarding_id, ti.item_key, ti.category, ti.label, ti.responsible_side,
    CASE ti.item_key
      WHEN 'contrato_confirmado'  THEN 'COMPLETED'  -- já é cliente ativo com projeto contratado (Outlet) -- ver seed da Fatia 1.
      WHEN 'responsavel_lokat'    THEN 'COMPLETED'  -- owner_id já definido no cadastro.
      WHEN 'escopo_confirmado'    THEN 'APPROVED'   -- regra de escopo já registrada em company_decisions (ver seed da Fatia 1).
      ELSE 'PENDING'                                 -- nunca inventado: reunião de alinhamento, dados cadastrais completos, materiais, acessos etc. ainda não confirmados.
    END,
    ti.default_visibility, ti.is_required_for_kickoff
  FROM public.client_onboarding_template_items ti
  WHERE ti.template_code = 'MARKETING';

  RAISE NOTICE 'Itens de onboarding da TAYANNARA semeados a partir do template MARKETING. Próximo marco real: reunião de alinhamento (ainda não realizada -- marcar pela UI em /admin/empresa quando acontecer).';
END $$;
