/**
 * Retomada do produto, seção 18 — Oportunidade Comercial. Reaproveita
 * client_requests (já existe, já tem request_type/source livres, sem
 * CHECK restritivo -- confirmado antes de escrever este arquivo),
 * nenhuma tabela nova. request_type="opportunity" é a convenção desta
 * fase; outros valores (ex.: "support") continuam funcionando como já
 * funcionavam no portal do cliente (src/app/client/solicitacoes).
 */
export const OPPORTUNITY_REQUEST_TYPE = "opportunity" as const;

/** Seção 18 — origem sempre salva, nunca um valor inventado. */
export type OpportunityOrigin = "meeting" | "diagnostic" | "client" | "acompanhamento" | "manual";
export type OpportunityStatus = "open" | "in_review" | "in_progress" | "waiting_client" | "done" | "archived";
export type OpportunityPriority = "low" | "normal" | "high" | "urgent";

export interface ClientOpportunity {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  status: OpportunityStatus;
  priority: OpportunityPriority;
  origin: string;
  createdAt: string;
  updatedAt: string;
}

export type OpportunityFetchReason = "schema_not_applied" | "internal_error";
export type OpportunityFetchResult<T> =
  | { status: "unavailable"; reason: OpportunityFetchReason }
  | { status: "available"; data: T };
export type OpportunityWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: OpportunityFetchReason | "validation_error" };
