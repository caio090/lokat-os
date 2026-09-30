/**
 * Meu PP V2 — Fase 0: leitura mínima de HOJE (só contagens), para provar
 * rota + sessão + escopo pessoal + isolamento com dados reais (hoje vazios).
 *
 * REGRAS (testadas em src/lib/meu-pp/__tests__/meu-pp-foundation.structural.test.ts):
 * - SEMPRE a sessão autenticada do próprio usuário (createServerSupabaseClient).
 *   Nunca createSupabaseAdminClient()/service role — o banco já revoga o
 *   service_role nestas tabelas; a aplicação também nunca tenta.
 * - Nunca Company context, cliente ativo, `?client=`, activity_logs ou
 *   productivity_*. Dado pessoal não passa por nenhuma superfície Company.
 * - Filtro explícito por user_id além do RLS (defesa em profundidade).
 */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getFortalezaToday, timestampWindowBounds } from "@/lib/global-calendar";

export type PersonalTodaySnapshot =
  | { status: "ok"; dateKey: string; pendingTasks: number; eventsToday: number; activeRoutines: number }
  | { status: "unauthenticated" }
  | { status: "unavailable"; dateKey: string };

export async function loadPersonalToday(now: Date = new Date()): Promise<PersonalTodaySnapshot> {
  const { dateKey } = getFortalezaToday(now);
  if (!isSupabaseConfigured) return { status: "unavailable", dateKey };
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: "unauthenticated" };

    const { startIso, endIso } = timestampWindowBounds(dateKey, dateKey);
    const [tasks, events, routines] = await Promise.all([
      supabase.from("personal_tasks").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending"),
      supabase.from("personal_events").select("id", { count: "exact", head: true }).eq("user_id", user.id).neq("status", "cancelled").gte("starts_at", startIso).lte("starts_at", endIso),
      supabase.from("personal_routines").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("active", true),
    ]);
    if (tasks.error || events.error || routines.error) return { status: "unavailable", dateKey };
    return { status: "ok", dateKey, pendingTasks: tasks.count ?? 0, eventsToday: events.count ?? 0, activeRoutines: routines.count ?? 0 };
  } catch {
    return { status: "unavailable", dateKey };
  }
}
