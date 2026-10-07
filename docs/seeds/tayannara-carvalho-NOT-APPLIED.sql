-- ============================================================
-- SEED — Tayannara Carvalho / TAYANNARA
-- STATUS: NÃO APLICADO. NÃO EXECUTAR AUTOMATICAMENTE.
--
-- Dados reais recuperados do Trello conectado pelo usuário (quadro
-- "tayannara-planejamento-2026-2027"), transcritos aqui sem invenção.
-- Nenhum dado fictício -- os únicos valores marcados "SUBSTITUIR" são
-- IDs técnicos (owner_id/created_by) que exigem uma conta real já
-- existente, que este agente não tem autoridade para criar sozinho.
--
-- Pré-requisitos ANTES de rodar este seed:
--   1. docs/supabase/99-company-decisions-and-relationship-links.sql
--      precisa estar aplicado em Production (company_decisions e
--      roadmap_items.planning_stage/horizon dependem dele).
--   2. Confirmar de novo que não existe nenhum registro de Tayannara
--      em clients/commercial_leads antes de rodar (auditoria confirmou
--      isso em 2026-10-07 -- reconfirmar se muito tempo tiver passado).
--   3. Substituir v_owner_id abaixo por um profiles.id REAL (a conta
--      LOKAT responsável por esta Company -- não a própria Tayannara).
--
-- Execução: colar inteiro no SQL Editor do Supabase (projeto lokat-os,
-- ziursnveqpvqkqmaacpl) e rodar de uma vez -- um único DO block em
-- PL/pgSQL (compatível com o SQL Editor; \gset do psql NÃO funciona
-- lá, por isso este formato, mesmo usado no test plan de SQL 99).
-- ============================================================

DO $$
DECLARE
  v_owner_id UUID := '00000000-0000-0000-0000-000000000000'; -- SUBSTITUIR: profiles.id real do responsável LOKAT
  v_client_id UUID;
BEGIN
  IF v_owner_id = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Substitua v_owner_id por um profiles.id real antes de rodar este seed.';
  END IF;

  -- ── 1. Cliente/marca central ────────────────────────────────
  INSERT INTO public.clients (
    id, owner_id, company_name, responsible_name, email, phone, instagram,
    segment, city, plan, status, account_type, platform_status, created_by
  ) VALUES (
    gen_random_uuid(), v_owner_id, 'TAYANNARA', 'Tayannara Carvalho',
    '', '', '', -- email/phone/instagram: preencher quando disponível -- nunca inventado
    'Educação/eventos para mulheres empreendedoras', '', NULL,
    'ativo', -- já fechado/em operação, não onboarding -- confirmar com o time antes de aplicar
    'lokat_client', 'active', v_owner_id
  ) RETURNING id INTO v_client_id;

  RAISE NOTICE 'Cliente TAYANNARA criado: client_id=%', v_client_id;

  -- ── 2. Escopo contratado hoje: Outlet Mulheres Empreendedoras ──
  INSERT INTO public.client_projects (client_id, title, description, status, visible_to_client, scope_category)
  VALUES (
    v_client_id, 'Outlet Mulheres Empreendedoras',
    'Posicionamento e imagem da Tayannara dentro do projeto contratado. Inclui: conteúdos e peças previstos para o Outlet, apresentação/material do evento, playbook do Outlet.',
    'active', true, 'contratado'
  );

  -- ── 3. Decisão de escopo (regra explícita dada pelo usuário) ───
  INSERT INTO public.company_decisions (client_id, title, decision, context, origin, client_validation, belongs_to_scope)
  VALUES (
    v_client_id, 'Regra de escopo do contrato atual',
    'Uma frente pode fazer parte do planejamento estratégico da Tayannara sem estar autorizada para execução. Tudo que exigir execução, equipe, mídia ou produção fora do contrato (Outlet Mulheres Empreendedoras) deve ser classificado como fora do escopo, oportunidade ou orçamento pendente -- nunca executado automaticamente.',
    'Ecossistema da Tayannara inclui CONAD, Elas Conectam, Outlet Mulheres Empreendedoras, Podcast Gente & Negócios e produtos digitais/presenciais -- só o Outlet está contratado hoje.',
    'strategy', 'internal', true
  );

  -- ── 4. Planejamento sem execução automática (Próxima Janela -- next_window) ──
  INSERT INTO public.roadmap_items (client_id, source_type, title, description, priority, status, planning_stage, horizon) VALUES
    (v_client_id, 'manual', 'Elas Conectam', 'Jantar/encontro de mulheres empreendedoras -- planejamento estratégico, sem execução autorizada ainda.', 'medium', 'planned', 'pre_planning', 'next_window'),
    (v_client_id, 'manual', 'CONAD', 'Frente do ecossistema Tayannara -- sem autorização de execução no contrato atual.', 'medium', 'planned', 'idea', 'next_window'),
    (v_client_id, 'manual', 'Podcast Gente & Negócios (recorrente)', 'Podcast recorrente -- definição do anúncio e itens aprovados ainda em planejamento.', 'medium', 'planned', 'pre_planning', 'next_window'),
    (v_client_id, 'manual', 'Evento Metas 2027', 'Evento futuro -- ainda em planejamento, sem escopo/orçamento definido.', 'medium', 'planned', 'idea', 'next_window'),
    (v_client_id, 'manual', 'Campanhas IRPF/MEI', 'Campanhas sazonais -- hipótese ainda não amadurecida.', 'low', 'planned', 'idea', 'next_window'),
    (v_client_id, 'manual', 'Produtos educacionais 2027', 'Produtos digitais/presenciais futuros -- ainda não há decisão de escopo.', 'low', 'planned', 'idea', 'next_window');

  -- ── 5. Planejamento Outubro (immediate -- próximo período) ─────
  INSERT INTO public.roadmap_items (client_id, source_type, title, description, priority, status, planning_stage, horizon) VALUES
    (v_client_id, 'manual', 'Ações presenciais como combustível de posicionamento', 'Outubro.', 'high', 'planned', 'approved', 'immediate'),
    (v_client_id, 'manual', 'Conteúdo de aquecimento', 'Outubro -- preparar o terreno para o jantar/captação.', 'high', 'planned', 'approved', 'immediate'),
    (v_client_id, 'manual', 'Preparação do jantar e pontos de captação', 'Outubro.', 'high', 'planned', 'approved', 'immediate'),
    (v_client_id, 'manual', 'Definição do anúncio do podcast', 'Outubro.', 'medium', 'planned', 'in_analysis', 'immediate'),
    (v_client_id, 'manual', 'Conexão infoproduto/playbook + Outlet', 'Outubro -- integrar material educacional ao Outlet.', 'medium', 'planned', 'in_analysis', 'immediate'),
    (v_client_id, 'manual', 'Separar ARTE, VÍDEO e TRÁFEGO no calendário', 'Outubro -- organização operacional do mês.', 'medium', 'planned', 'approved', 'immediate');

  -- ── 6. Planejamento Novembro (next_window -- já começando a aparecer) ──
  INSERT INTO public.roadmap_items (client_id, source_type, title, description, priority, status, planning_stage, horizon) VALUES
    (v_client_id, 'manual', 'Jantar Elas Conectam / mulheres empreendedoras', 'Novembro.', 'high', 'planned', 'pre_planning', 'next_window'),
    (v_client_id, 'manual', 'Apresentação do produto', 'Novembro.', 'medium', 'planned', 'pre_planning', 'next_window'),
    (v_client_id, 'manual', 'Anúncio do Podcast Gente & Negócios conforme itens aprovados', 'Novembro.', 'medium', 'planned', 'awaiting_decision', 'next_window'),
    (v_client_id, 'manual', 'Cobertura, captação e reaproveitamento', 'Novembro.', 'medium', 'planned', 'pre_planning', 'next_window'),
    (v_client_id, 'manual', 'Conteúdo pós-evento e prova social', 'Novembro.', 'medium', 'planned', 'pre_planning', 'next_window'),
    (v_client_id, 'manual', 'Separar contrato do Outlet de itens que exigem orçamento extra', 'Novembro -- disciplina de escopo explícita (ver Decisão de escopo acima).', 'high', 'planned', 'awaiting_decision', 'next_window');

  RAISE NOTICE 'Seed da TAYANNARA aplicado com sucesso -- client_id=%', v_client_id;
END $$;
