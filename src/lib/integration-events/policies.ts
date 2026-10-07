/**
 * FASE 1B — seção 7 do brief: "Webhook não significa execução
 * automática." Mapa FIXO event_type -> política, nunca decidido em
 * tempo de execução por heurística. Mudar o comportamento de um
 * EVENT_TYPE é uma decisão de produto explícita (editar esta tabela),
 * nunca implícita no router.
 */
import type { IntegrationEventPolicy, IntegrationEventType } from "./types";

export const EVENT_POLICY: Record<IntegrationEventType, IntegrationEventPolicy> = {
  DECISION_CREATED: "CREATE_DECISION",
  APPROVAL_REQUESTED: "REQUIRE_HUMAN_REVIEW",
  BLOCKER_CREATED: "CREATE_NOTIFICATION",
  // Seção 7 -- escopo/orçamento/upsell entram como oportunidade/análise humana, nunca execução direta.
  UPSELL_INTERESTED: "CREATE_OPPORTUNITY",
  MEETING_REQUESTED: "CREATE_MEETING_REQUEST",
  SCOPE_CHANGE_REQUESTED: "CREATE_OPPORTUNITY",
  EXTRA_CONTENT_REQUESTED: "CREATE_OPPORTUNITY",
  PROJECT_STATUS_CHANGED: "UPDATE_PROJECT",
  CLIENT_PENDING_CREATED: "REQUIRE_HUMAN_REVIEW",
  TEAM_ACTION_REQUIRED: "CREATE_TASK",
};

/** Políticas que sempre também geram uma notificação, além da ação própria (seção 10). */
export const ALWAYS_NOTIFY_EVENT_TYPES: ReadonlySet<IntegrationEventType> = new Set([
  "MEETING_REQUESTED", "UPSELL_INTERESTED", "APPROVAL_REQUESTED", "BLOCKER_CREATED", "TEAM_ACTION_REQUIRED",
]);
