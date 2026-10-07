/**
 * FASE 1B — persistência do registro de eventos (integration_webhook_events,
 * SQL 86 já existente + colunas novas de SQL 100, DB MIGRATION PENDING
 * no momento em que este código foi escrito). Idempotência real:
 * idempotency_key = "{source_system}:{event_id}" aproveita o UNIQUE
 * GLOBAL já existente na coluna (confirmado antes de escrever este
 * arquivo -- nunca presumido), sem precisar alterar essa constraint.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationEventPayload, IntegrationEventFetchReason, IntegrationEventStatus } from "./types";

function classifyError(table: string, err: unknown): IntegrationEventFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[integration-events] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

/** 23505 = unique_violation -- distinto de "schema ausente"/"erro interno": é o sinal real de "evento duplicado". */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null | undefined)?.code === "23505";
}

export function buildIdempotencyKey(sourceSystem: string, eventId: string): string {
  return `${sourceSystem}:${eventId}`;
}

export type InsertEventResult =
  | { outcome: "inserted"; id: string }
  | { outcome: "duplicate" }
  | { outcome: "error"; reason: IntegrationEventFetchReason };

/**
 * Seção 3 do brief -- "se o mesmo webhook chegar 2/3/10 vezes, NÃO
 * gerar duas oportunidades/tarefas/reuniões". A unicidade é garantida
 * pelo PRÓPRIO banco (UNIQUE em idempotency_key), nunca por uma
 * checagem SELECT-then-INSERT (que teria race condition real sob
 * concorrência) -- tenta inserir direto, interpreta 23505 como
 * "duplicate", nunca como erro.
 */
export async function insertIntegrationEvent(
  adminDb: SupabaseClient,
  payload: IntegrationEventPayload,
  clientId: string | null,
  projectId: string | null,
  sanitizedPayload: Record<string, unknown>,
): Promise<InsertEventResult> {
  try {
    const { data, error } = await adminDb
      .from("integration_webhook_events")
      .insert({
        provider: payload.source_system,
        event_type: payload.event_type,
        idempotency_key: buildIdempotencyKey(payload.source_system, payload.event_id),
        client_id: clientId,
        project_id: projectId,
        entity_type: payload.entity_type ?? null,
        entity_id: payload.entity_id ?? null,
        source_reference: payload.source_reference ?? null,
        requested_by_external_id: payload.requested_by ?? null,
        status: "received",
        attempts: 1,
        payload_sanitized: sanitizedPayload,
      })
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) return { outcome: "duplicate" };
      return { outcome: "error", reason: classifyError("integration_webhook_events", error) };
    }
    return { outcome: "inserted", id: data.id as string };
  } catch (err) {
    if (isUniqueViolation(err)) return { outcome: "duplicate" };
    return { outcome: "error", reason: classifyError("integration_webhook_events", err) };
  }
}

export async function markEventStatus(
  adminDb: SupabaseClient,
  eventRowId: string,
  status: IntegrationEventStatus,
  error?: string | null,
): Promise<void> {
  try {
    await adminDb
      .from("integration_webhook_events")
      .update({
        status,
        processed_at: status === "processed" || status === "ignored" || status === "failed" ? new Date().toISOString() : null,
        error: error ?? null,
      })
      .eq("id", eventRowId);
  } catch (err) {
    // Fase 39 (no hallucination, aplicada aqui também): marcar status é
    // best-effort de auditoria -- nunca derruba o processamento do
    // evento em si se a própria tabela de log falhar (ex.: schema
    // ainda pendente). Logado, nunca lançado.
    console.error("[integration-events] falha ao marcar status do evento (best-effort)", { eventRowId, status, error: err instanceof Error ? err.message : err });
  }
}
