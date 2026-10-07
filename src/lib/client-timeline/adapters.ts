/**
 * Retomada do produto, seção 32 — leitura real de activity_logs
 * (tabela já existe em produção, nenhuma migration necessária). Fecha
 * o gap confirmado pela auditoria: a tabela só era escrita, nunca lida.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientTimelineEntry, TimelineFetchReason, TimelineFetchResult } from "./types";

function classifyError(table: string, err: unknown): TimelineFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[client-timeline] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

const MAX_TIMELINE_ENTRIES = 50;

/**
 * FASE 1B — escrita de activity_logs a partir de um evento de
 * integração processado. Mesmo padrão de escrita já usado em
 * src/app/onboarding/conclusao/page.tsx e no portal do cliente (ver
 * auditoria): fire-and-forget, nunca derruba o fluxo principal se a
 * própria tabela de log falhar. `metadata` nunca carrega payload bruto
 * do sistema externo (seção 9: "evitar informações técnicas
 * desnecessárias na timeline visual") -- só o que a UI de fato mostra.
 */
export async function logClientActivity(
  adminDb: SupabaseClient,
  companyId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await adminDb.from("activity_logs").insert({
      client_id: companyId, action, entity_type: entityType, entity_id: entityId, metadata,
    });
  } catch (err) {
    console.error("[client-timeline] falha ao registrar atividade (best-effort, nunca derruba o fluxo principal)", { companyId, action, error: err instanceof Error ? err.message : err });
  }
}

export async function getClientTimeline(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<TimelineFetchResult<ClientTimelineEntry[]>> {
  try {
    const { data, error } = await adminDb
      .from("activity_logs")
      .select("id, user_id, client_id, action, entity_type, entity_id, metadata, created_at")
      .eq("client_id", companyId)
      .order("created_at", { ascending: false })
      .limit(MAX_TIMELINE_ENTRIES);
    if (error) return { status: "unavailable", reason: classifyError("activity_logs", error) };
    return {
      status: "available",
      data: (data ?? []).map((r) => ({
        id: r.id, companyId: r.client_id, userId: r.user_id, action: r.action,
        entityType: r.entity_type, entityId: r.entity_id,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null, createdAt: r.created_at,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("activity_logs", err) };
  }
}
