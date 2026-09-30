"use client";

import { useState } from "react";
import type { FocusProject, TodayNote, TodayRoutine } from "@/lib/meu-pp/today";
import { ErrorLine, Section, Sheet, cls, useMeuPpAction } from "./ui";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Rotinas que valem hoje: feito / adiado / desfazer. Sem streak, sem pontuação. */
export function Routines({ dateKey, routines }: { dateKey: string; routines: TodayRoutine[] }) {
  const { run, busy, error } = useMeuPpAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState<number[]>([]);
  return (
    <Section
      title="Rotinas de hoje"
      action={
        <button type="button" className={cls.ghost} onClick={() => setOpen(true)}>
          + Rotina
        </button>
      }
    >
      {routines.length ? (
        <ul className="space-y-1">
          {routines.map((r) => (
            <li key={r.id} className="flex min-h-11 flex-wrap items-center gap-x-2">
              <span className={`min-w-0 flex-1 text-[15px] ${r.entry === "done" ? "text-stone-400 line-through" : "text-stone-900"}`}>
                {r.name}
                {r.entry === "postponed" ? <span className="ml-2 text-[12px] text-stone-500">adiada</span> : null}
              </span>
              {r.entry ? (
                <button type="button" className={cls.ghost} disabled={busy} onClick={() => run("routines", "PATCH", { id: r.id, date: dateKey, entry: "clear" })} aria-label={`Desfazer: ${r.name}`}>
                  Desfazer
                </button>
              ) : (
                <>
                  <button type="button" className={cls.secondary} disabled={busy} onClick={() => run("routines", "PATCH", { id: r.id, date: dateKey, entry: "done" })} aria-label={`Feito: ${r.name}`}>
                    Feito
                  </button>
                  <button type="button" className={cls.ghost} disabled={busy} onClick={() => run("routines", "PATCH", { id: r.id, date: dateKey, entry: "postponed" })} aria-label={`Adiar: ${r.name}`}>
                    Adiar
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-stone-500">Nenhuma rotina para hoje.</p>
      )}
      <ErrorLine error={error} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Nova rotina">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run("routines", "POST", { name, frequency: days.length ? "specific_days" : "daily", days });
            if (ok) {
              setName("");
              setDays([]);
              setOpen(false);
            }
          }}
        >
          <div>
            <label htmlFor="meu-pp-routine-name" className="mb-1.5 block text-[13px] font-medium text-stone-700">
              Nome
            </label>
            <input id="meu-pp-routine-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Ler 20 minutos" className={cls.input} />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-stone-700">Dias (nenhum = todo dia)</legend>
            <div className="flex gap-1">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={days.includes(i)}
                  aria-label={WEEKDAY_NAMES[i]}
                  onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
                  className={`h-11 w-11 rounded-full border text-[13px] ${days.includes(i) ? "border-stone-900 bg-stone-900 text-stone-50" : "border-stone-300 text-stone-700"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </fieldset>
          <ErrorLine error={error} />
          <div className="flex justify-end">
            <button type="submit" className={cls.primary} disabled={busy || !name.trim()}>
              Salvar rotina
            </button>
          </div>
        </form>
      </Sheet>
    </Section>
  );
}

const STATUS_LABEL: Record<string, string> = { planning: "Planejamento", in_progress: "Em andamento", review: "Em revisão", on_hold: "Pausado", paused: "Pausado", completed: "Concluído", done: "Concluído", cancelled: "Cancelado", active: "Ativo" };
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, " ");

type ProjectOption = { id: string; title: string | null; status: string | null };

/** Continuar: UM projeto em foco (referência por id; acesso conferido pela regra Company). */
export function ContinueProject({ focus }: { focus: FocusProject }) {
  const { run, busy, error } = useMeuPpAction();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const openPicker = async () => {
    setOpen(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/meu-pp/focus");
      const data = (await res.json()) as { ok: boolean; projects?: ProjectOption[] };
      if (!data.ok) throw new Error();
      setProjects(data.projects ?? []);
    } catch {
      setLoadError("Não foi possível carregar os projetos.");
      setProjects([]);
    }
  };
  return (
    <Section title="Continuar">
      {focus.state === "available" ? (
        <div className={`${cls.card} flex items-center justify-between gap-3 p-3`}>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-stone-900">{focus.title}</p>
            {focus.status ? <p className="text-[12px] text-stone-500">{statusLabel(focus.status)}</p> : null}
          </div>
          <button type="button" className={cls.ghost} onClick={openPicker}>
            Trocar
          </button>
        </div>
      ) : focus.state === "unavailable" ? (
        <div className={`${cls.card} flex items-center justify-between gap-3 p-3`} role="status">
          <p className="text-[14px] text-stone-600">Projeto indisponível.</p>
          <button type="button" className={cls.ghost} disabled={busy} onClick={() => run("focus", "PUT", { projectId: null })}>
            Remover do foco
          </button>
        </div>
      ) : (
        <button type="button" onClick={openPicker} className={`${cls.secondary} w-full justify-start`}>
          Escolher um projeto para manter em foco
        </button>
      )}
      <ErrorLine error={error} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Projeto em foco">
        {projects === null ? (
          <p className="text-[14px] text-stone-500">Carregando…</p>
        ) : projects.length ? (
          <ul className="space-y-1">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await run("focus", "PUT", { projectId: p.id });
                    if (ok) setOpen(false);
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-[15px] text-stone-900 hover:bg-stone-200/60"
                >
                  <span className="truncate">{p.title ?? "Projeto"}</span>
                  {p.status ? <span className="shrink-0 text-[12px] text-stone-500">{statusLabel(p.status)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-stone-500">{loadError ?? "Nenhum projeto disponível para você."}</p>
        )}
        {focus.state !== "none" ? (
          <button type="button" className={`${cls.ghost} mt-3`} disabled={busy} onClick={async () => { const ok = await run("focus", "PUT", { projectId: null }); if (ok) setOpen(false); }}>
            Sem projeto em foco
          </button>
        ) : null}
      </Sheet>
    </Section>
  );
}

/** Caixa de notas (capturas "Ideia/Nota" confirmadas): virar tarefa ou descartar. */
export function NotesInbox({ notes, count }: { notes: TodayNote[]; count: number }) {
  const { run, busy, error } = useMeuPpAction();
  if (!count) return null;
  return (
    <Section title={`Caixa de notas · ${count}`}>
      <ul className="space-y-1">
        {notes.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-x-2 border-b border-stone-200 py-1 last:border-0">
            <span className="min-w-0 flex-1 text-[14px] text-stone-800">{n.raw_text}</span>
            <button type="button" className={cls.ghost} disabled={busy} onClick={() => run("captures", "PATCH", { id: n.id, action: "to_task" })}>
              Virar tarefa
            </button>
            <button type="button" className={cls.ghost} disabled={busy} onClick={() => run("captures", "PATCH", { id: n.id, action: "dismiss" })}>
              Descartar
            </button>
          </li>
        ))}
      </ul>
      {count > notes.length ? <p className="mt-1 text-[12px] text-stone-500">Mostrando as {notes.length} mais recentes.</p> : null}
      <ErrorLine error={error} />
    </Section>
  );
}

