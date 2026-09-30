import type { NextRequest } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { dbFail, done, fail, personalSession, readBody, text, uuid } from "@/lib/meu-pp/server";
import { todayKey } from "@/lib/meu-pp/domain";
import { REL } from "@/lib/meu-pp/entity-links";

/**
 * Meu PP — fechamento do dia: reflexo diário (personal_reflections, um por
 * dia) + gratidão opcional (gratitude_entries, sem duplicar campos) +
 * relações escolhidas pelo dono (nunca inferidas): reflexão → decisões do
 * dia (related_to) e reflexão → decisão sobre a qual mudou de ideia (changed).
 */
const LINK_CONFLICT = "user_id,source_type,source_id,target_type,target_id,relation_type";

export const PUT = withMutationProtection(async function PUT(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const body = await readBody(req);
  if (!body) return fail("invalid", 400);
  const day = todayKey(); // o fechamento é sempre do dia corrente em America/Fortaleza
  const r = (body.reflection && typeof body.reflection === "object" ? body.reflection : {}) as Record<string, unknown>;
  const g = (body.gratitude && typeof body.gratitude === "object" ? body.gratitude : {}) as Record<string, unknown>;
  const reflection = {
    text: text(r.text, 8000),
    what_changed: text(r.whatChanged, 4000),
    learning: text(r.learning, 4000),
    open_loops: text(r.openLoops, 4000),
    next_action: text(r.nextAction, 4000),
    changed_mind: text(r.changedMind, 4000),
  };
  const gratitude = { gratitude_1: text(g.g1, 500), gratitude_2: text(g.g2, 500), gratitude_3: text(g.g3, 500), best_moment: text(g.best, 1000), learning: text(g.learning, 1000) };
  const hasReflection = Object.values(reflection).some(Boolean);
  const hasGratitude = Object.values(gratitude).some(Boolean);
  if (!hasReflection && !hasGratitude) return fail("invalid", 400, "Escreva pelo menos uma linha.");

  let reflectionId: string | null = null;
  if (hasReflection) {
    const { data: existing, error: selErr } = await s.supabase.from("personal_reflections").select("id").eq("user_id", s.userId).eq("kind", "daily").eq("reflection_date", day).maybeSingle();
    if (selErr) return dbFail(selErr);
    if (existing) {
      const { error } = await s.supabase.from("personal_reflections").update(reflection).eq("id", existing.id).eq("user_id", s.userId);
      if (error) return dbFail(error);
      reflectionId = existing.id as string;
    } else {
      const { data, error } = await s.supabase.from("personal_reflections").insert({ user_id: s.userId, reflection_date: day, kind: "daily", ...reflection }).select("id").single();
      if (error) return dbFail(error);
      reflectionId = data.id as string;
    }
  }

  if (hasGratitude) {
    const { error } = await s.supabase.from("gratitude_entries").upsert({ user_id: s.userId, entry_date: day, ...gratitude }, { onConflict: "user_id,entry_date" });
    if (error) return dbFail(error);
  }

  if (reflectionId) {
    const related = Array.isArray(body.relatedDecisionIds) ? (body.relatedDecisionIds as unknown[]).map(uuid).filter((x): x is string => !!x).slice(0, 10) : [];
    const changed = uuid(body.changedDecisionId);
    const ids = [...new Set([...related, ...(changed ? [changed] : [])])];
    if (ids.length) {
      // só decisões do próprio dono (sessão + RLS)
      const { data: own } = await s.supabase.from("personal_decisions").select("id").eq("user_id", s.userId).in("id", ids);
      const ownIds = new Set((own ?? []).map((d) => d.id as string));
      const rows = [
        ...related.filter((d) => ownIds.has(d)).map((d) => ({ user_id: s.userId, source_type: "reflection", source_id: reflectionId, target_type: "decision", target_id: d, relation_type: REL.relatedTo })),
        ...(changed && ownIds.has(changed) ? [{ user_id: s.userId, source_type: "reflection", source_id: reflectionId, target_type: "decision", target_id: changed, relation_type: REL.changed }] : []),
      ];
      if (rows.length) {
        const { error } = await s.supabase.from("personal_entity_links").upsert(rows, { onConflict: LINK_CONFLICT, ignoreDuplicates: true });
        if (error) return dbFail(error);
      }
    }
  }
  return done({ reflectionId });
});
