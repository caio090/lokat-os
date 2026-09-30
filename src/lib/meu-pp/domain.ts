/**
 * Meu PP — regras puras da Fase 1 (sem I/O; testadas em runtime).
 *
 * DIA: sempre o dia civil de America/Fortaleza (getFortalezaToday), nunca
 * UTC puro — "hoje" não pode virar às 21h no Brasil.
 */
import { getFortalezaToday } from "@/lib/global-calendar";

export const TZ_OFFSET = "-03:00";
export const MAX_PRIORITIES = 3;
export const MAX_DECISIONS_TO_REVIEW = 3;

export const todayKey = (now: Date = new Date()) => getFortalezaToday(now).dateKey;

/** "2026-09-30" + n dias (aritmética em UTC ao meio-dia: sem saltos de fuso). */
export function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0=domingo … 6=sábado (mesma convenção documentada em personal_routines.days_of_week). */
export const weekdayOf = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`).getUTCDay();

/** Início e fim do dia (instantes com offset Fortaleza) para filtros timestamptz. */
export const dayBounds = (dateKey: string) => ({ startIso: `${dateKey}T00:00:00${TZ_OFFSET}`, endIso: `${addDays(dateKey, 1)}T00:00:00${TZ_OFFSET}` });

/** "HH:MM" local + dia → ISO com offset. */
export const localInstant = (dateKey: string, hhmm: string) => `${dateKey}T${hhmm}:00${TZ_OFFSET}`;

/* ─────────────────────────── rotinas ─────────────────────────── */

export type RoutineShape = {
  frequency_type: "daily" | "specific_days" | "weekly" | "monthly";
  days_of_week: number[] | null;
  day_of_month: number | null;
  active: boolean;
};

/** A rotina vale para este dia? (monthly em mês curto: dia 31 cai no último dia do mês). */
export function isRoutineApplicable(r: RoutineShape, dateKey: string): boolean {
  if (!r.active) return false;
  if (r.frequency_type === "daily") return true;
  if (r.frequency_type === "specific_days" || r.frequency_type === "weekly") return (r.days_of_week ?? []).includes(weekdayOf(dateKey));
  const day = Number(dateKey.slice(8, 10));
  const lastDay = new Date(Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)), 0)).getUTCDate();
  return r.day_of_month === day || (r.day_of_month !== null && r.day_of_month > lastDay && day === lastDay);
}

/* ─────────────────────── prioridades / sugestões ─────────────────────── */

export type TaskLike = { id: string; priority: "high" | "medium" | "low" | null; sort_order: number; due_at: string | null; created_at: string };

/**
 * Regra legada "3 prioridades do dia" (docs/supabase/legacy/personal-core-tasks.sql):
 * camadas atrasada → vence hoje → resto; dentro: prioridade > sort_order > prazo > criação.
 * Na Fase 1 ela ordena as SUGESTÕES; as prioridades em si são escolhidas pelo dono (focus_date).
 */
export function orderSuggestions<T extends TaskLike>(tasks: T[], dateKey: string): T[] {
  const { startIso, endIso } = dayBounds(dateKey);
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const layer = (t: T) => (t.due_at === null ? 2 : Date.parse(t.due_at) < start ? 0 : Date.parse(t.due_at) < end ? 1 : 2);
  const prio = (t: T) => (t.priority === "high" ? 0 : t.priority === "medium" ? 1 : t.priority === "low" ? 2 : 3);
  return [...tasks].sort(
    (a, b) =>
      layer(a) - layer(b) ||
      prio(a) - prio(b) ||
      a.sort_order - b.sort_order ||
      (a.due_at === null ? 1 : 0) - (b.due_at === null ? 1 : 0) ||
      (a.due_at && b.due_at ? Date.parse(a.due_at) - Date.parse(b.due_at) : 0) ||
      Date.parse(a.created_at) - Date.parse(b.created_at),
  );
}

/* ─────────────────────────── captura ─────────────────────────── */

export const CAPTURE_TYPES = ["task", "reflection", "decision", "event", "note"] as const;
export type CaptureType = (typeof CAPTURE_TYPES)[number];
export const CAPTURE_LABEL: Record<CaptureType, string> = { task: "Tarefa", reflection: "Reflexão", decision: "Decisão", event: "Evento", note: "Ideia / nota" };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Sugestão local por palavras-chave (sem LLM). É SÓ sugestão: o dono sempre
 * confirma ou troca o tipo antes de qualquer gravação.
 */
export function suggestCaptureType(text: string): CaptureType {
  const t = norm(text.trim());
  if (!t) return "note";
  if (/\b(decidi|decidimos|decisao|optei|resolvi|nao vou|vou manter|escolhi)\b/.test(t)) return "decision";
  if (/\b(aprendi|percebi|refleti|mudei de ideia|hoje foi|me dei conta|entendi que)\b/.test(t)) return "reflection";
  if (/\b(reuniao|consulta|encontro|dentista|medico|evento|call|visita)\b/.test(t) || /\bas \d{1,2}(h|:\d{2})/.test(t)) return "event";
  if (/^(ligar|enviar|mandar|pagar|comprar|fazer|marcar|agendar|responder|revisar|lembrar|terminar|entregar|cobrar|falar)\b/.test(t) || /\b(preciso|tenho que|lembrar de)\b/.test(t)) return "task";
  return "note";
}

export type CapturePreview = {
  title: string;
  /** task */
  dueDate?: string | null;
  /** decision */
  decision?: string;
  rationale?: string | null;
  /** event */
  date?: string;
  time?: string | null;
};

// `\b` do JS é só ASCII ("amanhã" termina em não-letra para ele): fronteiras Unicode explícitas
const REL_DAY_RE = /(?<!\p{L})(amanhã|amanha|hoje)(?!\p{L})/iu;
const AT_TIME_RE = /(?<!\p{L})(às|as)\s+\d{1,2}(h\d{0,2}|:\d{2})(?!\p{L}|\d)/iu;

/** Campos pré-preenchidos para o preview (sempre editáveis antes de confirmar). */
export function buildCapturePreview(text: string, type: CaptureType, dateKey: string): CapturePreview {
  const raw = text.trim().replace(/\s+/g, " ");
  const n = norm(raw);
  const clean = raw.replace(/[.!]+$/, "");
  const relDay = /\bamanha\b/.test(n) ? addDays(dateKey, 1) : /\bhoje\b/.test(n) ? dateKey : null;
  if (type === "task") {
    const title = clean.replace(REL_DAY_RE, " ").replace(/\s+/g, " ").trim();
    return { title: title || clean, dueDate: relDay };
  }
  if (type === "decision") {
    const m = clean.match(/^(.*?)\s+(porque|pois|já que|ja que)\s+(.+)$/i);
    const decided = (m ? m[1] : clean).replace(/^(decidi|resolvi|optei por)\s+/i, "").trim();
    const title = decided.charAt(0).toUpperCase() + decided.slice(1);
    return { title: title.slice(0, 200), decision: clean, rationale: m ? m[3].trim() : null };
  }
  if (type === "event") {
    const tm = n.match(/\bas (\d{1,2})(?:h|:)(\d{2})?/);
    const time = tm ? `${tm[1].padStart(2, "0")}:${(tm[2] ?? "00").padStart(2, "0")}` : null;
    const title = clean.replace(AT_TIME_RE, " ").replace(REL_DAY_RE, " ").replace(/\s+/g, " ").trim();
    return { title: title || clean, date: relDay ?? dateKey, time };
  }
  return { title: clean };
}
