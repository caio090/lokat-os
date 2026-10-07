/**
 * FASE 1B — Ponte de Eventos / Webhooks do LOKAT OS. Camada GENÉRICA:
 * qualquer sistema externo (Cérebro Tayannara, um agente n8n, um
 * futuro produto conectado) usa o MESMO contrato -- nunca uma
 * integração nomeada por cliente. Tayannara é o primeiro caso real,
 * nunca um caso especial no código.
 *
 * Espelha docs/supabase/100-integration-events-and-client-external-links.sql
 * (DB MIGRATION PENDING em Production no momento em que este código foi
 * escrito -- mesmo gate de escrita que bloqueou SQL 99). Zero-drift
 * SQL/TypeScript, mesmo princípio de company-diagnostic/types.ts.
 */

/** Seção 2 do brief -- eventos suportados nesta fase. Enum central, nunca strings soltas pelo código. */
export const INTEGRATION_EVENT_TYPES = [
  "DECISION_CREATED",
  "APPROVAL_REQUESTED",
  "BLOCKER_CREATED",
  "UPSELL_INTERESTED",
  "MEETING_REQUESTED",
  "SCOPE_CHANGE_REQUESTED",
  "EXTRA_CONTENT_REQUESTED",
  "PROJECT_STATUS_CHANGED",
  "CLIENT_PENDING_CREATED",
  "TEAM_ACTION_REQUIRED",
  // FASE 1C (seção 14) -- mesmo endpoint genérico, nunca uma rota
  // especial de onboarding. Reaproveita POST /api/integrations/events.
  "ONBOARDING_STARTED",
  "ONBOARDING_ITEM_REQUESTED",
  "ONBOARDING_ITEM_COMPLETED",
  "CLIENT_ASSET_SUBMITTED",
  "SCOPE_APPROVED",
  "SCOPE_REJECTED",
  "KICKOFF_READY",
  "KICKOFF_COMPLETED",
] as const;
export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

export function isIntegrationEventType(value: unknown): value is IntegrationEventType {
  return typeof value === "string" && (INTEGRATION_EVENT_TYPES as readonly string[]).includes(value);
}

export type IntegrationEventPriority = "low" | "normal" | "high" | "urgent";

/** Seção 1 do brief -- contrato normalizado que TODO sistema externo envia, independente de qual é. */
export interface IntegrationEventPayload {
  event_id: string;
  event_type: IntegrationEventType;
  occurred_at: string;
  source_system: string;
  client_external_id: string;
  project_external_id?: string;
  entity_type?: string;
  entity_id?: string;
  title: string;
  description?: string;
  priority?: IntegrationEventPriority;
  requested_by?: string;
  metadata?: Record<string, unknown>;
  source_reference?: string;
}

/** Seção 7 do brief -- webhook nunca é execução automática. Cada EVENT_TYPE tem uma política fixa. */
export type IntegrationEventPolicy =
  | "LOG_ONLY"
  | "CREATE_NOTIFICATION"
  | "CREATE_OPPORTUNITY"
  | "CREATE_DECISION"
  | "CREATE_MEETING_REQUEST"
  | "CREATE_TASK"
  | "UPDATE_PROJECT"
  | "REQUIRE_HUMAN_REVIEW";

export type IntegrationEventStatus = "received" | "processing" | "processed" | "ignored" | "failed";

export interface IntegrationEventRecord {
  id: string;
  eventId: string;
  sourceSystem: string;
  eventType: IntegrationEventType;
  clientId: string | null;
  projectId: string | null;
  entityType: string | null;
  entityId: string | null;
  status: IntegrationEventStatus;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
  sourceReference: string | null;
}

export type IntegrationEventFetchReason = "schema_not_applied" | "internal_error";
export type IntegrationEventFetchResult<T> =
  | { status: "unavailable"; reason: IntegrationEventFetchReason }
  | { status: "available"; data: T };

/**
 * Seção 6 do brief -- o que o IntegrationEventRouter devolve depois de
 * decidir/executar a ação de um evento. `createdEntity` é preenchido
 * só quando a política realmente criou algo (nunca inventado).
 */
export interface IntegrationEventRouteResult {
  policy: IntegrationEventPolicy;
  createdEntity: { type: string; id: string } | null;
  notified: boolean;
}

/**
 * Seção 12 do brief -- projetado, NÃO implementado nesta fase (sem
 * entrega bidirecional real ainda). Mantido aqui só como contrato de
 * tipos para a próxima fase construir em cima, nunca um mecanismo que
 * finge enviar algo.
 */
export const OUTBOUND_EVENT_TYPES = [
  "MEETING_CONFIRMED",
  "PROPOSAL_CREATED",
  "UPSELL_IN_REVIEW",
  "REQUEST_RESOLVED",
  "PROJECT_STATUS_UPDATED",
] as const;
export type OutboundEventType = (typeof OUTBOUND_EVENT_TYPES)[number];

export interface OutboundEventPayload {
  event_id: string;
  event_type: OutboundEventType;
  occurred_at: string;
  client_external_id: string;
  in_reply_to_event_id?: string;
  title: string;
  metadata?: Record<string, unknown>;
}
