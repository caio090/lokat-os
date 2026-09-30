import type { NextRequest } from "next/server";
import { dbFail, done, fail, personalSession } from "@/lib/meu-pp/server";

/**
 * Meu PP — histórico simples, carregado SOB DEMANDA (nunca na abertura de HOJE):
 * reflexos recentes e decisões recentes com o elo "eu pensava → agora penso".
 * Não é o Mapa Vivo (Fase 4) nem busca global.
 */
export async function GET(req: NextRequest) {
  const s = await personalSession();
  if (!("userId" in s)) return s;
  const kind = new URL(req.url).searchParams.get("kind");

  if (kind === "reflections") {
    const { data, error } = await s.supabase
      .from("personal_reflections")
      .select("id,reflection_date,text,what_changed,learning,open_loops,next_action,changed_mind")
      .eq("user_id", s.userId)
      .eq("kind", "daily")
      .order("reflection_date", { ascending: false })
      .limit(14);
    if (error) return dbFail(error);
    return done({ reflections: data ?? [] });
  }

  if (kind === "decisions") {
    const { data, error } = await s.supabase
      .from("personal_decisions")
      .select("id,title,decision,rationale,review_trigger,review_at,decided_on,status,supersedes_decision_id")
      .eq("user_id", s.userId)
      .order("decided_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return dbFail(error);
    const list = data ?? [];
    const known = new Map(list.map((d) => [d.id as string, d]));
    const missing = [...new Set(list.map((d) => d.supersedes_decision_id as string | null).filter((x): x is string => !!x && !known.has(x)))];
    if (missing.length) {
      const { data: older } = await s.supabase.from("personal_decisions").select("id,title,decision,decided_on").eq("user_id", s.userId).in("id", missing);
      for (const d of older ?? []) known.set(d.id as string, d as (typeof list)[number]);
    }
    const decisions = list.map((d) => {
      const prev = d.supersedes_decision_id ? known.get(d.supersedes_decision_id as string) : null;
      return { ...d, previous: prev ? { id: prev.id, title: prev.title, decision: prev.decision, decided_on: prev.decided_on } : null };
    });
    return done({ decisions });
  }
  return fail("invalid", 400);
}
