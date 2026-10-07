import type { WorkspaceSurface } from "@/lib/workspaces/types";

/**
 * Mapa mestre da plataforma (Sprint LOKAT Core 2.1). Este registry descreve
 * o que EXISTE hoje na branch feat/lokat-core-platform-map-v1 — não o que
 * está planejado em outras branches. `maturity` é o estado real observado
 * (não confundir com `readiness` de src/config/project-status.ts, que é uma
 * dimensão de release/QA formal, não de arquitetura). Nenhum módulo aqui
 * declarado "production" que não sirva Production de fato.
 */

/** As quatro superfícies reais de workspace-capabilities.ts + uma quinta,
 * conceitual, só para visibilidade de módulo: um usuário operacional dentro
 * de agency/direct_business (produção, execução), sem acesso de dono. Não é
 * um WorkspaceSurface novo — não altera autorização real, é só uma
 * granularidade a mais para a matriz de visibilidade desta página. */
export type ModuleSurface = WorkspaceSurface | "operational_user";

export const MODULE_SURFACE_LABELS: Record<ModuleSurface, string> = {
  super_admin: "Super Admin",
  agency: "Agência",
  agency_client: "Cliente da agência",
  direct_business: "Empresa direta",
  operational_user: "Usuário operacional",
};

export type PlatformModuleCategory =
  | "core"
  | "management"
  | "commercial"
  | "operations"
  | "communication"
  | "intelligence"
  | "integrations"
  | "platform";

/**
 * Maturidade real observada no código, não uma meta. "production" exige que
 * a rota sirva dados reais em Production hoje — um módulo 100% em memória
 * (fixtures, sem Supabase) nunca é "production", mesmo que a UI esteja
 * completa.
 */
export type PlatformModuleMaturity =
  | "production"
  | "qa_pending"
  | "preview"
  | "planned"
  | "blocked"
  | "experimental"
  // STATUS LIVE ACTIVITY V1 — "planned" já significava "existe intenção real
  // de construir"; estes dois cobrem honestamente conceitos que a missão
  // pediu para nunca desaparecer do roadmap mas que ainda não têm sequer um
  // plano de implementação concreto ("not_implemented") ou são uma promessa
  // pública já comunicada mas sem trabalho iniciado ("coming_soon") — nunca
  // misturados com "planned" para não mentir sobre o estado real.
  | "not_implemented"
  | "coming_soon";

/**
 * REC OS ARCHITECTURE ALIGNMENT V1 — modelo conceitual de evolução de um
 * módulo, usado para ORGANIZAR o roadmap (REC OS é o primeiro caso real
 * aplicado). Não é um campo formal do registry, não altera `maturity` (que
 * continua sendo o único eixo real de "o que existe hoje") -- é só uma
 * lente para descrever, na `notes`/`description` de um módulo, em qual
 * estágio conceitual ele está:
 * - V1 — Operacional: o módulo EXECUTA (ex.: REC OS hoje -- projetos,
 *   produção, calendário, aprovações).
 * - V2 — Inteligência: o módulo ANALISA (ex.: Growth -- simulações,
 *   recomendações, benchmarks, planejamento antes da execução).
 * - V3 — Automação: o módulo EXECUTA SOZINHO (ex.: publicação assistida em
 *   Meta Ads/Google Ads, automações, recomendações via Jarvis).
 * Um módulo `not_implemented`/`planned` já pode ser rotulado com o V
 * correspondente na sua própria nota -- isso não promete prazo, só
 * classifica a NATUREZA do trabalho quando ele existir.
 */
export type ModuleSurfaceAccess =
  | "full_access"
  | "own_data_only"
  | "preview_read_only"
  | "conditional"
  | "not_applicable";

export interface ModuleSurfaceAvailability {
  surface: ModuleSurface;
  access: ModuleSurfaceAccess;
  notes?: string;
}

export interface PlatformModuleDefinition {
  id: string;
  name: string;
  description: string;
  category: PlatformModuleCategory;
  /**
   * Rotas reais confirmadas na auditoria de origem, normalmente sob
   * src/app/admin. REC OS ARCHITECTURE ALIGNMENT V1: um módulo pode viver
   * fora de /admin quando essa é a raiz real do produto (ex.: growth_os,
   * src/app/growth/**) -- nunca fabricar um prefixo /admin que o código não
   * usa.
   */
  routes: string[];
  surfaces: ModuleSurfaceAvailability[];
  /** WorkspaceCapability(s) de src/config/workspace-capabilities.ts que este módulo consulta, quando aplicável. */
  capabilities: string[];
  /** O que o módulo LÊ de outros módulos/fontes. */
  consumes: string[];
  /** O que o módulo PRODUZ para outros módulos consumirem. */
  produces: string[];
  /** IDs de outros módulos deste registry dos quais este depende. */
  dependsOn: string[];
  /** Integrações externas relevantes (mesmo que ainda não conectadas). */
  integrations: string[];
  maturity: PlatformModuleMaturity;
  /** Ponte para src/config/project-status.ts — id de ProjectAreaStatus, quando existir um. */
  readinessAreaId?: string;
  /** true quando o módulo tem alguma adaptação por pacote de nicho (src/config/business-niche-packs.ts). */
  nicheSupport: boolean;
  owner: string;
  notes?: string;
}

export const PLATFORM_MODULES: PlatformModuleDefinition[] = [
  {
    id: "workspaces_core",
    name: "Workspaces (núcleo de superfícies e capacidades)",
    description: "Camada que resolve superfície ativa (super_admin/agency/agency_client/direct_business), preview read-only e capacidades — base de autorização para todos os outros módulos administrativos.",
    category: "core",
    routes: ["/admin/visualizar"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "full_access" },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "not_applicable", notes: "Ainda não existe um sub-papel operacional dentro de uma superfície — todo usuário autenticado herda a superfície inteira." },
    ],
    capabilities: ["support.preview_workspace"],
    consumes: [],
    produces: ["workspace_context", "capability_resolution"],
    dependsOn: [],
    integrations: [],
    maturity: "qa_pending",
    readinessAreaId: "workspace_preview_security",
    nicheSupport: false,
    owner: "platform",
    notes: "src/lib/workspaces/types.ts + src/config/workspace-capabilities.ts. Não duplicar: qualquer módulo novo consulta resolveCapabilities()/hasCapability(), nunca reimplementa checagem de papel.",
  },
  {
    id: "super_admin_console",
    name: "Super Admin (contas, billing, leads, waitlist)",
    description: "Console administrativo da própria LOKAT: contas da plataforma, billing, leads comerciais e waitlist de pré-acesso.",
    category: "platform",
    routes: ["/admin/super/accounts", "/admin/super/billing", "/admin/super/leads", "/admin/super/waitlist"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: ["platform.manage", "platform.manage_agencies", "platform.manage_businesses"],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "platform",
  },
  {
    id: "meu_negocio",
    name: "Meu Negócio",
    description: "Centro de Comando para empresa direta/autônomo: Visão geral, DNA & Estratégia, Financeiro, CMV e Cardápio, Produtos e Fichas, Estoque e Compras, Relatórios, Fontes e Integrações, Configurações -- com período central/personalizado, Visão simples/Modo Gestor e classificação de dados por origem. Sprint Meu Negócio 2.1.2 (2026-07-31) reconectou a camada estratégica (DNA, 8Ps LOKAT, SWOT/FOFA, concorrência, posicionamento, metas e sazonalidade) que existia em main mas estava desconectada da experiência real desde a migração para este Centro de Comando -- ver src/lib/business-strategy/ e docs/meu-negocio/business-dna-restoration.md. Hoje 100% em memória (fixtures), sem Supabase.",
    category: "management",
    routes: ["/admin/meu-negocio"],
    surfaces: [
      { surface: "super_admin", access: "preview_read_only" },
      { surface: "agency", access: "conditional", notes: "Por cliente, conforme plano — ainda não implementado nesta branch." },
      { surface: "agency_client", access: "conditional", notes: "Somente quando permitido pela agência." },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "conditional", notes: "Somente tarefas relacionadas, não a empresa inteira." },
    ],
    capabilities: ["business.manage_own_business", "business.manage_own_finance"],
    consumes: ["business_profile", "product_campaign_bridge"],
    produces: ["product_campaign_bridge", "financial_reconciliation"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "preview",
    nicheSupport: true,
    owner: "management",
    notes: "Ajustado na integração Core 2.1.1: a descrição original deste módulo (Fase 2, escrita sobre a base antiga feat/workspace-panels-v1) referenciava a demo antiga _client-content.tsx (8 abas: overview/business/products/pricing/campaigns/cashflow/sources/glossary). Após o merge com a main atual, o arquivo real é src/app/admin/meu-negocio/_entry.tsx -> _restaurant-workspace.tsx (Centro de Comando), já publicado em Production com o hotfix de período personalizado (FormData no submit, onInput+onChange). Modelo de qualidade de dado real é src/lib/data-quality/ (DataClassification), não mais src/lib/motor-lokat/types.ts -- Data Hub desta sprint não duplica, referencia.",
  },
  {
    id: "meu_escritorio",
    name: "Meu Escritório",
    description: "Cockpit interno da agência/operador: 'o que fazer hoje, esta semana e como foi este mês', agregando projeções reais de projetos e tarefas por empresa selecionada, com um modo Global (todas as empresas autorizadas) quando nenhuma está selecionada e o usuário é admin/super_admin. Rota existia desde Sprint MVP Experience Completion V0.1; nunca tinha sido registrada aqui até LKT MISSION CARD — LKT Operating Standard + Module Lifecycle Registry.",
    category: "management",
    routes: ["/admin/escritorio"],
    surfaces: [
      { surface: "super_admin", access: "full_access", notes: "Único papel que alcança o modo Global (todas as empresas)." },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable", notes: "resolveCompanyContext() redireciona role cliente para /client/home." },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["business_office_feed", "project_projection"],
    produces: [],
    dependsOn: ["workspaces_core", "rec_os"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "management",
    notes: "Usa resolveCompanyContext() canônico (mesmo mecanismo de rec_os/calendario_global), dado real via Supabase (getBusinessOfficeFeed/getProjectProjections), sem fixture. Ver docs/architecture/module-lifecycle-registry-v1.md para o roadmap V1/V2/V3 (V2 planejado: Clientes/Equipe/Financeiro como abas internas).",
  },
  {
    id: "minha_organizacao",
    name: "Minha Organização (Minha Agência / Minha Organização institucional)",
    description: "Identidade institucional do próprio workspace do usuário -- 'Minha Agência' (account_type agência: identidade, carteira de clientes) ou 'Minha Organização' (account_type direct_business). Distinto de meu_negocio (módulo operacional real, estoque/CMV/fichas) -- este é institucional/estrutural, não operacional. Decisão de produto já fixada em missão anterior (RESTORE MEU NEGÓCIO ROUTE / SEPARATE ORGANIZAÇÃO): os dois nunca são alias um do outro.",
    category: "management",
    routes: ["/admin/organizacao"],
    surfaces: [
      { surface: "super_admin", access: "not_applicable", notes: "Página é sobre o workspace do próprio usuário logado, não faz sentido em preview." },
      { surface: "agency", access: "full_access", notes: "Apresentação 'Minha Agência'." },
      { surface: "agency_client", access: "not_applicable", notes: "role cliente redireciona para /client/home." },
      { surface: "direct_business", access: "full_access", notes: "Apresentação institucional da própria empresa." },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["own_organization_summary"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "management",
    notes: "CORRIGIDO em Deployment Production Flow + Organization Naming Separation V1: quando account_type é direct_business, esta página exibia o título 'Meu Negócio' (src/app/admin/organizacao/page.tsx, PageHeader), o MESMO texto do módulo operacional real meu_negocio (/admin/meu-negocio) -- duas telas reais com o mesmo título, por rotas diferentes. Renomeada para 'Minha Organização' (decisão do usuário, reaproveitando o texto já usado nos estados de loading/erro da própria página). Existe também empresa_central (/admin/empresa, Company Central) como um terceiro conceito adjacente -- ver seu próprio registro.",
  },
  {
    id: "empresa_central",
    name: "Company Central",
    description: "Cockpit por-empresa-selecionada (Company Context obrigatório): projeções de projetos e work items, diagnóstico mais recente e findings -- sem mutação, sem chat da Gota (decisão explícita da sprint de origem). Rota existia desde Sprint MVP Dogfood Spine V0.1 (Bloco D); nunca tinha sido registrada aqui até esta missão.",
    category: "management",
    routes: ["/admin/empresa"],
    surfaces: [
      { surface: "super_admin", access: "preview_read_only" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["project_projection", "work_item_projection", "company_diagnostic"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "management",
    notes: "Maturidade conservadora (qa_pending, não production): esta missão confirmou a rota e o Company Context real, mas não fez QA completo do conteúdo. Não confundir com minha_organizacao (identidade do PRÓPRIO workspace) nem com meu_negocio (módulo operacional fixture-based) -- três telas institucionais/de-empresa distintas, ver docs/architecture/module-lifecycle-registry-v1.md.",
  },
  {
    id: "rec_os",
    name: "REC OS",
    description: "Produção de conteúdo: briefing, produção, aprovações, distribuição, calendário, resultados. Implementação real sob /admin/contentos; /admin/rec-os é apenas redirect para o nome público oficial.",
    category: "commercial",
    routes: ["/admin/contentos", "/admin/rec-os"],
    surfaces: [
      { surface: "super_admin", access: "preview_read_only", notes: "Gestão e preview." },
      { surface: "agency", access: "full_access", notes: "Multicliente." },
      { surface: "agency_client", access: "conditional", notes: "Aprovações, calendário e resultados permitidos; produção não." },
      { surface: "direct_business", access: "full_access", notes: "Uso da própria empresa." },
      { surface: "operational_user", access: "conditional", notes: "Produção e execução, sem aprovar o próprio trabalho." },
    ],
    capabilities: ["agency.view_multi_client_rec_os", "business.view_own_rec_os", "client_portal.approve_content"],
    consumes: ["commercial_campaign_brief", "domain_events"],
    produces: ["content_published_event", "domain_events"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "commercial",
    notes: "AMBIGUIDADE DE NOME confirmada em auditoria anterior (docs/DECISIONS.md): 'REC OS' (este módulo, rota /admin/contentos) é diferente de /admin/audiovisual (Audiovisual, tabela rec_projects, rota canônica desde a missão AUDIOVISUAL ROUTE SEPARATION -- /admin/recos preservado só como redirect legado) e de /admin/rec + /admin/rec/videos (plataforma de vídeo 'Lokat.rec', não tocada nesta missão). REC OS ARCHITECTURE ALIGNMENT V1: este módulo (produção/aprovações/calendário/conexões contextuais) é o V1 — Operacional do REC OS (ver doc do modelo de evolução acima de ModuleSurfaceAccess); rec_os_growth é o V2 — Inteligência planejado para cima dele. MODULE LIFECYCLE REGISTRY V2 FOUNDATION: 'ContentOS' é apenas o nome técnico antigo deste MESMO módulo (rota /admin/contentos), nunca uma entrada separada. REC OS não controla Influence OS -- rec_os_creator_dna/rec_os_influencer_radar/rec_os_growth_analytics (filhos de rec_os_growth) são versões por-cliente, com escopo de growth/aquisição, nunca o produto Influence OS em si (influence_os, agência inteira, identidade do criador como pessoa pública).",
  },
  /**
   * REC OS GROWTH PLANNER V1 ARCHITECTURE FOUNDATION — árvore conceitual
   * registrada nesta missão, nenhuma rota criada:
   *
   *   REC OS
   *   ├── Operação         (rec_os -- produção, aprovações, calendário/
   *   │                      conexões contextuais -- já REAL, V1 Operacional)
   *   └── Growth            (rec_os_growth -- por cliente, V2 Inteligência)
   *       ├── Growth Planner        (rec_os_growth_planner)
   *       ├── Paid Traffic Planner  (rec_os_paid_traffic_planner)
   *       ├── Content Planner       (rec_os_content_planner)
   *       ├── Creator DNA           (rec_os_creator_dna)
   *       ├── Influencer Radar      (rec_os_influencer_radar)
   *       └── Analytics             (rec_os_growth_analytics)
   *
   * Roadmap específico deste cluster (todo ele hoje not_implemented/
   * planned, sem exceção -- "planned" aqui nunca significa "em progresso",
   * só "decisão arquitetural tomada"):
   * - V1 Planejamento: usuário define objetivo, público, cidade, orçamento,
   *   tipo de criativo, canal -- só planejamento, nenhuma chamada externa.
   *   Alvo desta fundação: rec_os_growth_planner passa a "planned".
   * - V2 Integrações: Meta Ads API, métricas, sincronização de campanhas --
   *   ainda não iniciado.
   * - V3 Execução: criar campanhas, publicar anúncios, otimização
   *   automática -- corresponde ao V3 — Automação do modelo geral de
   *   evolução (ver doc acima de ModuleSurfaceAccess).
   *
   * Cada nó "REC OS <Algo>" abaixo tem um par de nome igual ou parecido já
   * existente sob influence_os (agência inteira, identidade do criador
   * como pessoa pública) -- são deliberadamente entradas DIFERENTES, nunca
   * a mesma funcionalidade duplicada: o par aqui é sempre por-cliente,
   * dentro do REC OS, focado em growth/aquisição, não em identidade de
   * criador. Ver a nota de cada entrada para o cross-reference exato.
   */
  {
    id: "rec_os_growth",
    name: "REC OS — Growth",
    description: "Submódulo de crescimento/marketing por cliente dentro do REC OS -- estratégia, campanhas, criativos, públicos, orçamento, simulações e métricas. Umbrella conceitual registrada em REC OS ARCHITECTURE ALIGNMENT V1 (auditoria anterior: REC OS GROWTH FOUNDATION V1), agora detalhada em 6 sub-nós por REC OS GROWTH PLANNER V1 ARCHITECTURE FOUNDATION (ver doc acima); nenhuma rota criada nesta missão -- a página /admin/contentos/campanhas (tabs campanhas/estrategia/trafego) já existe hoje como rascunho de UI sem contrato real e é a candidata a ser absorvida por este submódulo quando ele for implementado, nunca duplicada ao lado dele.",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
    notes: "V2 — Inteligência (planeja/simula antes de executar), distinto de growth_os (agência inteira, diagnóstico/funil/metas, rota /growth/*, não deste módulo) -- mesmo nome, escopos diferentes: este é por cliente, dentro do REC OS. rec_os_paid_traffic_planner e os 4 novos sub-módulos (growth_planner/content_planner/creator_dna/influencer_radar/growth_analytics) dependem deste id em vez de rec_os diretamente, pois cada um é uma peça de Growth, não um par dele.",
  },
  {
    id: "rec_os_growth_planner",
    name: "REC OS — Growth Planner",
    description: "Núcleo de planejamento estratégico de crescimento por cliente: objetivo, público, cidade, orçamento, tipo de criativo e canal -- só planejamento/simulação, nenhuma integração externa, nenhuma criação real de campanha. É o nó V1 desta fundação (ver doc REC OS GROWTH PLANNER V1 ARCHITECTURE FOUNDATION acima).",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_growth"],
    integrations: [],
    maturity: "planned",
    nicheSupport: false,
    owner: "product",
    notes: "Próxima frente recomendada após esta fundação de arquitetura. Nunca promete resultado -- quando implementado, classificação de viabilidade (verde/amarelo/vermelho) é sempre uma estimativa, nunca uma garantia. REC OS GROWTH PLANNER V1 FOUNDATION: tipos/contratos reais e testados em src/lib/rec-os-growth/ (types.ts/diagnostic.ts/projection-engine-contract.ts, 43 testes) -- ainda 'planned', não 'qa_pending': só diagnóstico + placeholder honesto existem, nenhum motor de recomendação real, nenhuma persistência, nenhuma UI.",
  },
  {
    id: "rec_os_content_planner",
    name: "REC OS — Content Planner",
    description: "Planejamento de pauta/estratégia de conteúdo por cliente dentro do Growth -- distinto de /admin/contentos/criar (que já existe e cria o item de conteúdo em si, produção real). Content Planner decide O QUE e PARA QUÊ antes de chegar ao wizard de criação.",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_growth"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "rec_os_creator_dna",
    name: "REC OS — Creator DNA",
    description: "Identidade de marca/criador de UM cliente do REC OS, usada para orientar Growth Planner/Content Planner -- NÃO confundir com creator_dna (Influence OS, identidade estratégica de um criador como pessoa pública, agência inteira, escopo totalmente diferente). Mesmo nome de conceito, dois módulos distintos, nunca a mesma tabela quando implementados.",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_growth"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
    notes: "Cross-reference: creator_dna (id diferente, dependsOn influence_os) é o par agência-inteira. Se algum dia fizer sentido unificar os dois, é uma decisão de produto explícita futura, nunca um merge silencioso de schema.",
  },
  {
    id: "rec_os_influencer_radar",
    name: "REC OS — Influencer Radar",
    description: "Descoberta/avaliação de influenciadores e parceiros de marca PARA um cliente do REC OS contratar -- NÃO confundir com creator_radar (Influence OS, radar de tendências de conteúdo PARA um criador publicar, agência inteira). Direção inversa: aqui o cliente procura criadores; lá o criador procura tendências.",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_growth"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "rec_os_growth_analytics",
    name: "REC OS — Growth Analytics",
    description: "Métricas de performance de crescimento por cliente (campanha/criativo/canal) dentro do Growth -- distinto de rec_os (Resultados/Insights Meta hoje é só nível de conta, nunca por campanha/criativo) e de creator_analytics (Influence OS, performance de um criador como pessoa pública, agência inteira).",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_growth"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "recos_audiovisual",
    name: "Audiovisual",
    description: "Dashboard de projetos de vídeo, tabela rec_projects — módulo distinto de REC OS. Rota canônica: /admin/audiovisual (/admin/recos preservado como redirect legado).",
    category: "commercial",
    routes: ["/admin/audiovisual"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "conditional" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "conditional" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "commercial",
    notes: "Não confundir com rec_os. Fora de escopo de alteração nesta sprint (regra de isolamento).",
  },
  {
    id: "crm_leads_clientes",
    name: "CRM (Leads e Clientes)",
    description: "Hoje: pipeline de leads/waitlist e gestão de clientes da agência (leads/funil/oportunidades). Roadmap adaptativo (Sprint Recovery 2.1.3, não implementado): núcleo universal (Lead/Contato/Empresa/Oportunidade/Pipeline/Follow-up/Temperatura), superfícies isoladas por workspace (Super Admin/Agência/Cliente/Empresa Direta/Operacional), adaptação por nicho (Alimentação/Materiais de construção/Agência e serviços/Construção civil/Varejo), motor de follow-up, motor de temperatura, dashboards Essencial/Gestor e assistente de IA sem ação automática — ver src/lib/crm-adaptive/ e docs/crm/.",
    category: "commercial",
    routes: ["/admin/leads", "/admin/clientes"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: ["agency.manage_clients"],
    consumes: [],
    produces: ["client_directory"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    readinessAreaId: "crm",
    nicheSupport: false,
    owner: "commercial",
    notes: "CRM adaptativo classificado priority P2 em project-status.ts (P1 só para crm_workspace_isolation, um gate de segurança). Bloqueio: depende de official_domain_qa do MVP P0/P1 atual antes de competir por atenção. Próxima etapa: prototipar o adaptador de nicho Alimentação (único arquétipo real hoje) sobre o núcleo universal, sem tocar o CRM real (leads/funil) desta entrada. Maturidade do CRM adaptativo em si (distinto do CRM real acima): planned.",
  },
  {
    id: "financeiro",
    name: "Financeiro",
    description: "Painel financeiro — hoje demonstrativo, sem modelo de dado real conectado a Supabase.",
    category: "management",
    routes: ["/admin/financeiro"],
    surfaces: [
      { surface: "super_admin", access: "preview_read_only" },
      { surface: "agency", access: "conditional" },
      { surface: "agency_client", access: "conditional", notes: "client_portal.view_finance." },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: ["business.manage_own_finance", "client_portal.view_finance"],
    consumes: ["financial_reconciliation"],
    produces: ["financial_reconciliation"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "experimental",
    nicheSupport: true,
    owner: "management",
    notes: "Nenhum modelo de dado real hoje — mais próximo é src/lib/billing/{entitlements,plans}.ts, que é sobre a própria assinatura LOKAT, não sobre as finanças da empresa do cliente.",
  },
  {
    id: "calendario_global",
    name: "Calendário Global",
    description: "Visão cross-cliente somente leitura, agregando content_items, operational_tasks e approvals via GlobalCalendarEvent.",
    category: "operations",
    routes: ["/admin/calendario"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "conditional", notes: "client_portal.view_calendar." },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "conditional" },
    ],
    capabilities: ["client_portal.view_calendar"],
    consumes: ["content_item", "operational_task", "approval"],
    produces: ["calendar_event_v2"],
    dependsOn: ["rec_os"],
    integrations: [],
    maturity: "qa_pending",
    readinessAreaId: "global_calendar",
    nicheSupport: false,
    owner: "operations",
    notes: "src/lib/global-calendar.ts é a fonte real (GlobalCalendarEvent). Esta sprint adiciona contratos 2.0 (categorias, providers, feriados) em src/lib/global-calendar-v2/ SEM duplicar o tipo existente.",
  },
  {
    id: "relatorios",
    name: "Relatórios",
    description: "Central de relatórios — hoje sem um único modelo de dado; consome marketing-intelligence e analytics do cardápio digital.",
    category: "intelligence",
    routes: ["/admin/relatorios", "/admin/relatorios/conteudo", "/admin/relatorios/faturamento"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access", notes: "agency.view_multi_client_reports." },
      { surface: "agency_client", access: "conditional", notes: "client_portal.view_reports." },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: ["agency.view_multi_client_reports", "business.view_own_reports", "client_portal.view_reports"],
    consumes: ["financial_reconciliation", "domain_events"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "intelligence",
    notes: "Nome visível padronizado para 'Relatórios' em toda a UI (sidebar, PageHeader, breadcrumbs) na Sprint REC OS 3.0.1 — uma sprint anterior já tinha essa intenção registrada aqui, mas 3 ocorrências reais ainda diziam 'Dados & Insights'/'Dados e Insights' (src/components/app-sidebar.tsx, src/app/admin/relatorios/page.tsx, src/app/admin/relatorios/conteudo/page.tsx), agora corrigidas. Rota e IDs técnicos preservados. Ganha ReportViewMode (Essencial/Analítica) sobre a mesma fonte. 'Resultados' do REC OS (desempenho de conteúdo/campanha) não foi renomeado — é um conceito diferente.",
  },
  {
    id: "fontes_dados",
    name: "Fontes de Dados",
    description: "Página de configuração/listagem de fontes de dados conectadas.",
    category: "integrations",
    routes: ["/admin/fontes-dados"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "conditional" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "conditional", notes: "business.manage_own_integrations." },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: ["business.manage_own_integrations"],
    consumes: [],
    produces: ["data_source_registry"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "preview",
    nicheSupport: false,
    owner: "integrations",
  },
  {
    id: "conexoes",
    name: "Conexões / Integrações",
    description: "Hub de integrações (Meta, cardápio digital e futuras conexões).",
    category: "integrations",
    routes: ["/admin/conexoes"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "conditional" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "conditional" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: ["business.manage_own_integrations"],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: ["meta", "digital_menu"],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "integrations",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Página hoje é só roadmap/placeholder — nenhuma conexão real de número.",
    category: "communication",
    routes: ["/admin/whatsapp"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "conditional" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "conditional" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: ["whatsapp_meta_cloud_api", "whatsapp_evolution"],
    maturity: "planned",
    nicheSupport: false,
    owner: "communication",
    notes: "Esta sprint adiciona somente contratos (src/lib/messaging/types.ts). Nenhum número conectado, nenhum webhook, nenhuma instância Evolution.",
  },
  {
    id: "equipe",
    name: "Equipe",
    description: "Gestão de equipe, papéis e convites.",
    category: "management",
    routes: ["/admin/equipe"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access", notes: "agency.manage_team." },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "full_access", notes: "business.manage_own_team." },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: ["agency.manage_team", "business.manage_own_team"],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "management",
  },
  {
    id: "operacional",
    name: "Operacional",
    description: "Kanban/dashboard operacional — hoje um núcleo genérico, sem templates por nicho ainda conectados.",
    category: "operations",
    routes: ["/admin/operacional", "/admin/operacional/kanban", "/admin/operacional/dashboard"],
    surfaces: [
      { surface: "super_admin", access: "preview_read_only" },
      { surface: "agency", access: "conditional" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "full_access" },
    ],
    capabilities: [],
    consumes: ["operational_template"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "preview",
    nicheSupport: true,
    owner: "operations",
    notes: "Esta sprint só adiciona o contrato OperationalTemplate — nenhum painel operacional completo por nicho.",
  },
  {
    id: "diagnosticos",
    name: "Diagnósticos",
    description: "Diagnóstico rápido de marketing/negócio, com identificação.",
    category: "intelligence",
    routes: ["/admin/diagnosticos"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "conditional" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "conditional" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "intelligence",
  },
  {
    id: "configuracoes",
    name: "Configurações",
    description: "Configurações administrativas, incluindo status de IA/voz configurada.",
    category: "platform",
    routes: ["/admin/configuracoes"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "conditional" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "conditional" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: ["openai"],
    maturity: "production",
    nicheSupport: false,
    owner: "platform",
  },
  {
    id: "status",
    name: "Status da plataforma",
    description: "Página de status de deployment/sistema — a mesma fonte que alimenta src/config/project-status.ts.",
    category: "platform",
    routes: ["/admin/status"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: ["platform.view_status"],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "platform",
  },
  {
    id: "command_center",
    name: "Command Center",
    description: "Barra de comando de /admin/inicio (smart-start-input.tsx) -- resolvedor de intenção baseado em regras (resolveCommandFlow(), src/lib/command-center/intents.ts), nunca chama LLM. Registrado em MODULE LIFECYCLE REGISTRY V2 FOUNDATION -- código real e usado, gap de registry confirmado (existia sem entrada até esta missão).",
    category: "core",
    routes: ["/admin/inicio"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "platform",
    notes: "Catálogo de intents próprio e deliberadamente distinto do catálogo do Conversation Core (src/lib/conversation/intents.ts) -- resolve ações de NAVEGAÇÃO da UI admin, o outro resolve DOMÍNIO cross-canal; nenhum importa do outro.",
  },
  {
    id: "jarvis",
    name: "Jarvis",
    description: "Assistente de IA channel-agnostic em princípio (streamJarvisChat/buildJarvisContextText/buildJarvisSystemInstructions), hoje só acoplado à rota Web (/api/jarvis/chat, sessão Supabase de navegador + streaming SSE). Registrado em MODULE LIFECYCLE REGISTRY V2 FOUNDATION -- 5 rotas reais confirmadas, gap de registry.",
    category: "core",
    routes: ["/api/jarvis/chat", "/api/jarvis/context", "/api/jarvis/speech", "/api/jarvis/status", "/api/jarvis/transcribe"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "conditional" },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "conditional" },
    ],
    capabilities: [],
    consumes: ["company_context"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "platform",
    notes: "TELEGRAM ADAPTER V1/TELEGRAM IDENTITY LINK V1: streamJarvisChat()/transcribeAudio() já reutilizados como building blocks pela Conversational Layer -- /api/jarvis/chat em si (sessão+SSE) nunca é chamado diretamente por outro canal.",
  },
  {
    id: "projetos",
    name: "Projetos",
    description: "Projeções de projeto por empresa (getProjectProjections, Supabase real, sem fixture) -- consumido também por Meu Escritório e Company Central, nunca duplicado. Registrado em MODULE LIFECYCLE REGISTRY V2 FOUNDATION -- rota real confirmada, gap de registry.",
    category: "core",
    routes: ["/admin/projetos"],
    surfaces: [
      { surface: "super_admin", access: "preview_read_only" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "full_access" },
      { surface: "operational_user", access: "conditional" },
    ],
    capabilities: [],
    consumes: [],
    produces: ["project_projection"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "production",
    nicheSupport: false,
    owner: "platform",
    notes: "produces: project_projection -- mesmo dado que meu_escritorio e empresa_central consomem (getProjectProjections real, Supabase), nunca uma segunda fonte.",
  },

  // ── STATUS LIVE ACTIVITY V1 — Influence OS + Paid Traffic + integrações
  // futuras. Nenhum destes tem rota/UI/tabela hoje -- entradas aqui existem
  // só para que o roadmap não desapareça do registry real, conforme a
  // missão (item 13/14). "não implementar" != "não existe no mapa".
  {
    id: "influence_os",
    name: "Influence OS",
    description: "Suíte futura para criadores/influenciadores: identidade estratégica (Creator DNA), branding, calendário de conteúdo, parcerias de marca e analytics. Nenhuma rota/tabela hoje -- só arquitetura conceitual (ver auditoria de Personal Strategy OS/Content Lab).",
    category: "intelligence",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: [],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
    notes: "Guarda-chuva conceitual dos módulos Creator DNA/Branding/Radar/Calendar/Partnerships/Analytics abaixo.",
  },
  {
    id: "creator_dna",
    name: "Creator DNA",
    description: "Identidade estratégica de um perfil público (posicionamento, pilares, tom de voz, bio versionada) -- núcleo do Influence OS.",
    category: "intelligence",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["influence_os"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
    notes: "Cross-reference (REC OS GROWTH PLANNER V1 ARCHITECTURE FOUNDATION): rec_os_creator_dna é o par por-cliente dentro do REC OS -- este aqui é agência inteira, identidade do criador como pessoa pública.",
  },
  {
    id: "creator_branding",
    name: "Creator Branding",
    description: "Identidade visual do criador (paleta, estilo fotográfico, elementos recorrentes de Feed/Stories) -- reaproveita conceito de Brand Manual empresarial, nunca duplica.",
    category: "intelligence",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["influence_os", "creator_dna"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "creator_radar",
    name: "Creator Radar",
    description: "Radar de tendências/oportunidades para criadores -- equivalente ao Radar do REC OS (hoje fixture/demo), mas para o domínio de influência.",
    category: "intelligence",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["influence_os"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
    notes: "Cross-reference (REC OS GROWTH PLANNER V1 ARCHITECTURE FOUNDATION): rec_os_influencer_radar é o par por-cliente dentro do REC OS, direção inversa (cliente procurando criador, não criador procurando tendência). IMPORTANTE (MODULE LIFECYCLE REGISTRY V2 FOUNDATION): Radar nunca deve existir como dado falso -- depende de integrações reais futuras (ex.: leitura de plataformas sociais); enquanto not_implemented, nenhuma UI deve fingir tendência real.",
  },
  {
    id: "creator_trends",
    name: "Creator Trends",
    description: "Biblioteca de formatos de conteúdo (não de oportunidades/tendências de mercado, que é creator_radar) -- estruturas/templates de vídeo/post por nicho que um criador pode aplicar. Dois conceitos vizinhos e deliberadamente distintos: Radar descobre O QUE está em alta; Trends cataloga COMO estruturar o formato.",
    category: "intelligence",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["influence_os"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "creator_calendar",
    name: "Creator Calendar",
    description: "Calendário de conteúdo do criador -- mesma arquitetura de projeção contextual já validada em REC OS Context Foundation V1 (fonte única, view filtrada), nunca uma segunda fonte de eventos.",
    category: "intelligence",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["influence_os"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "creator_partnerships",
    name: "Creator Partnerships",
    description: "Parcerias de marca do criador (briefing, negociação, deliverables, aprovação, pagamento) -- três objetos distintos já decididos na arquitetura (Conteúdo / Capture Session / Campanha-Parceria), nunca implementados.",
    category: "intelligence",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["influence_os"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "creator_analytics",
    name: "Creator Analytics",
    description: "Métricas de performance por conteúdo/parceria do criador -- REC OS hoje só tem Insights Meta em nível de conta, nunca por conteúdo individual (mesma lacuna real registrada em Insights/Resultados do REC OS).",
    category: "intelligence",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["influence_os"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
    notes: "Cross-reference (REC OS GROWTH PLANNER V1 ARCHITECTURE FOUNDATION): rec_os_growth_analytics é o par por-cliente dentro do REC OS Growth.",
  },
  {
    id: "rec_os_paid_traffic_planner",
    name: "REC OS — Paid Traffic Planner",
    description: "Submódulo próprio do REC OS para tráfego pago -- decisão arquitetural já fixada (STATUS LIVE ACTIVITY V1 / REC OS Context Foundation V1): NUNCA a aba placeholder 'Tráfego' de Campanhas, que continua sendo só um rascunho de UI sem contrato real. Próxima frente recomendada.",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_growth"],
    integrations: ["meta", "google_ads"],
    maturity: "planned",
    nicheSupport: false,
    owner: "product",
    notes: "NEXT_FRONT confirmado em REC OS Context Foundation V1 e Meu Negócio Access Restore. REC OS ARCHITECTURE ALIGNMENT V1: reclassificado como filho de rec_os_growth (V2 — Inteligência: objetivo/estratégia/simulação com classificação verde/amarelo/vermelho, nunca promete resultado), não mais filho direto de rec_os. REC OS PAID TRAFFIC PLANNER V1 FOUNDATION: tipos/contratos reais e testados em src/lib/rec-os-paid-traffic/ (types.ts/channels.ts/budget.ts/conversion.ts/planner.ts, 45 testes) -- ainda 'planned', não 'qa_pending': plano recebe objective/context do Growth Plan real (buildPaidTrafficPlanFromGrowthPlan, nunca recria estratégia própria), catálogo fechado de canais (META_ADS/GOOGLE_ADS/ORGANIC_SUPPORT) e eventos de conversão, orçamento apenas descritivo (nenhum cálculo de ROI). Nenhuma integração com Meta Ads/Google Ads real, nenhuma publicação, nenhuma persistência, nenhuma UI.",
  },
  {
    id: "rec_os_campaign_planner",
    name: "REC OS — Campaign Planner",
    description: "Estrutura de campanhas por cliente dentro do Growth -- organiza objetivo/peças/canais/cronograma de UMA campanha depois que Growth Planner já definiu a estratégia. Registrado em MODULE LIFECYCLE REGISTRY V2 FOUNDATION; nenhuma rota/UI criada.",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_growth"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
    notes: "Distinto de rec_os_growth_planner (estratégia/objetivo, um nível acima) e de rec_os_content_planner (pauta de conteúdo, não de campanha) -- três conceitos vizinhos, nunca fundidos.",
  },
  {
    id: "rec_os_projection_engine",
    name: "REC OS — Projection Engine",
    description: "Motor de simulação compartilhado (população/público-alvo/frequência/impressões/CPM/orçamento/cobertura) consumido por Growth Planner e Paid Traffic Planner -- um único motor, nunca uma fórmula duplicada por submódulo. Sempre rotulado ESTIMATIVA DE PLANEJAMENTO, nunca garantia de resultado.",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_growth"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
    notes: "REC OS GROWTH PLANNER V1 FOUNDATION: contrato real em src/lib/rec-os-growth/projection-engine-contract.ts (ProjectionEngineInput/Output, estimateProjection()) -- sempre retorna status not_implemented, nenhum cálculo real ainda. Continua not_implemented (não 'planned'): só a forma do contrato existe, nenhuma decisão de fórmula foi tomada.",
  },
  {
    id: "paid_traffic_persistence",
    name: "Paid Traffic Persistence",
    description: "Persistência real (planejamento/orçamento/resultado) de campanhas de tráfego pago -- nenhuma tabela existe hoje, faz parte do escopo futuro do Paid Traffic Planner, não implementado nesta sprint (SQL explicitamente fora de escopo).",
    category: "commercial",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["rec_os_paid_traffic_planner"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "meta_publish",
    name: "Meta Publish",
    description: "Publicação automática (agendada) em Meta/Instagram a partir do REC OS -- hoje o produto só lê status/assets (meta_connections, client_meta_assets), nunca publica. Comunicado como funcionalidade futura, nenhum trabalho iniciado.",
    category: "integrations",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["meta_connections"],
    produces: [],
    dependsOn: [],
    integrations: ["meta"],
    maturity: "coming_soon",
    nicheSupport: false,
    owner: "product",
    notes: "V3 — Automação (o módulo executa sozinho, ver modelo de evolução acima de ModuleSurfaceAccess).",
  },
  {
    id: "google_ads",
    name: "Google Ads",
    description: "Integração com Google Ads -- nenhuma conexão/tabela/rota existe hoje no produto. Comunicado como funcionalidade futura (mesmo status de Meta Publish), nenhum trabalho iniciado.",
    category: "integrations",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: [],
    integrations: ["google_ads"],
    maturity: "coming_soon",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "growth_os",
    name: "GrowthOS",
    description: "Diagnóstico e estratégia da agência inteira: diagnósticos, plano de ação, funil de vendas, ofertas, concorrentes, metas. Rota própria fora de /admin (src/app/growth/**, layout dedicado 'GrowthOS — Diagnóstico e Estratégia'), não registrado neste mapa até a auditoria REC OS ARCHITECTURE ALIGNMENT V1. NÃO confundir com rec_os_growth (Growth por cliente, dentro do REC OS, ainda not_implemented) -- mesmo nome de produto, escopos e dados completamente diferentes; nunca a mesma rota, nunca a mesma tabela.",
    category: "intelligence",
    routes: ["/growth/diagnosticos", "/growth/plano-de-acao", "/growth/funil", "/growth/ofertas", "/growth/concorrentes", "/growth/metas"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "conditional", notes: "Sem gate de role dedicado confirmado em src/proxy.ts para estas rotas -- nenhum dos branches de role (admin/super_admin, cliente, aluno, operacional) bloqueia /growth explicitamente, então hoje o acesso real não é tecnicamente restrito a agency-only, mesmo sendo essa a intenção de produto." },
      { surface: "direct_business", access: "conditional", notes: "Mesmo gap de gate acima." },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: [],
    integrations: [],
    maturity: "preview",
    nicheSupport: false,
    owner: "management",
    notes: "Todas as páginas confirmadas 100% em memória (arrays hardcoded, ex.: src/app/growth/metas/page.tsx `const goals = [...]`), sem Supabase -- por isso 'preview', nunca 'production'. V2 — Inteligência no modelo de evolução (diagnóstico/simulação/benchmark antes de agir), mas apontado aqui como um módulo à parte de REC OS -- não uma dependência dele.",
  },
  {
    id: "conversation_core",
    name: "Conversation Core",
    description: "UMA INTELIGÊNCIA / VÁRIAS INTERFACES: núcleo channel-agnostic (src/lib/conversation/ -- types/channels/intents/session/context/router) que interpreta intenção, resolve Company Context (reusando resolveCompanyContext()/listAuthorizedCompanies(), nunca reimplementado) e aponta para o módulo de domínio real, com maturidade honesta lida deste mesmo registry. Nenhum canal específico (Telegram/WhatsApp) tem lógica própria -- toda inteligência mora aqui.",
    category: "platform",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["company_context"],
    produces: ["conversation_route_decision"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "product",
    notes: "Código real e testado (70 testes -- 37 estruturais + 33 unitários) desde LOKAT OS Conversation Core Foundation V1, mas ainda não confirmado rodando em Production -- por isso qa_pending, não production. routes: [] porque este módulo não tem rota HTTP própria (é consumido pelos adapters de canal).",
  },
  {
    id: "telegram_adapter",
    name: "Telegram Adapter",
    description: "Primeiro CHANNEL ADAPTER real da Conversational Layer (TELEGRAM ADAPTER V1): webhook (fail-closed sem TELEGRAM_WEBHOOK_SECRET, comparação em tempo constante), normalização de Update (PRIVATE TEXT MESSAGE V1 -- grupo/canal/foto/voice/document/callback_query nunca causam erro, só 'unsupported'), comandos /start e /help, e sendMessage via fetch puro (token nunca exposto em log/erro/resposta). Nenhuma lógica de negócio própria -- delega 100% ao Conversation Core.",
    category: "communication",
    routes: ["/api/integrations/telegram/webhook"],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["conversation_route_decision"],
    produces: [],
    dependsOn: ["conversation_core"],
    integrations: ["telegram"],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "product",
    notes: "Webhook + normalização + sender funcionais e testados (42 testes unitários + 29 estruturais), mas setWebhook nunca foi chamado nesta missão (proibido explicitamente) e TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET não estão confirmados configurados em Production -- zero tráfego real chega ainda. Sem tabela/persistência de Identity Link (ver telegram_identity_link).",
  },
  {
    id: "telegram_identity_link",
    name: "Telegram Identity Link",
    description: "Vínculo entre telegram_user_id e profile_id via token temporário HMAC-assinado (mesmo padrão de src/lib/workspaces/preview-session.ts). /start <token> hoje já valida token real (assinatura/expiração/reuso/já-vinculado) e cria o vínculo de ponta a ponta -- mas via InMemoryIdentityLinkStore (src/lib/conversation/identity-link-store.ts), nunca uma tabela real. Migration proposta e não aplicada em docs/supabase/93-identity-links.sql.",
    category: "communication",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["telegram_adapter"],
    integrations: [],
    maturity: "planned",
    nicheSupport: false,
    owner: "product",
    notes: "TELEGRAM IDENTITY LINK V1 FOUNDATION: lógica completa e testada (28 testes unitários + 26 estruturais, cobrindo os 11 cenários da missão -- token válido/expirado/inválido/reusado, usuário já vinculado, secret nunca exposto, username nunca usado como identidade, Company Context intocado, Conversation Core recebe o usuário identificado). 'planned', nunca 'production'/'qa_pending': sem persistência durável (SQL não aplicado por decisão explícita da missão), o vínculo não sobrevive a um cold start real em Production. Geração do token pelo painel Web (ETAPA 1-2 do fluxo) também não foi construída nesta missão -- generateIdentityLinkToken() existe e está pronta para uma rota autenticada futura chamá-la.",
  },
  {
    id: "telegram_domain_actions",
    name: "Telegram Domain Actions",
    description: "Execução real de ações de domínio (criar campanha, aprovar peça, consultar projeto) a partir do Telegram, depois que Identity Link existir -- hoje o adapter só IDENTIFICA a intenção tecnicamente e responde ACCOUNT_LINK_REQUIRED, nunca executa.",
    category: "communication",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["telegram_identity_link"],
    integrations: [],
    maturity: "not_implemented",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "telegram_voice",
    name: "Telegram Voice",
    description: "TELEGRAM V2: voice message -> transcrição -> intenção. src/lib/jarvis/client.ts já expõe transcribeAudio(), reutilizável quando esta frente começar -- nenhum trabalho iniciado.",
    category: "communication",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["telegram_adapter"],
    integrations: [],
    maturity: "coming_soon",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "telegram_approvals",
    name: "Telegram Approvals",
    description: "TELEGRAM V2: aprovar/pedir alteração de peças diretamente pelo Telegram, sempre refletindo na mesma aprovação real do painel Web -- nunca uma segunda fila de aprovação exclusiva do canal. Depende de Identity Link.",
    category: "communication",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: [],
    dependsOn: ["telegram_identity_link"],
    integrations: [],
    maturity: "coming_soon",
    nicheSupport: false,
    owner: "product",
  },
  {
    id: "whatsapp_adapter",
    name: "WhatsApp Adapter",
    description: "TELEGRAM V1 confirmou a arquitetura channel-agnostic é reutilizável (routeConversationMessage()/resolveConversationCompanyContext()/session.ts não têm nada específico de Telegram) -- WhatsApp é o próximo canal (V2 do roadmap de canais), reusando o Conversation Core inteiro. Nenhum trabalho iniciado.",
    category: "communication",
    routes: [],
    surfaces: [
      { surface: "super_admin", access: "not_applicable" },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["conversation_route_decision"],
    produces: [],
    dependsOn: ["conversation_core"],
    integrations: ["meta_cloud_api", "evolution_api"],
    maturity: "planned",
    nicheSupport: false,
    owner: "product",
    notes: "Não confundir com src/lib/messaging/types.ts (MessagingProvider, mesmos nomes de integração meta_cloud_api/evolution_*) -- aquele é o provider de baixo nível para WhatsApp Business em geral (ex.: notificações), este é especificamente o canal conversacional sobre o Conversation Core.",
  },
  // ── Retomada do produto ("cliente como centro do sistema") ──────────
  {
    id: "company_decisions",
    name: "Decisões da Company (Decision Ledger)",
    description: "Histórico imutável de decisões por Company -- título/contexto/origem/impacto/validação exigida do cliente, com cadeia de supersessão (mesmo padrão de personal_decisions/Meu PP, agora Company-scoped). Código completo (src/lib/company-decisions/, rota /api/admin/clients/[id]/decisions, seção em /admin/empresa) -- tabela company_decisions ainda não existe em Production.",
    category: "management",
    routes: ["/admin/empresa"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["company_context"],
    produces: ["company_decision_record"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "blocked",
    nicheSupport: false,
    owner: "product",
    notes: "BLOQUEADO: docs/supabase/99-company-decisions-and-relationship-links.sql escrito, testado localmente (test plan transacional), mas a aplicação em Production foi recusada pelo gate de permissão do conector Supabase -- aguardando aplicação manual via SQL Editor. Todo o código já degrada honestamente (DB_MIGRATION_PENDING) enquanto isso.",
  },
  {
    id: "company_next_window_planning",
    name: "Próxima Janela (planejamento em três tempos)",
    description: "Agrupamento de roadmap_items por horizonte (retrospectiva/imediato/próxima janela) + estágio de planejamento (ideia -> pré-planejamento -> análise -> aguardando decisão -> aprovado), nunca pulando direto para execução. Seção em /admin/empresa, criação de ideias via /api/admin/clients/[id]/roadmap.",
    category: "management",
    routes: ["/admin/empresa"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["company_context"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "blocked",
    nicheSupport: false,
    owner: "product",
    notes: "BLOQUEADO: roadmap_items já existe e já é lido/escrito em Production para outros campos; planning_stage/horizon/decision_id são aditivos (SQL 99) e ainda não aplicados -- getCompanyRoadmap() degrada para unavailable/schema_not_applied inteiro enquanto isso (o SELECT inclui as 3 colunas novas).",
  },
  {
    id: "client_project_scope",
    name: "Projetos do cliente + separação de escopo",
    description: "CRUD administrativo real de client_projects (antes só existia leitura no portal do cliente -- tabela sempre vazia em Production) + categoria de escopo (contratado/bônus/planejamento/fora do escopo/orçamento pendente/extra aprovado).",
    category: "management",
    routes: ["/admin/empresa", "/client/projeto"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "own_data_only", notes: "Portal do cliente só lê projetos com visible_to_client=true." },
      { surface: "direct_business", access: "own_data_only" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["company_context"],
    produces: ["client_project_record"],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "product",
    notes: "CRUD base (título/descrição/status/visibilidade) já funciona em Production hoje -- não depende de migration. scope_category depende de SQL 99 (BLOQUEADO) -- createClientProject()/getClientProjects() já degradam graciosamente (tentam com o campo, repetem sem ele se a coluna não existir), nunca falham a operação principal por causa disso.",
  },
  {
    id: "client_commercial_relationship",
    name: "Relacionamento comercial pós-venda (reunião/proposta)",
    description: "Reunião e proposta para uma Company JÁ FECHADA (QBR, revisão mensal, upsell) -- gap confirmado pela auditoria: commercial_meetings/commercial_proposals só tinham lead_id, nenhum mecanismo para cliente já ativo. Seção em /admin/empresa.",
    category: "commercial",
    routes: ["/admin/empresa"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["company_context"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "blocked",
    nicheSupport: false,
    owner: "product",
    notes: "BLOQUEADO: depende de commercial_meetings.client_id/commercial_proposals.client_id (SQL 99, aguardando aplicação manual em Production). O pipeline de pré-venda existente (/operacional/comercial/*, lead_id) continua intocado.",
  },
  {
    id: "client_opportunities",
    name: "Oportunidades comerciais (cliente ativo)",
    description: "Oportunidade identificada durante o acompanhamento de um cliente já ativo (ex.: 'cliente pediu 2 vídeos extras') -- reaproveita client_requests (request_type='opportunity', sem tabela nova). Seção em /admin/empresa.",
    category: "commercial",
    routes: ["/admin/empresa"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["company_context"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "product",
    notes: "Código completo, nenhuma migration necessária (client_requests já existe, request_type/source já são livres). Ainda sem validação com dado real em Production -- por isso qa_pending, não production.",
  },
  {
    id: "client_timeline",
    name: "Timeline / Histórico único da Company",
    description: "Leitura real de activity_logs por Company -- tabela existe desde o schema inicial mas, confirmado pela auditoria, só era ESCRITA (3 call sites fire-and-forget), nunca lida de volta. Fecha esse gap sem nenhuma tabela nova.",
    category: "intelligence",
    routes: ["/admin/empresa"],
    surfaces: [
      { surface: "super_admin", access: "full_access" },
      { surface: "agency", access: "full_access" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: ["company_context"],
    produces: [],
    dependsOn: ["workspaces_core"],
    integrations: [],
    maturity: "qa_pending",
    nicheSupport: false,
    owner: "product",
    notes: "Nenhuma migration necessária -- activity_logs já existe e já é escrita; esta é só a leitura, nova. qa_pending até ser validado com atividade real de uma Company em uso (hoje a tabela tem só 1 linha em Production).",
  },
  {
    id: "integration_events_bridge",
    name: "Ponte de Eventos (webhooks genéricos de sistemas externos)",
    description: "Endpoint inbound central (POST /api/integrations/events) para qualquer sistema externo (Cérebro Tayannara, agentes n8n, futuros produtos conectados) enviar eventos normalizados -- HMAC-SHA256 + proteção contra replay, idempotência real, roteamento por política fixa (nunca execução automática). Ver docs/integrations/events-webhook.md.",
    category: "integrations",
    routes: ["/api/integrations/events"],
    surfaces: [
      { surface: "super_admin", access: "not_applicable", notes: "Endpoint é server-to-server (HMAC), não uma tela admin." },
      { surface: "agency", access: "not_applicable" },
      { surface: "agency_client", access: "not_applicable" },
      { surface: "direct_business", access: "not_applicable" },
      { surface: "operational_user", access: "not_applicable" },
    ],
    capabilities: [],
    consumes: [],
    produces: ["company_decision_record", "client_opportunity_record"],
    dependsOn: ["company_decisions", "client_opportunities", "client_timeline"],
    integrations: ["tayannara_brain"],
    maturity: "blocked",
    nicheSupport: false,
    owner: "product",
    notes: "BLOQUEADO: depende de SQL 99 E SQL 100 (client_external_links + colunas novas em integration_webhook_events), nenhuma das duas aplicada em Production ainda. Segredo real de nenhuma integração configurado (LOKAT_INTEGRATION_SECRET_TAYANNARA_BRAIN pendente -- ver src/lib/integration-events/sources.ts). TEAM_ACTION_REQUIRED e PROJECT_STATUS_CHANGED têm política definida mas ação de domínio ainda não implementada (ver docs/integrations/events-webhook.md, seção Limitações). Código completo e testado (signature/idempotência/router/rota -- 50+ testes), nenhum deploy funcional ainda.",
  },
];

export function findModuleById(id: string): PlatformModuleDefinition | undefined {
  return PLATFORM_MODULES.find((module) => module.id === id);
}

export function findModulesByCategory(category: PlatformModuleCategory): PlatformModuleDefinition[] {
  return PLATFORM_MODULES.filter((module) => module.category === category);
}

export function findModulesBySurface(surface: ModuleSurface): PlatformModuleDefinition[] {
  return PLATFORM_MODULES.filter((module) => module.surfaces.some((entry) => entry.surface === surface && entry.access !== "not_applicable"));
}

/** Todo id referenciado em dependsOn precisa existir no próprio registry — usado pelo teste de integridade. */
export function findMissingDependencies(): Array<{ moduleId: string; missing: string[] }> {
  const knownIds = new Set(PLATFORM_MODULES.map((module) => module.id));
  const problems: Array<{ moduleId: string; missing: string[] }> = [];
  for (const mod of PLATFORM_MODULES) {
    const missing = mod.dependsOn.filter((id) => !knownIds.has(id));
    if (missing.length > 0) problems.push({ moduleId: mod.id, missing });
  }
  return problems;
}

/** Detecta ciclos de dependência via DFS -- um módulo nunca pode depender (direta ou indiretamente) de si mesmo. */
export function findDependencyCycles(): string[][] {
  const byId = new Map(PLATFORM_MODULES.map((module) => [module.id, module]));
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string, path: string[]) {
    if (visiting.has(id)) { cycles.push([...path, id]); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const mod = byId.get(id);
    for (const dep of mod?.dependsOn ?? []) visit(dep, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const mod of PLATFORM_MODULES) visit(mod.id, []);
  return cycles;
}
