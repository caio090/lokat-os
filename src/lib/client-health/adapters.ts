/**
 * FASE 1C — agregação de relacionamento (seção 15/16). Cada métrica é
 * best-effort e independente: se uma fonte ainda não existir (ex.:
 * commercial_meetings.client_id, SQL 99 pendente), essa métrica
 * específica fica null/0 -- nunca derruba o snapshot inteiro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientHealthFetchResult, ClientHealthSnapshot } from "./types";
import { OPPORTUNITY_REQUEST_TYPE } from "@/lib/client-opportunities/types";

const OPEN_OPPORTUNITY_STATUSES = ["open", "in_review", "in_progress", "waiting_client"];

export async function getClientHealthSnapshot(adminDb: SupabaseClient, companyId: string): Promise<ClientHealthFetchResult> {
  let lastMeetingAt: string | null = null;
  let nextMeetingAt: string | null = null;
  let nextMeetingTitle: string | null = null;
  try {
    const nowIso = new Date().toISOString();
    const [{ data: lastMeeting }, { data: nextMeeting }] = await Promise.all([
      adminDb.from("commercial_meetings").select("scheduled_at").eq("client_id", companyId).lt("scheduled_at", nowIso).order("scheduled_at", { ascending: false }).limit(1).maybeSingle(),
      adminDb.from("commercial_meetings").select("title, scheduled_at").eq("client_id", companyId).gte("scheduled_at", nowIso).order("scheduled_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    if (lastMeeting) lastMeetingAt = lastMeeting.scheduled_at as string;
    if (nextMeeting) { nextMeetingAt = nextMeeting.scheduled_at as string; nextMeetingTitle = nextMeeting.title as string; }
  } catch {
    // commercial_meetings.client_id (SQL 99) pode não existir ainda -- best-effort, nunca derruba o snapshot inteiro.
  }

  let lastContactAt: string | null = null;
  try {
    const { data } = await adminDb.from("activity_logs").select("created_at").eq("client_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) lastContactAt = data.created_at as string;
  } catch {
    // best-effort.
  }

  let openOpportunitiesCount = 0;
  try {
    const { count } = await adminDb.from("client_requests").select("id", { count: "exact", head: true }).eq("client_id", companyId).eq("request_type", OPPORTUNITY_REQUEST_TYPE).in("status", OPEN_OPPORTUNITY_STATUSES);
    openOpportunitiesCount = count ?? 0;
  } catch {
    // best-effort.
  }

  let pendingApprovalsCount = 0;
  try {
    const { count } = await adminDb.from("approvals").select("id", { count: "exact", head: true }).eq("client_id", companyId).eq("status", "aguardando");
    pendingApprovalsCount = count ?? 0;
  } catch {
    // best-effort.
  }

  const snapshot: ClientHealthSnapshot = { lastContactAt, lastMeetingAt, nextMeetingAt, nextMeetingTitle, openOpportunitiesCount, pendingApprovalsCount };
  return { status: "available", data: snapshot };
}
