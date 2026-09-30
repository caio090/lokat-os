"use client";

import { useState } from "react";
import type { TodayGratitude, TodayReflection } from "@/lib/meu-pp/today";
import { ErrorLine, Field, Sheet, cls, useMeuPpAction } from "./ui";

/**
 * Fechar o dia: reflexo diário (nenhuma pergunta obrigatória) + gratidão
 * opcional + relações escolhidas pelo dono (nunca inferidas). Sem humor,
 * sem score, sem celebração: "Dia registrado."
 */
export function DayClose({
  reflection,
  gratitude,
  decidedToday,
  activeDecisions,
}: {
  reflection: TodayReflection;
  gratitude: TodayGratitude;
  decidedToday: { id: string; title: string }[];
  activeDecisions: { id: string; title: string }[];
}) {
  const { run, busy, error } = useMeuPpAction();
  const [open, setOpen] = useState(false);
  const [showGratitude, setShowGratitude] = useState(!!gratitude);
  const [r, setR] = useState({
    whatChanged: reflection?.what_changed ?? "",
    learning: reflection?.learning ?? "",
    openLoops: reflection?.open_loops ?? "",
    nextAction: reflection?.next_action ?? "",
    text: reflection?.text ?? "",
    changedMind: reflection?.changed_mind ?? "",
  });
  const [g, setG] = useState({ g1: gratitude?.gratitude_1 ?? "", g2: gratitude?.gratitude_2 ?? "", g3: gratitude?.gratitude_3 ?? "", best: gratitude?.best_moment ?? "", learning: gratitude?.learning ?? "" });
  const [related, setRelated] = useState<string[]>([]);
  const [changedId, setChangedId] = useState("");
  const recorded = !!reflection || !!gratitude;
  const setRf = (k: keyof typeof r) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setR({ ...r, [k]: e.target.value });
  const setGf = (k: keyof typeof g) => (e: React.ChangeEvent<HTMLInputElement>) => setG({ ...g, [k]: e.target.value });

  return (
    <section aria-labelledby="meu-pp-fechar" className="rounded-xl border border-stone-300/70 bg-[#f1eee7] p-5">
      <h2 id="meu-pp-fechar" className="font-serif text-xl text-stone-900">
        {recorded ? "Dia registrado." : "Fechar o dia"}
      </h2>
      {recorded ? (
        <div className="mt-2 space-y-1 text-[14px] text-stone-700">
          {reflection?.what_changed ? <p><span className="text-stone-500">Mudou: </span>{reflection.what_changed}</p> : null}
          {reflection?.learning ? <p><span className="text-stone-500">Aprendi: </span>{reflection.learning}</p> : null}
          {reflection?.open_loops ? <p><span className="text-stone-500">Ficou aberto: </span>{reflection.open_loops}</p> : null}
          {!reflection?.what_changed && !reflection?.learning && !reflection?.open_loops && reflection?.text ? <p className="line-clamp-3">{reflection.text}</p> : null}
        </div>
      ) : (
        <p className="mt-1 text-[14px] text-stone-600">O que mudou, o que você aprendeu, o que ficou aberto.</p>
      )}
      <button type="button" className={`${recorded ? cls.ghost : cls.primary} mt-3 ${recorded ? "-ml-3" : ""}`} onClick={() => setOpen(true)}>
        {recorded ? "Editar reflexo de hoje" : "Fechar o dia"}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Reflexo do dia">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run("day", "PUT", { reflection: r, gratitude: showGratitude ? g : {}, relatedDecisionIds: related, changedDecisionId: changedId || null });
            if (ok) setOpen(false);
          }}
        >
          <Field label="O que mudou hoje?">{(id) => <textarea id={id} rows={2} maxLength={4000} value={r.whatChanged} onChange={setRf("whatChanged")} className={cls.input} />}</Field>
          <Field label="O que você aprendeu?">{(id) => <textarea id={id} rows={2} maxLength={4000} value={r.learning} onChange={setRf("learning")} className={cls.input} />}</Field>
          <Field label="O que ficou aberto?">{(id) => <textarea id={id} rows={2} maxLength={4000} value={r.openLoops} onChange={setRf("openLoops")} className={cls.input} />}</Field>
          <Field label="O que merece atenção amanhã?">{(id) => <input id={id} maxLength={4000} value={r.nextAction} onChange={setRf("nextAction")} className={cls.input} />}</Field>
          <Field label="Como foi o dia, de verdade? (livre)">{(id) => <textarea id={id} rows={3} maxLength={8000} value={r.text} onChange={setRf("text")} className={cls.input} />}</Field>

          {decidedToday.length ? (
            <fieldset>
              <legend className="mb-1 text-[13px] font-medium text-stone-700">Decisões de hoje ligadas a este reflexo</legend>
              {decidedToday.map((d) => (
                <label key={d.id} className="flex min-h-11 items-center gap-2.5 text-[14px] text-stone-700">
                  <input type="checkbox" className="h-5 w-5 accent-stone-900" checked={related.includes(d.id)} onChange={(e) => setRelated(e.target.checked ? [...related, d.id] : related.filter((x) => x !== d.id))} />
                  {d.title}
                </label>
              ))}
            </fieldset>
          ) : null}

          {activeDecisions.length ? (
            <div className="space-y-2">
              <Field label="Mudou de ideia sobre alguma decisão? (opcional)">
                {(id) => (
                  <select id={id} value={changedId} onChange={(e) => setChangedId(e.target.value)} className={cls.input}>
                    <option value="">Não</option>
                    {activeDecisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.title}</option>
                    ))}
                  </select>
                )}
              </Field>
              {changedId ? (
                <Field label="O que mudou na sua visão?" hint="Para registrar a nova posição, use “Mudei de ideia” na decisão.">
                  {(id) => <textarea id={id} rows={2} maxLength={4000} value={r.changedMind} onChange={setRf("changedMind")} className={cls.input} />}
                </Field>
              ) : null}
            </div>
          ) : null}

          <div className="border-t border-stone-200 pt-3">
            <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-stone-700">
              <input type="checkbox" className="h-5 w-5 accent-stone-900" checked={showGratitude} onChange={(e) => setShowGratitude(e.target.checked)} />
              Registrar gratidão (opcional)
            </label>
            {showGratitude ? (
              <div className="mt-2 space-y-2">
                <p className="text-[13px] text-stone-600">Três coisas boas</p>
                {(["g1", "g2", "g3"] as const).map((k, i) => (
                  <input key={k} aria-label={`Coisa boa ${i + 1}`} maxLength={500} value={g[k]} onChange={setGf(k)} className={cls.input} />
                ))}
                <Field label="Melhor momento">{(id) => <input id={id} maxLength={1000} value={g.best} onChange={setGf("best")} className={cls.input} />}</Field>
              </div>
            ) : null}
          </div>

          <ErrorLine error={error} />
          <div className="flex justify-end pt-1">
            <button type="submit" className={cls.primary} disabled={busy}>
              {busy ? "Salvando…" : "Salvar reflexo"}
            </button>
          </div>
        </form>
      </Sheet>
    </section>
  );
}
