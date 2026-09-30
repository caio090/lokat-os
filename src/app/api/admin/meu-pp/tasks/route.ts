import type { NextRequest } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { dateKey, dbFail, done, fail, personalSession, readBody, text, uuid, type PersonalSession } from "@/lib/meu-pp/server";
import { MAX_PRIORITIES, localInstant } from "@/lib/meu-pp/domain";

/** Meu PP — tarefas pessoais e prioridades do dia (focus_date). Só sessão do dono. */

async function focusCount(s: PersonalSession, day: string) {
  const { count } = await s.supabase.from("personal_tasks").select("id", { count: "exact", head: true }).eq("user_id", s.userId).eq("focus_date", day);
  return count ?? 0;
}

export const POST = withMutationProtection(async function POST(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  const title = text(body?.title, 300);
  if (!title) return fail("invalid", 400, "Escreva a tarefa.");
  const focusDay = body?.focus ? dateKey(body?.date) : null;
  if (body?.focus && !focusDay) return fail("invalid", 400);
  let sortOrder = 0;
  if (focusDay) {
    const n = await focusCount(s, focusDay);
    if (n >= MAX_PRIORITIES) return fail("limit", 409, `Já existem ${MAX_PRIORITIES} prioridades hoje.`);
    sortOrder = n + 1;
  }
  const due = dateKey(body?.dueDate);
  const priority = body?.priority === "high" || body?.priority === "medium" || body?.priority === "low" ? body.priority : null;
  const { data, error } = await s.supabase
    .from("personal_tasks")
    .insert({ user_id: s.userId, title, priority, due_at: due ? localInstant(due, "12:00") : null, focus_date: focusDay, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) return dbFail(error);
  return done({ id: data.id });
});

export const PATCH = withMutationProtection(async function PATCH(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  const action = body?.action;
  const own = () => s.supabase.from("personal_tasks");

  if (action === "reorder") {
    const day = dateKey(body?.date);
    const ids = Array.isArray(body?.ids) ? (body!.ids as unknown[]).map(uuid) : [];
    if (!day || ids.length === 0 || ids.length > MAX_PRIORITIES || ids.some((i) => !i)) return fail("invalid", 400);
    for (const [i, id] of ids.entries()) {
      const { error } = await own().update({ sort_order: i + 1 }).eq("id", id!).eq("user_id", s.userId).eq("focus_date", day);
      if (error) return dbFail(error);
    }
    return done();
  }

  const id = uuid(body?.id);
  if (!id) return fail("invalid", 400);
  let patch: Record<string, unknown>;
  if (action === "complete") patch = { status: "done", completed_at: new Date().toISOString() };
  else if (action === "reopen") patch = { status: "pending", completed_at: null };
  else if (action === "unfocus") patch = { focus_date: null };
  else if (action === "focus") {
    const day = dateKey(body?.date);
    if (!day) return fail("invalid", 400);
    const n = await focusCount(s, day);
    if (n >= MAX_PRIORITIES) return fail("limit", 409, `Já existem ${MAX_PRIORITIES} prioridades hoje.`);
    patch = { focus_date: day, sort_order: n + 1 };
  } else return fail("invalid", 400);

  const { data, error } = await own().update(patch).eq("id", id).eq("user_id", s.userId).select("id");
  if (error) return dbFail(error);
  if (!data?.length) return fail("not_found", 404);
  return done();
});
