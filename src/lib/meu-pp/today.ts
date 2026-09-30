/**
 * Meu PP — HOJE (agregador de leitura; NÃO é fonte da verdade, não grava nada).
 *
 * Busca só o que o dia precisa, com filtros por data/status e limites:
 * prioridades do dia, sugestões, agenda de hoje, rotinas aplicáveis + registro
 * de hoje, até 3 decisões para revisar, projeto em foco, notas na caixa,
 * reflexo/gratidão de hoje e o sinal de "primeiro uso". Nada de histórico
 * inteiro (o histórico é carregado sob demanda em /api/admin/meu-pp/history).
 *
 * REGRAS (testadas em src/lib/meu-pp/__tests__/meu-pp-foundation.structural.test.ts):
 * - SEMPRE a sessão autenticada do próprio usuário; nunca service role/admin.
 * - Nunca Company context, `?client=`, activity_logs, productivity_*, finance_* ou billing_*.
 * - Filtro explícito por user_id além do RLS (defesa em profundidade).
 * - Projeto em foco: lido de client_projects COM A SESSÃO (RLS Company de
 *   sempre decide o acesso); sem acesso/apagado → "indisponível", sem quebrar.
 */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { MAX_DECISIONS_TO_REVIEW, dayBounds, isRoutineApplicable, orderSuggestions, todayKey, type RoutineShape } from "./domain";

export type TodayTask = { id: string; title: string; status: "pending" | "done"; priority: "high" | "medium" | "low" | null; due_at: string | null; sort_order: number; focus_date: string | null; created_at: string };
export type TodayEvent = { id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean; type: string; status: string; location: string | null };
export type TodayRoutine = { id: string; name: string; preferred_time: string | null; entry: "done" | "postponed" | null };
export type TodayDecision = { id: string; title: string; decision: string; rationale: string | null; review_trigger: string | null; review_at: string | null; decided_on: string };
export type TodayNote = { id: string; raw_text: string; created_at: string };
export type TodayReflection = { text: string | null; what_changed: string | null; learning: string | null; open_loops: string | null; next_action: string | null; changed_mind: string | null; updated_at: string } | null;
export type TodayGratitude = { gratitude_1: string | null; gratitude_2: string | null; gratitude_3: string | null; best_moment: string | null; learning: string | null } | null;
export type FocusProject = { state: "none" } | { state: "available"; id: string; title: string; status: string | null } | { state: "unavailable"; id: string };

export type PersonalTodaySnapshot =
  | {
      status: "ok";
      dateKey: string;
      firstUse: boolean;
      priorities: TodayTask[];
      suggestions: TodayTask[];
      doneToday: number;
      events: TodayEvent[];
      routines: TodayRoutine[];
      decisionsToReview: TodayDecision[];
      activeDecisionsForLinking: { id: string; title: string }[];
      decidedToday: { id: string; title: string }[];
      focusProject: FocusProject;
      notes: TodayNote[];
      notesCount: number;
      reflection: TodayReflection;
      gratitude: TodayGratitude;
    }
  | { status: "unauthenticated" }
  | { status: "unavailable"; dateKey: string };

const TASK_COLS = "id,title,status,priority,due_at,sort_order,focus_date,created_at";

export async function loadPersonalToday(now: Date = new Date()): Promise<PersonalTodaySnapshot> {
  const dateKey = todayKey(now);
  if (!isSupabaseConfigured) return { status: "unavailable", dateKey };
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: "unauthenticated" };
    const uid = user.id;
    const { startIso, endIso } = dayBounds(dateKey);

    const [focusQ, pendingQ, doneQ, eventsQ, routinesQ, entriesQ, reviewQ, activeDecQ, todayDecQ, focusLinkQ, notesQ, reflectionQ, gratitudeQ, anyTaskQ, anyReflQ, anyDecQ] = await Promise.all([
      supabase.from("personal_tasks").select(TASK_COLS).eq("user_id", uid).eq("focus_date", dateKey).order("sort_order", { ascending: true }).order("created_at", { ascending: true }).limit(10),
      supabase.from("personal_tasks").select(TASK_COLS).eq("user_id", uid).eq("status", "pending").order("due_at", { ascending: true, nullsFirst: false }).limit(60),
      supabase.from("personal_tasks").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "done").gte("completed_at", startIso).lt("completed_at", endIso),
      supabase.from("personal_events").select("id,title,starts_at,ends_at,all_day,type,status,location").eq("user_id", uid).neq("status", "cancelled").gte("starts_at", startIso).lt("starts_at", endIso).order("starts_at", { ascending: true }).limit(20),
      supabase.from("personal_routines").select("id,name,frequency_type,days_of_week,day_of_month,preferred_time,active").eq("user_id", uid).eq("active", true).order("preferred_time", { ascending: true, nullsFirst: false }).limit(40),
      supabase.from("personal_routine_entries").select("routine_id,status").eq("user_id", uid).eq("entry_date", dateKey).limit(80),
      supabase.from("personal_decisions").select("id,title,decision,rationale,review_trigger,review_at,decided_on").eq("user_id", uid).eq("status", "active").lte("review_at", dateKey).order("review_at", { ascending: true }).limit(MAX_DECISIONS_TO_REVIEW),
      supabase.from("personal_decisions").select("id,title").eq("user_id", uid).eq("status", "active").order("decided_on", { ascending: false }).limit(20),
      supabase.from("personal_decisions").select("id,title").eq("user_id", uid).eq("decided_on", dateKey).eq("status", "active").limit(10),
      supabase.from("personal_entity_links").select("target_id").eq("user_id", uid).eq("source_type", "operator").eq("source_id", uid).eq("relation_type", "in_focus").eq("target_type", "client_project").order("created_at", { ascending: false }).limit(1),
      supabase.from("personal_quick_captures").select("id,raw_text,created_at", { count: "exact" }).eq("user_id", uid).eq("status", "inbox").order("created_at", { ascending: false }).limit(5),
      supabase.from("personal_reflections").select("text,what_changed,learning,open_loops,next_action,changed_mind,updated_at").eq("user_id", uid).eq("kind", "daily").eq("reflection_date", dateKey).maybeSingle(),
      supabase.from("gratitude_entries").select("gratitude_1,gratitude_2,gratitude_3,best_moment,learning").eq("user_id", uid).eq("entry_date", dateKey).maybeSingle(),
      supabase.from("personal_tasks").select("id", { count: "exact", head: true }).eq("user_id", uid),
      supabase.from("personal_reflections").select("id", { count: "exact", head: true }).eq("user_id", uid),
      supabase.from("personal_decisions").select("id", { count: "exact", head: true }).eq("user_id", uid),
    ]);
    const firstError = [focusQ, pendingQ, doneQ, eventsQ, routinesQ, entriesQ, reviewQ, activeDecQ, todayDecQ, focusLinkQ, notesQ, reflectionQ, gratitudeQ, anyTaskQ, anyReflQ, anyDecQ].find((q) => q.error);
    if (firstError) return { status: "unavailable", dateKey };

    const priorities = ((focusQ.data ?? []) as TodayTask[]);
    const priorityIds = new Set(priorities.map((t) => t.id));
    const suggestions = orderSuggestions(((pendingQ.data ?? []) as TodayTask[]).filter((t) => !priorityIds.has(t.id)), dateKey).slice(0, 5);

    const entries = new Map(((entriesQ.data ?? []) as { routine_id: string; status: "done" | "postponed" }[]).map((e) => [e.routine_id, e.status]));
    const routines = ((routinesQ.data ?? []) as (RoutineShape & { id: string; name: string; preferred_time: string | null })[])
      .filter((r) => isRoutineApplicable(r, dateKey))
      .map((r) => ({ id: r.id, name: r.name, preferred_time: r.preferred_time, entry: entries.get(r.id) ?? null }));

    // projeto em foco: só o id é pessoal; título/status vêm de client_projects com a sessão (RLS Company)
    let focusProject: FocusProject = { state: "none" };
    const focusId = (focusLinkQ.data?.[0] as { target_id?: string } | undefined)?.target_id;
    if (focusId) {
      const { data: project } = await supabase.from("client_projects").select("id,title,status").eq("id", focusId).maybeSingle();
      focusProject = project ? { state: "available", id: project.id as string, title: (project.title as string) ?? "Projeto", status: (project.status as string | null) ?? null } : { state: "unavailable", id: focusId };
    }

    return {
      status: "ok",
      dateKey,
      firstUse: (anyTaskQ.count ?? 0) === 0 && (anyReflQ.count ?? 0) === 0 && (anyDecQ.count ?? 0) === 0 && (notesQ.count ?? 0) === 0 && (eventsQ.data ?? []).length === 0 && (routinesQ.data ?? []).length === 0,
      priorities,
      suggestions,
      doneToday: doneQ.count ?? 0,
      events: (eventsQ.data ?? []) as TodayEvent[],
      routines,
      decisionsToReview: (reviewQ.data ?? []) as TodayDecision[],
      activeDecisionsForLinking: (activeDecQ.data ?? []) as { id: string; title: string }[],
      decidedToday: (todayDecQ.data ?? []) as { id: string; title: string }[],
      focusProject,
      notes: (notesQ.data ?? []) as TodayNote[],
      notesCount: notesQ.count ?? 0,
      reflection: (reflectionQ.data ?? null) as TodayReflection,
      gratitude: (gratitudeQ.data ?? null) as TodayGratitude,
    };
  } catch {
    return { status: "unavailable", dateKey };
  }
}
