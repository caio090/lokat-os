/**
 * FASE 1B — IntegrationEventRouter. Recebe um evento JÁ normalizado e
 * já autorizado (a rota HTTP cuidou de validação/assinatura/
 * idempotência/identificação do cliente -- ver route.ts) e decide/
 * executa a ação de acordo com a política fixa de policies.ts. Toda a
 * lógica de interpretação mora AQUI, nunca na rota HTTP.
 *
 * Limitações desta fase, documentadas explicitamente (nunca um insert
 * arriscado/adivinhado em vez disso):
 *   - TEAM_ACTION_REQUIRED (CREATE_TASK): operational_tasks não tem,
 *     hoje, um caminho de criação manual seguro/auditado (confirmado
 *     pela auditoria desta mesma retomada -- "+ Nova tarefa" é um link
 *     morto). Degradar para notificação apenas é mais seguro que
 *     inserir numa tabela cujas regras completas de escrita ainda não
 *     foram mapeadas.
 *   - PROJECT_STATUS_CHANGED (UPDATE_PROJECT): resolução de
 *     project_external_id -> client_projects.id ainda não existe
 *     (só client-level, via client_external_links, foi construído
 *     nesta fase). Degradar para notificação apenas até essa
 *     resolução existir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENT_POLICY, ALWAYS_NOTIFY_EVENT_TYPES } from "./policies";
import type { IntegrationEventPayload, IntegrationEventRouteResult } from "./types";
import { createCompanyDecision } from "@/lib/company-decisions/adapters";
import { createClientOpportunity } from "@/lib/client-opportunities/adapters";
import { logClientActivity } from "@/lib/client-timeline/adapters";
import { notifyAdminsOfIntegrationEvent } from "./notify";

/** MEETING_REQUESTED nunca inventa uma data -- vira um pedido real em client_requests (mesma tabela de Oportunidades, request_type distinto), nunca um commercial_meetings.scheduled_at fabricado. Um humano marca a data de verdade depois, pela UI já construída em /admin/empresa. */
async function createMeetingRequestEntry(adminDb: SupabaseClient, companyId: string, payload: IntegrationEventPayload): Promise<{ type: string; id: string } | null> {
  const { data, error } = await adminDb
    .from("client_requests")
    .insert({
      client_id: companyId, title: payload.title, description: payload.description ?? null,
      request_type: "meeting_request", source: payload.source_system, priority: payload.priority ?? "normal",
    })
    .select("id")
    .single();
  if (error) { console.error("[integration-events] falha ao criar meeting_request (best-effort)", error.message); return null; }
  return { type: "client_request", id: data.id as string };
}

export async function routeIntegrationEvent(
  adminDb: SupabaseClient,
  payload: IntegrationEventPayload,
  companyId: string,
): Promise<IntegrationEventRouteResult> {
  const policy = EVENT_POLICY[payload.event_type];
  let createdEntity: IntegrationEventRouteResult["createdEntity"] = null;

  switch (policy) {
    case "CREATE_OPPORTUNITY": {
      const result = await createClientOpportunity(adminDb, companyId, null, {
        title: payload.title, description: payload.description ?? null, origin: "client", priority: payload.priority,
      });
      if (result.ok) createdEntity = { type: "opportunity", id: result.id };
      break;
    }
    case "CREATE_DECISION": {
      const result = await createCompanyDecision(adminDb, companyId, null, {
        title: payload.title, decision: payload.description ?? payload.title, origin: "client", clientValidation: "client_view",
      });
      if (result.ok) createdEntity = { type: "decision", id: result.id };
      break;
    }
    case "CREATE_MEETING_REQUEST": {
      createdEntity = await createMeetingRequestEntry(adminDb, companyId, payload);
      break;
    }
    case "CREATE_TASK":
    case "UPDATE_PROJECT":
    case "REQUIRE_HUMAN_REVIEW":
    case "CREATE_NOTIFICATION":
    case "LOG_ONLY":
      // Sem ação de domínio nesta fase -- ver limitações no cabeçalho do arquivo (CREATE_TASK/UPDATE_PROJECT) ou por design (as outras três são intencionalmente só log/notificação).
      break;
  }

  // Seção 9 -- timeline recebe sempre, independente da política (o
  // histórico deve mostrar TODO evento real, mesmo os que só geraram
  // notificação). Nunca grava payload técnico bruto -- só o que a UI mostra.
  await logClientActivity(adminDb, companyId, `integration_event_${payload.event_type.toLowerCase()}`, "integration_event", createdEntity?.id ?? null, {
    source_system: payload.source_system, title: payload.title, policy,
  });

  const shouldNotify = policy === "CREATE_NOTIFICATION" || policy === "REQUIRE_HUMAN_REVIEW" || ALWAYS_NOTIFY_EVENT_TYPES.has(payload.event_type);
  let notified = false;
  if (shouldNotify) {
    notified = await notifyAdminsOfIntegrationEvent(adminDb, {
      title: `${payload.source_system}: ${payload.title}`,
      message: payload.description ?? payload.title,
      companyId,
    });
  }

  return { policy, createdEntity, notified };
}
