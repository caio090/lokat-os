import type { NextRequest } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { dateKey, dbFail, done, fail, personalSession, readBody, text, time, uuid } from "@/lib/meu-pp/server";

/**
 * Meu PP — rotinas pessoais. Registro do dia segue o schema real:
 * done | postponed; "não feito" = sem registro (clear apaga o do dia).
 * Sem streak, sem pontuação.
 */
export const POST = withMutationProtection(async function POST(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  const name = text(body?.name, 120);
  if (!name) return fail("invalid", 400, "Dê um nome à rotina.");
  const days = Array.isArray(body?.days) ? [...new Set((body!.days as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort() : [];
  const frequency = body?.frequency === "specific_days" && days.length ? "specific_days" : "daily";
  const { data, error } = await s.supabase
    .from("personal_routines")
    .insert({ user_id: s.userId, name, frequency_type: frequency, days_of_week: frequency === "daily" ? null : days, preferred_time: time(body?.time) })
    .select("id")
    .single();
  if (error) return dbFail(error);
  return done({ id: data.id });
});

export const PATCH = withMutationProtection(async function PATCH(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  const id = uuid(body?.id);
  if (!id) return fail("invalid", 400);

  if (body?.action === "archive") {
    const { data, error } = await s.supabase.from("personal_routines").update({ active: false }).eq("id", id).eq("user_id", s.userId).select("id");
    if (error) return dbFail(error);
    return data?.length ? done() : fail("not_found", 404);
  }

  const day = dateKey(body?.date);
  const entry = body?.entry;
  if (!day || (entry !== "done" && entry !== "postponed" && entry !== "clear")) return fail("invalid", 400);
  if (entry === "clear") {
    const { error } = await s.supabase.from("personal_routine_entries").delete().eq("routine_id", id).eq("user_id", s.userId).eq("entry_date", day);
    return error ? dbFail(error) : done();
  }
  const { error } = await s.supabase
    .from("personal_routine_entries")
    .upsert(
      { routine_id: id, user_id: s.userId, entry_date: day, status: entry, completed_at: entry === "done" ? new Date().toISOString() : null },
      { onConflict: "routine_id,entry_date" },
    );
  return error ? dbFail(error) : done();
});
