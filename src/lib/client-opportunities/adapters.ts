/**
 * Retomada do produto, seção 18 — Oportunidade Comercial sobre
 * client_requests (tabela já existe em produção, já aceita
 * request_type/source livres -- confirmado via schema antes de
 * escrever este arquivo, nenhuma migration necessária).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPPORTUNITY_REQUEST_TYPE } from "./types";
import type {
  ClientOpportunity, OpportunityFetchReason, OpportunityFetchResult, OpportunityOrigin, OpportunityPriority, OpportunityWriteResult,
} from "./types";

function classifyError(table: string, err: unknown): OpportunityFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[client-opportunities] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

export async function getClientOpportunities(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<OpportunityFetchResult<ClientOpportunity[]>> {
  try {
    const { data, error } = await adminDb
      .from("client_requests")
      .select("id, client_id, title, description, status, priority, source, created_at, updated_at")
      .eq("client_id", companyId)
      .eq("request_type", OPPORTUNITY_REQUEST_TYPE)
      .order("created_at", { ascending: false });
    if (error) return { status: "unavailable", reason: classifyError("client_requests", error) };
    return {
      status: "available",
      data: (data ?? []).map((r) => ({
        id: r.id, companyId: r.client_id, title: r.title, description: r.description,
        status: r.status, priority: r.priority, origin: r.source, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("client_requests", err) };
  }
}

export async function createClientOpportunity(
  adminDb: SupabaseClient,
  companyId: string,
  ownerProfileId: string | null,
  input: { title: string; description?: string | null; origin?: OpportunityOrigin; priority?: OpportunityPriority },
): Promise<OpportunityWriteResult> {
  if (!input.title.trim()) return { ok: false, reason: "validation_error" };
  try {
    const { data, error } = await adminDb
      .from("client_requests")
      .insert({
        client_id: companyId,
        owner_profile_id: ownerProfileId,
        title: input.title.trim(),
        description: input.description ?? null,
        priority: input.priority ?? "normal",
        request_type: OPPORTUNITY_REQUEST_TYPE,
        source: input.origin ?? "manual",
      })
      .select("id")
      .single();
    if (error) return { ok: false, reason: classifyError("client_requests", error) };
    return { ok: true, id: data.id as string };
  } catch (err) {
    return { ok: false, reason: classifyError("client_requests", err) };
  }
}
