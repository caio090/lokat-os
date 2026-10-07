/**
 * Sprint SQL 91 Security Hardening V2 — Company Diagnostic → Finding →
 * Recommendation → Roadmap. Modelo mínimo, espelhando exatamente
 * docs/supabase/91-company-diagnostic-roadmap.sql (schema ainda não
 * executado -- ver Fase 50, "no database mutation"). `clients.id`
 * continua sendo a Company; nenhuma tabela de Company nova.
 *
 * Zero drift entre SQL / TypeScript / adapters (Fase 41): qualquer
 * mudança de contrato aqui precisa ser espelhada no SQL e vice-versa.
 */
export type DiagnosticStatus = "draft" | "in_progress" | "completed" | "archived";
export type ChecklistItemStatus = "yes" | "no" | "partial" | "unknown" | "not_applicable";
export type FindingSeverity = "low" | "medium" | "high";
export type FindingPriority = "low" | "medium" | "high";
/** Fase 18 — status é workflow puro. "Está no Roadmap" é uma relação
 * (um roadmap_items com source_type='diagnostic_recommendation'
 * apontando para uma recommendation deste finding), nunca um estado do
 * Finding em si -- por isso não existe mais "in_roadmap" aqui. */
export type FindingStatus = "open" | "planned" | "in_progress" | "resolved" | "ignored";
export type RecommendationCapability = "internal_execution" | "external_execution" | "coming_soon" | "not_supported";
/** Fase 22 — lifecycle próprio da Recommendation, separado do status do
 * Finding e do status do Roadmap. */
export type RecommendationStatus = "suggested" | "accepted" | "dismissed";
/** Fase 25 — status é workflow puro. "Está em um Project" já é
 * representado por `projectId !== null`, não duplicado como estado
 * (era "in_project"/"in_campaign" antes -- mesma confusão
 * workflow-vs-relação corrigida no Finding). Campaign ainda não existe
 * como entidade -- nenhum estado criado para ela. */
export type RoadmapItemStatus = "planned" | "in_progress" | "completed" | "cancelled";
export type RoadmapSourceType = "diagnostic_recommendation" | "radar" | "manual";
/**
 * SQL 99 (DB MIGRATION PENDING em Production no momento em que este
 * código foi escrito) — "Próxima Janela" (retomada do produto, seção
 * 11): uma ideia nunca pula direto pra execução. Eixo independente de
 * `status` acima -- só planningStage="approved" habilita status virar
 * "in_progress" na prática (regra de produto, não imposta pelo tipo).
 */
export type RoadmapPlanningStage = "idea" | "pre_planning" | "in_analysis" | "awaiting_decision" | "approved" | "cancelled";
/** SQL 99 — planejamento contínuo em três tempos (seção 10). null = item antigo, sem horizonte classificado ainda. */
export type RoadmapHorizon = "retrospective" | "immediate" | "next_window" | null;

export interface CompanyDiagnostic {
  id: string;
  companyId: string;
  status: DiagnosticStatus;
  nicheCategory: string | null;
  nicheSubcategory: string | null;
  operationType: "b2b" | "b2c" | "both" | null;
  locationCity: string | null;
  locationState: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface DiagnosticChecklistItem {
  id: string;
  diagnosticId: string;
  /** Fase 17 — chave estável para itens de um checklist canônico; null
   * para itens customizados/ad-hoc (nunca colide via UNIQUE). */
  itemKey: string | null;
  category: string;
  label: string;
  status: ChecklistItemStatus;
  notes: string | null;
  evidenceUrl: string | null;
  updatedAt: string;
}

/**
 * Fase 7 (P0.3) — `companyId` NÃO é uma coluna própria no banco (o SQL
 * removeu `diagnostic_findings.client_id` para eliminar a classe de
 * inconsistência "diagnostic_id de A + client_id de B"). O adapter
 * preenche este campo a partir do companyId já usado para filtrar a
 * query, nunca de uma coluna redundante -- ver getCompanyFindings().
 */
export interface DiagnosticFinding {
  id: string;
  diagnosticId: string;
  companyId: string;
  category: string;
  title: string;
  description: string | null;
  evidenceUrl: string | null;
  severity: FindingSeverity;
  priority: FindingPriority;
  status: FindingStatus;
  source: string;
}

export interface DiagnosticRecommendation {
  id: string;
  findingId: string;
  title: string;
  description: string | null;
  capability: RecommendationCapability;
  status: RecommendationStatus;
}

export interface RoadmapItem {
  id: string;
  companyId: string;
  sourceType: RoadmapSourceType;
  sourceId: string | null;
  title: string;
  description: string | null;
  priority: FindingPriority;
  status: RoadmapItemStatus;
  destinationCapability: RecommendationCapability | null;
  dueDate: string | null;
  projectId: string | null;
  /** SQL 99 (DB MIGRATION PENDING) */
  planningStage: RoadmapPlanningStage;
  /** SQL 99 (DB MIGRATION PENDING) */
  horizon: RoadmapHorizon;
  /** SQL 99 (DB MIGRATION PENDING) */
  decisionId: string | null;
}

/**
 * Fase 38-40/46 (No Hallucination) — toda leitura desta camada retorna um
 * destes estados, nunca inventa um deles a partir do outro:
 *   - `unavailable` / `reason: "schema_not_applied"`: a tabela ainda não
 *     existe no Supabase alvo (erro Postgres 42P01 -- SQL 91 não
 *     aplicado). Distinguível de forma real, não um chute -- é o código
 *     de erro que o Postgres de fato devolve.
 *   - `unavailable` / `reason: "internal_error"`: a query rodou contra um
 *     schema que existe mas falhou por outro motivo real (erro de rede,
 *     RLS mal configurada gerando erro em vez de filtrar, etc). Nunca
 *     expõe a mensagem de erro bruta do Postgres na UI -- só logada,
 *     sanitizada, no server (Fase 39).
 *   - `available` com valor `null`/`[]`: a tabela existe, a query rodou,
 *     não há dado real ainda para esta Company -- estado vazio honesto
 *     (NO_DIAGNOSTIC_YET, nunca confundido com indisponibilidade).
 *   - `available` com valor presente: dado real.
 * Nota (Fase 36-37): estes adapters são chamados hoje via
 * createSupabaseAdminClient() (service role, bypassa RLS -- ver Fase 36
 * do relatório). Por isso um estado `UNAUTHORIZED` distinto de "vazio"
 * não é observável aqui: com RLS de verdade, autorização negada e "sem
 * dado" são indistinguíveis por design (Postgres nunca revela
 * existência a quem não tem acesso) -- então adicionar um branch
 * `UNAUTHORIZED` aqui seria fabricar uma distinção que o service role
 * não pode genuinamente provar. Passar a usar um client session-aware
 * (Fase 37) tornaria isto observável de verdade -- não feito nesta
 * sprint para não trocar o client de todo o domínio às pressas.
 */
export type SourceFetchReason = "schema_not_applied" | "internal_error";
export type SourceFetchResult<T> =
  | { status: "unavailable"; reason: SourceFetchReason }
  | { status: "available"; data: T };
