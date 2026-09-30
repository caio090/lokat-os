import type { NextRequest } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { dateKey, dbFail, done, fail, personalSession, readBody, text, uuid } from "@/lib/meu-pp/server";
import { todayKey } from "@/lib/meu-pp/domain";

/**
 * Meu PP — Decision Ledger. Decisão é histórica: mudar de posição =
 * personal_supersede_decision (nova decisão; a anterior fica "superseded").
 * Revisar sem mudar = só review_at/last_reviewed_at. Nada é sobrescrito.
 */
function fields(b: Record<string, unknown>) {
  return {
    title: text(b.title, 200),
    decision: text(b.decision, 4000),
    context: text(b.context, 4000),
    rationale: text(b.rationale, 4000),
    alternatives: text(b.alternatives, 4000),
    assumptions: text(b.assumptions, 4000),
    accepted_risks: text(b.acceptedRisks, 4000),
    review_trigger: text(b.reviewTrigger, 2000),
    review_at: dateKey(b.reviewAt),
  };
}

export const POST = withMutationProtection(async function POST(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  if (!body) return fail("invalid", 400);
  const f = fields(body);
  if (!f.decision) return fail("invalid", 400, "Escreva o que você decidiu.");
  const today = todayKey();

  if (body.mode === "supersede") {
    const oldId = uuid(body.oldId);
    if (!oldId) return fail("invalid", 400);
    const { data, error } = await s.supabase.rpc("personal_supersede_decision", { p_old_id: oldId, p_payload: { ...f, date: today } });
    if (error) return dbFail(error);
    return done({ id: data });
  }

  const { data, error } = await s.supabase
    .from("personal_decisions")
    .insert({ user_id: s.userId, ...f, title: f.title ?? f.decision.slice(0, 200), decided_on: today })
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
  if (!id || body?.action !== "reviewed") return fail("invalid", 400);
  const { data, error } = await s.supabase
    .from("personal_decisions")
    .update({ review_at: dateKey(body?.nextReviewAt), last_reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", s.userId)
    .eq("status", "active")
    .select("id");
  if (error) return dbFail(error);
  return data?.length ? done() : fail("not_found", 404);
});
