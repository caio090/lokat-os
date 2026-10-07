import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { verifyWebhookSignature } from "@/lib/integration-events/signature";
import { getIntegrationSource, getIntegrationSourceSecret } from "@/lib/integration-events/sources";
import { resolveClientExternalId } from "@/lib/integration-events/client-resolution";
import { insertIntegrationEvent, markEventStatus } from "@/lib/integration-events/adapters";
import { routeIntegrationEvent } from "@/lib/integration-events/router";
import { isIntegrationEventType } from "@/lib/integration-events/types";
import type { IntegrationEventPayload } from "@/lib/integration-events/types";

/**
 * FASE 1B (Ponte de Eventos) — POST /api/integrations/events. Endpoint
 * INBOUND genérico, central: qualquer sistema externo (Cérebro
 * Tayannara, um agente n8n, um futuro produto conectado) usa o MESMO
 * contrato -- nunca uma rota exclusiva por cliente.
 *
 * Fluxo (seção do brief): validação (assinatura/payload) ->
 * identificação do cliente (client_external_id) -> registro do evento
 * (idempotente) -> roteamento -> ação/notificação/timeline.
 *
 * DB MIGRATION PENDING: depende de docs/supabase/100-integration-events-and-client-external-links.sql
 * (client_external_links + colunas novas em integration_webhook_events)
 * -- enquanto não aplicada, toda chamada real responde 503
 * DB_MIGRATION_PENDING, nunca finge ter processado o evento.
 *
 * Nunca deployado como integração externa funcional enquanto: migration
 * pendente, secret real não configurado, cadastro da Company real não
 * existir -- ver src/lib/integration-events/sources.ts (status
 * "configured"/"pending", nunca hardcoded).
 */
export const POST = withMutationProtection(async function POST(req: Request) {
  const sourceHeader = req.headers.get("x-lokat-source");
  const timestampHeader = req.headers.get("x-lokat-timestamp");
  const signatureHeader = req.headers.get("x-lokat-signature");

  if (!sourceHeader) {
    return NextResponse.json({ accepted: false, error: "x-lokat-source obrigatório" }, { status: 400 });
  }

  const source = getIntegrationSource(sourceHeader);
  if (!source) {
    return NextResponse.json({ accepted: false, error: "source_system desconhecido" }, { status: 403 });
  }
  const secret = getIntegrationSourceSecret(sourceHeader);
  if (!secret) {
    // Fonte registrada mas ainda sem segredo configurado (ex.: Tayannara nesta fase) -- nunca processa sem poder verificar a assinatura.
    return NextResponse.json({ accepted: false, error: "source_system ainda não configurado (segredo pendente)", code: "SOURCE_NOT_CONFIGURED" }, { status: 403 });
  }

  const rawBody = await req.text();
  const sigResult = verifyWebhookSignature({ secret, timestampHeader, signatureHeader, rawBody });
  if (!sigResult.ok) {
    return NextResponse.json({ accepted: false, error: `assinatura inválida (${sigResult.reason})` }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ accepted: false, error: "JSON inválido" }, { status: 400 });
  }
  const validation = validatePayload(parsed);
  if (!validation.ok) {
    return NextResponse.json({ accepted: false, error: validation.error }, { status: 400 });
  }
  const payload = validation.payload;

  if (!hasSupabaseServiceRoleKey()) {
    return NextResponse.json({ accepted: false, error: "server_not_configured" }, { status: 503 });
  }
  const adminDb = createSupabaseAdminClient();

  // ── Identificação do cliente ──────────────────────────────────
  const clientResult = await resolveClientExternalId(adminDb, payload.source_system, payload.client_external_id);
  if (clientResult.status === "unavailable") {
    if (clientResult.reason === "schema_not_applied") {
      return NextResponse.json({ accepted: false, error: "Migration pendente (SQL 100) -- ponte de eventos ainda não disponível.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ accepted: false, error: "Não foi possível identificar o cliente agora." }, { status: 500 });
  }
  const companyId = clientResult.data?.clientId ?? null;

  // ── Registro do evento (idempotente) ───────────────────────────
  const sanitizedPayload = sanitizeForAudit(payload);
  const insertResult = await insertIntegrationEvent(adminDb, payload, companyId, null, sanitizedPayload);
  if (insertResult.outcome === "error") {
    if (insertResult.reason === "schema_not_applied") {
      return NextResponse.json({ accepted: false, error: "Migration pendente (SQL 100) -- ponte de eventos ainda não disponível.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ accepted: false, error: "Não foi possível registrar o evento agora." }, { status: 500 });
  }
  if (insertResult.outcome === "duplicate") {
    return NextResponse.json({ accepted: true, duplicate: true, event_id: payload.event_id }, { status: 200 });
  }

  if (!companyId) {
    await markEventStatus(adminDb, insertResult.id, "ignored", "client_external_id não vinculado a nenhuma Company");
    return NextResponse.json({ accepted: true, event_id: payload.event_id, status: "ignored", reason: "client_external_id_not_linked" }, { status: 422 });
  }

  // ── Roteamento ──────────────────────────────────────────────────
  try {
    await markEventStatus(adminDb, insertResult.id, "processing");
    const routeResult = await routeIntegrationEvent(adminDb, payload, companyId);
    await markEventStatus(adminDb, insertResult.id, "processed");
    return NextResponse.json({ accepted: true, event_id: payload.event_id, status: "processed", policy: routeResult.policy }, { status: 202 });
  } catch (err) {
    await markEventStatus(adminDb, insertResult.id, "failed", err instanceof Error ? err.message : "erro desconhecido");
    console.error("[integrations/events] falha inesperada ao rotear evento", { eventId: payload.event_id, message: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json({ accepted: false, error: "Não foi possível processar o evento agora." }, { status: 500 });
  }
});

type ValidationResult =
  | { ok: true; payload: IntegrationEventPayload }
  | { ok: false; error: string };

const MAX_TEXT_LEN = 4000;

function validatePayload(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "payload inválido" };
  const b = raw as Record<string, unknown>;
  if (typeof b.event_id !== "string" || !b.event_id.trim()) return { ok: false, error: "event_id obrigatório" };
  if (!isIntegrationEventType(b.event_type)) return { ok: false, error: "event_type inválido" };
  if (typeof b.occurred_at !== "string" || Number.isNaN(Date.parse(b.occurred_at))) return { ok: false, error: "occurred_at inválido" };
  if (typeof b.source_system !== "string" || !b.source_system.trim()) return { ok: false, error: "source_system obrigatório" };
  if (typeof b.client_external_id !== "string" || !b.client_external_id.trim()) return { ok: false, error: "client_external_id obrigatório" };
  if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 200) return { ok: false, error: "title obrigatório (até 200 caracteres)" };
  if (b.description !== undefined && (typeof b.description !== "string" || b.description.length > MAX_TEXT_LEN)) return { ok: false, error: "description inválida" };
  if (b.priority !== undefined && !["low", "normal", "high", "urgent"].includes(b.priority as string)) return { ok: false, error: "priority inválida" };

  return {
    ok: true,
    payload: {
      event_id: b.event_id.trim(),
      event_type: b.event_type,
      occurred_at: b.occurred_at,
      source_system: b.source_system.trim(),
      client_external_id: b.client_external_id.trim(),
      project_external_id: typeof b.project_external_id === "string" ? b.project_external_id : undefined,
      entity_type: typeof b.entity_type === "string" ? b.entity_type : undefined,
      entity_id: typeof b.entity_id === "string" ? b.entity_id : undefined,
      title: b.title.trim(),
      description: typeof b.description === "string" ? b.description : undefined,
      priority: b.priority as IntegrationEventPayload["priority"],
      requested_by: typeof b.requested_by === "string" ? b.requested_by : undefined,
      metadata: b.metadata && typeof b.metadata === "object" ? (b.metadata as Record<string, unknown>) : undefined,
      source_reference: typeof b.source_reference === "string" ? b.source_reference : undefined,
    },
  };
}

/** Nunca grava o payload bruto completo na auditoria -- só os campos já validados acima (nunca um metadata arbitrário gigante/com dado sensível vindo de fora). */
function sanitizeForAudit(payload: IntegrationEventPayload): Record<string, unknown> {
  return {
    event_type: payload.event_type, occurred_at: payload.occurred_at, title: payload.title,
    priority: payload.priority ?? null, metadata: payload.metadata ?? null,
  };
}
