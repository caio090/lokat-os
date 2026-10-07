/**
 * Retomada do produto, seção 4/17 — CRUD administrativo de
 * client_projects. A auditoria confirmou: a tabela e a leitura do
 * portal do cliente (src/app/client/projeto) já existem e funcionam,
 * mas NENHUM código do lado admin jamais escreve nela -- por isso ela
 * está sempre vazia em produção. Este domínio fecha esse lado,
 * reaproveitando a tabela existente (nenhuma tabela nova).
 *
 * scopeCategory (seção 17) depende de SQL 99 (DB MIGRATION PENDING em
 * Production no momento em que este código foi escrito) -- o restante
 * do CRUD (title/description/status/visibleToClient) NÃO depende da
 * migration e já funciona hoje.
 */
export type ClientProjectStatus = "active" | "paused" | "completed" | "archived";
/** SQL 99 (DB MIGRATION PENDING) */
export type ScopeCategory = "contratado" | "bonus" | "planejamento" | "fora_do_escopo" | "orcamento_pendente" | "extra_aprovado";

export interface ClientProject {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  status: ClientProjectStatus;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  visibleToClient: boolean;
  /** SQL 99 (DB MIGRATION PENDING) -- null enquanto a migration não aplicada (coluna não lida ainda, ver nota no adapter). */
  scopeCategory: ScopeCategory | null;
  /** FASE 1C / SQL 101 (DB MIGRATION PENDING) -- seção 19, visual de projetos. Todos null enquanto a migration não aplicada, mesmo fallback defensivo de scopeCategory. */
  projectType: string | null;
  currentPhase: string | null;
  ownerId: string | null;
  nextAction: string | null;
  blockedReason: string | null;
  clientDependency: string | null;
  /** FASE 1C / SQL 101 -- seção 17: projeto nasce do escopo confirmado de um onboarding (null quando criado fora desse fluxo). */
  onboardingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ClientProjectFetchReason = "schema_not_applied" | "internal_error";
export type ClientProjectFetchResult<T> =
  | { status: "unavailable"; reason: ClientProjectFetchReason }
  | { status: "available"; data: T };
export type ClientProjectWriteResult =
  | { ok: true; id: string; scopeCategoryApplied: boolean }
  | { ok: false; reason: ClientProjectFetchReason | "validation_error" };
