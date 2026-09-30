import type { NextRequest } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { dateKey, dbFail, done, fail, personalSession, readBody, text, time, uuid } from "@/lib/meu-pp/server";
import { localInstant } from "@/lib/meu-pp/domain";

/** Meu PP — agenda pessoal (personal_events). Nunca o calendário Company. */
const EVENT_TYPES = new Set(["compromisso", "estudo", "gravacao", "reuniao", "outro"]);

export const POST = withMutationProtection(async function POST(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  const title = text(body?.title, 200);
  const day = dateKey(body?.date);
  const at = time(body?.time);
  if (!title || !day) return fail("invalid", 400, "Informe o título e o dia.");
  const type = typeof body?.type === "string" && EVENT_TYPES.has(body.type) ? body.type : "outro";
  const { data, error } = await s.supabase
    .from("personal_events")
    .insert({ user_id: s.userId, title, starts_at: localInstant(day, at ?? "00:00"), all_day: !at, type, location: text(body?.location, 200) })
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
  const status = body?.status === "completed" || body?.status === "cancelled" || body?.status === "scheduled" ? body.status : null;
  if (!id || !status) return fail("invalid", 400);
  const { data, error } = await s.supabase.from("personal_events").update({ status }).eq("id", id).eq("user_id", s.userId).select("id");
  if (error) return dbFail(error);
  if (!data?.length) return fail("not_found", 404);
  return done();
});
