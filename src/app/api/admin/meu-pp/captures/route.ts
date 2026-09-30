import type { NextRequest } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { dateKey, dbFail, done, fail, personalSession, readBody, text, time, uuid } from "@/lib/meu-pp/server";
import { CAPTURE_TYPES, localInstant, todayKey, type CaptureType } from "@/lib/meu-pp/domain";
import { REL } from "@/lib/meu-pp/entity-links";

/**
 * Meu PP — captura. Só grava na CONFIRMAÇÃO do dono (o tipo sugerido nunca é
 * gravado sozinho). Confirmar = personal_confirm_capture (uma transação:
 * objeto + captura + link derived_from). Notas ficam na caixa (inbox).
 */
const isType = (v: unknown): v is CaptureType => typeof v === "string" && (CAPTURE_TYPES as readonly string[]).includes(v);

export const POST = withMutationProtection(async function POST(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  const raw = text(body?.text, 4000);
  const confirmed = body?.confirmedType;
  const suggested = isType(body?.suggestedType) ? body!.suggestedType : null;
  if (!raw || !isType(confirmed)) return fail("invalid", 400);
  const p = (body?.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>;
  const today = todayKey();
  let payload: Record<string, unknown> = {};

  if (confirmed === "task") {
    const due = dateKey(p.dueDate);
    payload = { title: text(p.title, 300), due_at: due ? localInstant(due, "12:00") : null, focus_date: p.focusToday === true ? today : null };
    if (p.focusToday === true) {
      const { count } = await s.supabase.from("personal_tasks").select("id", { count: "exact", head: true }).eq("user_id", s.userId).eq("focus_date", today);
      if ((count ?? 0) >= 3) payload.focus_date = null;
    }
  } else if (confirmed === "decision") {
    payload = { title: text(p.title, 200), decision: text(p.decision, 4000), rationale: text(p.rationale, 4000), review_trigger: text(p.reviewTrigger, 2000), review_at: dateKey(p.reviewAt), date: today };
  } else if (confirmed === "reflection") {
    payload = { date: today };
  } else if (confirmed === "event") {
    const day = dateKey(p.date) ?? today;
    const at = time(p.time);
    payload = { title: text(p.title, 200), starts_at: localInstant(day, at ?? "00:00"), all_day: !at, event_type: "outro" };
  }

  const { data, error } = await s.supabase.rpc("personal_confirm_capture", {
    p_raw_text: raw,
    p_source: body?.source === "voice" ? "voice" : "text",
    p_suggested_type: suggested,
    p_confirmed_type: confirmed,
    p_payload: payload,
  });
  if (error) return dbFail(error);
  return done({ result: data });
});

/** Caixa de notas: descartar (mantida como dismissed) ou converter em tarefa. */
export const PATCH = withMutationProtection(async function PATCH(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  const id = uuid(body?.id);
  if (!id) return fail("invalid", 400);
  const now = new Date().toISOString();

  if (body?.action === "dismiss") {
    const { data, error } = await s.supabase.from("personal_quick_captures").update({ status: "dismissed", processed_at: now }).eq("id", id).eq("user_id", s.userId).eq("status", "inbox").select("id");
    if (error) return dbFail(error);
    return data?.length ? done() : fail("not_found", 404);
  }

  if (body?.action === "to_task") {
    const { data: cap, error: capErr } = await s.supabase.from("personal_quick_captures").select("id,raw_text").eq("id", id).eq("user_id", s.userId).eq("status", "inbox").maybeSingle();
    if (capErr) return dbFail(capErr);
    if (!cap) return fail("not_found", 404);
    const title = text(body?.title, 300) ?? (cap.raw_text as string).slice(0, 300);
    const { data: task, error: taskErr } = await s.supabase.from("personal_tasks").insert({ user_id: s.userId, title }).select("id").single();
    if (taskErr) return dbFail(taskErr);
    const { error: upErr } = await s.supabase.from("personal_quick_captures").update({ status: "confirmed", confirmed_type: "task", processed_at: now }).eq("id", id).eq("user_id", s.userId);
    if (upErr) {
      await s.supabase.from("personal_tasks").delete().eq("id", task.id).eq("user_id", s.userId); // desfaz para não deixar tarefa solta
      return dbFail(upErr);
    }
    await s.supabase.from("personal_entity_links").insert({ user_id: s.userId, source_type: "task", source_id: task.id, target_type: "capture", target_id: id, relation_type: REL.derivedFrom });
    return done({ id: task.id });
  }
  return fail("invalid", 400);
});
