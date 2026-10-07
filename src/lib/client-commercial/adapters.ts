/**
 * Retomada do produto — reunião/proposta para uma Company já fechada.
 * DB MIGRATION PENDING: depende de commercial_meetings.client_id /
 * commercial_proposals.client_id (SQL 99). Até a migration ser
 * aplicada, toda leitura/escrita aqui degrada honestamente para
 * unavailable/schema_not_applied (42703 "column does not exist"),
 * nunca finge que a reunião/proposta foi salva.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientCommercialFetchReason, ClientCommercialFetchResult, ClientCommercialWriteResult, ClientMeeting, ClientProposal,
} from "./types";
import { logClientActivity } from "@/lib/client-timeline/adapters";

function classifyError(table: string, err: unknown): ClientCommercialFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || code === "42703" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[client-commercial] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

export async function getClientMeetings(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<ClientCommercialFetchResult<ClientMeeting[]>> {
  try {
    const { data, error } = await adminDb
      .from("commercial_meetings")
      // FASE 1C: onboarding_id/is_alignment_meeting (SQL 101) somados a
      // client_id (SQL 99) -- ambas pendentes hoje, então esta query já
      // falha honestamente (42703) enquanto qualquer uma faltar.
      .select("id, client_id, title, description, scheduled_at, duration_min, meet_link, status, notes, created_at, onboarding_id, is_alignment_meeting")
      .eq("client_id", companyId)
      .order("scheduled_at", { ascending: false });
    if (error) return { status: "unavailable", reason: classifyError("commercial_meetings", error) };
    return {
      status: "available",
      data: (data ?? []).map((r) => ({
        id: r.id, companyId: r.client_id, title: r.title, description: r.description,
        scheduledAt: r.scheduled_at, durationMin: r.duration_min, meetLink: r.meet_link,
        status: r.status, notes: r.notes, createdAt: r.created_at,
        onboardingId: r.onboarding_id, isAlignmentMeeting: r.is_alignment_meeting,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("commercial_meetings", err) };
  }
}

export async function createClientMeeting(
  adminDb: SupabaseClient,
  companyId: string,
  createdBy: string | null,
  input: { title: string; scheduledAt: string; description?: string | null; durationMin?: number; meetLink?: string | null; onboardingId?: string | null; isAlignmentMeeting?: boolean },
): Promise<ClientCommercialWriteResult> {
  if (!input.title.trim() || !input.scheduledAt) return { ok: false, reason: "validation_error" };
  try {
    const { data, error } = await adminDb
      .from("commercial_meetings")
      .insert({
        client_id: companyId, created_by: createdBy, title: input.title.trim(),
        description: input.description ?? null, scheduled_at: input.scheduledAt,
        duration_min: input.durationMin ?? 30, meet_link: input.meetLink ?? null, status: "agendada",
        // FASE 1C (seção 7) -- onboardingId/isAlignmentMeeting ligam esta
        // MESMA reunião ao marco de onboarding, nunca um sistema paralelo.
        onboarding_id: input.onboardingId ?? null, is_alignment_meeting: input.isAlignmentMeeting ?? false,
      })
      .select("id")
      .single();
    if (error) return { ok: false, reason: classifyError("commercial_meetings", error) };
    // FASE 1C, seção 20 -- a reunião de alinhamento é um marco de onboarding, nunca um clique qualquer.
    if (input.isAlignmentMeeting && input.onboardingId) {
      await logClientActivity(adminDb, companyId, "onboarding_reuniao_alinhamento_agendada", "client_onboarding", input.onboardingId, { meetingId: data.id, scheduledAt: input.scheduledAt });
    }
    return { ok: true, id: data.id as string };
  } catch (err) {
    return { ok: false, reason: classifyError("commercial_meetings", err) };
  }
}

export async function getClientProposals(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<ClientCommercialFetchResult<ClientProposal[]>> {
  try {
    const { data, error } = await adminDb
      .from("commercial_proposals")
      .select("id, client_id, title, value, recurrence, services, status, valid_until, created_at")
      .eq("client_id", companyId)
      .order("created_at", { ascending: false });
    if (error) return { status: "unavailable", reason: classifyError("commercial_proposals", error) };
    return {
      status: "available",
      data: (data ?? []).map((r) => ({
        id: r.id, companyId: r.client_id, title: r.title, value: r.value, recurrence: r.recurrence,
        services: (r.services as string[] | null) ?? [], status: r.status, validUntil: r.valid_until, createdAt: r.created_at,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("commercial_proposals", err) };
  }
}

export async function createClientProposal(
  adminDb: SupabaseClient,
  companyId: string,
  createdBy: string | null,
  input: { title: string; value?: number | null; services?: string[]; recurrence?: string | null; validUntil?: string | null },
): Promise<ClientCommercialWriteResult> {
  if (!input.title.trim()) return { ok: false, reason: "validation_error" };
  try {
    const { data, error } = await adminDb
      .from("commercial_proposals")
      .insert({
        client_id: companyId, created_by: createdBy, title: input.title.trim(),
        value: input.value ?? null, services: input.services ?? [],
        recurrence: input.recurrence ?? null, valid_until: input.validUntil ?? null, status: "rascunho",
      })
      .select("id")
      .single();
    if (error) return { ok: false, reason: classifyError("commercial_proposals", error) };
    return { ok: true, id: data.id as string };
  } catch (err) {
    return { ok: false, reason: classifyError("commercial_proposals", err) };
  }
}
