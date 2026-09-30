"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import type { TodayEvent, TodayTask } from "@/lib/meu-pp/today";
import { MAX_PRIORITIES } from "@/lib/meu-pp/domain";
import { Empty, ErrorLine, Section, cls, useMeuPpAction } from "./ui";

/**
 * Prioridade = tarefa existente destacada para hoje (focus_date). Nunca uma
 * cópia. Sugestões seguem a regra legada (atrasadas → vencem hoje → resto).
 */
export function Priorities({ dateKey, priorities, suggestions }: { dateKey: string; priorities: TodayTask[]; suggestions: TodayTask[] }) {
  const { run, busy, error } = useMeuPpAction();
  const [title, setTitle] = useState("");
  const full = priorities.length >= MAX_PRIORITIES;
  const pendingFirst = [...priorities].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.sort_order - b.sort_order);

  const move = (i: number, dir: -1 | 1) => {
    const ids = pendingFirst.map((t) => t.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run("tasks", "PATCH", { action: "reorder", date: dateKey, ids });
  };

  return (
    <Section title={`Suas ${MAX_PRIORITIES} prioridades`} id="prioridades">
      {pendingFirst.length ? (
        <ol className="divide-y divide-stone-200 rounded-xl border border-stone-300/70 bg-[#fbfaf7]" aria-label="Prioridades de hoje">
          {pendingFirst.map((t, i) => {
            const done = t.status === "done";
            return (
              <li key={t.id} className="flex items-center gap-1 py-1 pl-2 pr-1">
                <button
                  type="button"
                  onClick={() => run("tasks", "PATCH", { id: t.id, action: done ? "reopen" : "complete" })}
                  disabled={busy}
                  aria-pressed={done}
                  aria-label={done ? `Reabrir: ${t.title}` : `Concluir: ${t.title}`}
                  className={`${cls.icon} `}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${done ? "border-stone-900 bg-stone-900 text-stone-50" : "border-stone-400"}`}>{done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="font-serif text-[13px] text-stone-500">{i + 1}</span>}</span>
                </button>
                <span className={`min-w-0 flex-1 text-[15px] ${done ? "text-stone-400 line-through" : "text-stone-900"}`}>{t.title}</span>
                {!done ? (
                  <>
                    <button type="button" className={cls.icon} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${t.title}`}>
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </button>
                    <button type="button" className={`${cls.icon} hidden sm:inline-flex`} disabled={busy || i === pendingFirst.length - 1} onClick={() => move(i, 1)} aria-label={`Descer ${t.title}`}>
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </button>
                  </>
                ) : null}
                <button type="button" className={cls.icon} disabled={busy} onClick={() => run("tasks", "PATCH", { id: t.id, action: "unfocus" })} aria-label={`Tirar das prioridades: ${t.title}`}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty>Nenhuma prioridade ainda.</Empty>
      )}

      {!full ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const ok = await run("tasks", "POST", { title, focus: true, date: dateKey });
            if (ok) setTitle("");
          }}
        >
          <label htmlFor="meu-pp-new-priority" className="sr-only">
            Nova prioridade
          </label>
          <input id="meu-pp-new-priority" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder="Adicionar prioridade" className={cls.input} />
          <button type="submit" className={cls.secondary} disabled={busy || !title.trim()}>
            Adicionar
          </button>
        </form>
      ) : null}

      {!full && suggestions.length ? (
        <div className="mt-3">
          <p className="mb-1 text-[12px] text-stone-500">Tarefas em aberto que podem entrar:</p>
          <ul className="flex flex-col">
            {suggestions.slice(0, 3).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] text-stone-700">{t.title}</span>
                <button type="button" className={cls.ghost} disabled={busy} onClick={() => run("tasks", "PATCH", { id: t.id, action: "focus", date: dateKey })} aria-label={`Tornar prioridade: ${t.title}`}>
                  Priorizar
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ErrorLine error={error} />
    </Section>
  );
}

const TIME_FMT = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" });

/** Agenda pessoal do dia (personal_events) — nunca o calendário Company. */
export function Agenda({ dateKey, events }: { dateKey: string; events: TodayEvent[] }) {
  const { run, busy, error } = useMeuPpAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  return (
    <Section
      title="Agenda"
      action={
        <button type="button" className={cls.ghost} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Cancelar" : "+ Compromisso"}
        </button>
      }
    >
      {events.length ? (
        <ul className="space-y-1" aria-label="Compromissos de hoje">
          {events.map((e) => (
            <li key={e.id} className="flex min-h-11 items-center gap-3 rounded-lg px-1">
              <span className="w-14 shrink-0 font-serif text-[15px] tabular-nums text-stone-500">{e.all_day ? "Dia todo" : TIME_FMT.format(new Date(e.starts_at))}</span>
              <span className={`min-w-0 flex-1 text-[15px] ${e.status === "completed" ? "text-stone-400 line-through" : "text-stone-900"}`}>{e.title}</span>
              {e.status !== "completed" ? (
                <button type="button" className={cls.ghost} disabled={busy} onClick={() => run("events", "PATCH", { id: e.id, status: "completed" })} aria-label={`Marcar como feito: ${e.title}`}>
                  Feito
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !open ? (
        <p className="text-[14px] text-stone-500">Nenhum compromisso hoje.</p>
      ) : null}
      {open ? (
        <form
          className="mt-2 grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_8rem_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run("events", "POST", { title, date: dateKey, time: time || null });
            if (ok) {
              setTitle("");
              setTime("");
              setOpen(false);
            }
          }}
        >
          <label htmlFor="meu-pp-event-title" className="sr-only">Compromisso</label>
          <input id="meu-pp-event-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Compromisso" className={`${cls.input} col-span-2 sm:col-span-1`} />
          <label htmlFor="meu-pp-event-time" className="sr-only">Hora</label>
          <input id="meu-pp-event-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cls.input} />
          <button type="submit" className={cls.secondary} disabled={busy || !title.trim()}>
            Salvar
          </button>
        </form>
      ) : null}
      <ErrorLine error={error} />
    </Section>
  );
}
