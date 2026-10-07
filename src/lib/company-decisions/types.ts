/**
 * Retomada do produto ("cliente como centro do sistema"), seção 8/9 —
 * Decision Ledger no nível da Company. Espelha
 * docs/supabase/99-company-decisions-and-relationship-links.sql
 * (DB MIGRATION PENDING em Production no momento em que este código foi
 * escrito -- gate de escrita do conector Supabase bloqueou a aplicação;
 * ver relatório da fase). Mesmo princípio de zero-drift SQL/TypeScript
 * já usado em company-diagnostic/types.ts.
 */
export type DecisionOrigin = "meeting" | "diagnostic" | "client" | "strategy" | "approval" | "project_review" | "campaign_result" | "manual";
export type DecisionImpact = "low" | "medium" | "high" | null;
/** Seção 9 — nem toda decisão volta pro cliente; cinco estados explícitos. */
export type ClientValidationMode = "internal" | "client_view" | "client_approval" | "client_choice" | "needs_meeting";
export type DecisionStatus = "active" | "superseded";

export interface CompanyDecision {
  id: string;
  companyId: string;
  title: string;
  decision: string;
  context: string | null;
  origin: DecisionOrigin;
  impact: DecisionImpact;
  clientValidation: ClientValidationMode;
  belongsToScope: boolean | null;
  generatesTask: boolean;
  generatesProject: boolean;
  generatesBudget: boolean;
  status: DecisionStatus;
  supersedesDecisionId: string | null;
  decidedOn: string;
  reviewAt: string | null;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DecisionFetchReason = "schema_not_applied" | "internal_error";
export type DecisionFetchResult<T> =
  | { status: "unavailable"; reason: DecisionFetchReason }
  | { status: "available"; data: T };

export type DecisionWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: DecisionFetchReason | "validation_error" };

export interface CreateCompanyDecisionInput {
  title: string;
  decision: string;
  context?: string | null;
  origin?: DecisionOrigin;
  impact?: DecisionImpact;
  clientValidation?: ClientValidationMode;
  belongsToScope?: boolean | null;
  generatesTask?: boolean;
  generatesProject?: boolean;
  generatesBudget?: boolean;
  decidedOn?: string;
  reviewAt?: string | null;
}
