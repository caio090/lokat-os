/**
 * FASE 1B — resolve um client_external_id (estável no sistema externo,
 * ex.: "tayannara-carvalho") para o client_id interno do LOKAT OS, via
 * client_external_links (SQL 100, DB MIGRATION PENDING). O sistema
 * externo NUNCA precisa conhecer o UUID interno.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationEventFetchReason, IntegrationEventFetchResult } from "./types";

function classifyError(table: string, err: unknown): IntegrationEventFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[integration-events] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

/** null,null = link não encontrado (estado válido, nunca um erro) -- a rota decide o que fazer (ex.: CLIENT_PENDING_CREATED). */
export async function resolveClientExternalId(
  adminDb: SupabaseClient,
  sourceSystem: string,
  externalId: string,
): Promise<IntegrationEventFetchResult<{ clientId: string } | null>> {
  try {
    const { data, error } = await adminDb
      .from("client_external_links")
      .select("client_id")
      .eq("source_system", sourceSystem)
      .eq("external_id", externalId)
      .eq("status", "active")
      .maybeSingle();
    if (error) return { status: "unavailable", reason: classifyError("client_external_links", error) };
    return { status: "available", data: data ? { clientId: data.client_id as string } : null };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("client_external_links", err) };
  }
}

export type LinkWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: IntegrationEventFetchReason | "validation_error" };

/** Admin vincula manualmente um external_id a um client_id já existente (ex.: configurar a Tayannara depois do cadastro real). */
export async function createClientExternalLink(
  adminDb: SupabaseClient,
  clientId: string,
  sourceSystem: string,
  externalId: string,
): Promise<LinkWriteResult> {
  if (!sourceSystem.trim() || !externalId.trim()) return { ok: false, reason: "validation_error" };
  try {
    const { data, error } = await adminDb
      .from("client_external_links")
      .insert({ client_id: clientId, source_system: sourceSystem.trim(), external_id: externalId.trim() })
      .select("id")
      .single();
    if (error) return { ok: false, reason: classifyError("client_external_links", error) };
    return { ok: true, id: data.id as string };
  } catch (err) {
    return { ok: false, reason: classifyError("client_external_links", err) };
  }
}
