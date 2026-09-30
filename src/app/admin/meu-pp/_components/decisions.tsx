"use client";

import { useState } from "react";
import type { TodayDecision } from "@/lib/meu-pp/today";
import { addDays } from "@/lib/meu-pp/domain";
import { Empty, ErrorLine, Field, Section, Sheet, cls, useMeuPpAction } from "./ui";

/**
 * Decision Ledger na HOJE: decisões cuja revisão chegou (máx. 3) e o fluxo
 * "Nova decisão". Mudar de ideia NUNCA edita a anterior: cria uma nova que a
 * substitui (EU PENSAVA → AGORA PENSO fica no histórico).
 */
export function DecisionsToReview({ dateKey, decisions }: { dateKey: string; decisions: TodayDecision[] }) {
  const { run, busy, error } = useMeuPpAction();
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "supersede"; old: TodayDecision } | null>(null);
  return (
    <Section
      title="Decisões para revisar"
      action={
        <button type="button" className={cls.ghost} onClick={() => setEditor({ mode: "create" })}>
          + Nova decisão
        </button>
      }
    >
      {decisions.length ? (
        <ul className="space-y-2">
          {decisions.map((d) => (
            <li key={d.id} className={`${cls.card} p-3`}>
              <p className="text-[15px] font-medium text-stone-900">{d.title}</p>
              {d.review_trigger ? <p className="mt-1 text-[13px] text-stone-600">Rever se: {d.review_trigger}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={cls.secondary} disabled={busy} onClick={() => run("decisions", "PATCH", { id: d.id, action: "reviewed", nextReviewAt: null })}>
                  Mantenho
                </button>
                <button type="button" className={cls.ghost} disabled={busy} onClick={() => run("decisions", "PATCH", { id: d.id, action: "reviewed", nextReviewAt: addDays(dateKey, 30) })}>
                  Rever em 30 dias
                </button>
                <button type="button" className={cls.ghost} onClick={() => setEditor({ mode: "supersede", old: d })}>
                  Mudei de ideia
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nenhuma decisão aguardando revisão.</Empty>
      )}
      <ErrorLine error={error} />
      <DecisionEditor state={editor} onClose={() => setEditor(null)} />
    </Section>
  );
}

export function DecisionEditor({ state, onClose }: { state: { mode: "create" } | { mode: "supersede"; old: TodayDecision } | null; onClose: () => void }) {
  const { run, busy, error } = useMeuPpAction();
  const [f, setF] = useState({ title: "", decision: "", rationale: "", reviewTrigger: "", reviewAt: "", context: "", alternatives: "", assumptions: "", acceptedRisks: "" });
  const [more, setMore] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const close = () => {
    setF({ title: "", decision: "", rationale: "", reviewTrigger: "", reviewAt: "", context: "", alternatives: "", assumptions: "", acceptedRisks: "" });
    setMore(false);
    onClose();
  };
  const supersede = state?.mode === "supersede" ? state.old : null;
  return (
    <Sheet open={!!state} onClose={close} title={supersede ? "Mudei de ideia" : "Nova decisão"}>
      {supersede ? (
        <div className="mb-4 rounded-lg border border-stone-300 bg-white p-3 text-[14px]">
          <p className={cls.label}>Eu pensava</p>
          <p className="mt-1 text-stone-700">{supersede.decision}</p>
          <p className="mt-2 text-[12px] text-stone-500">A decisão anterior continua no histórico. A nova passa a valer.</p>
        </div>
      ) : null}
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run("decisions", "POST", { mode: supersede ? "supersede" : "create", oldId: supersede?.id, ...f, reviewAt: f.reviewAt || null });
          if (ok) close();
        }}
      >
        <Field label={supersede ? "Agora penso / decidi" : "O que você decidiu?"}>{(id) => <textarea id={id} rows={2} required maxLength={4000} value={f.decision} onChange={set("decision")} className={cls.input} />}</Field>
        <Field label="Por quê?">{(id) => <textarea id={id} rows={2} maxLength={4000} value={f.rationale} onChange={set("rationale")} className={cls.input} />}</Field>
        <Field label="Tem algo que faria você rever isso?">{(id) => <input id={id} maxLength={2000} value={f.reviewTrigger} onChange={set("reviewTrigger")} className={cls.input} />}</Field>
        <button type="button" className={`${cls.ghost} -ml-3`} aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? "− Menos detalhes" : "+ Mais detalhes (título, contexto, alternativas, premissas, riscos, revisão)"}
        </button>
        {more ? (
          <div className="space-y-3">
            <Field label="Título curto" hint="Se vazio, usa o começo da decisão.">{(id) => <input id={id} maxLength={200} value={f.title} onChange={set("title")} className={cls.input} />}</Field>
            <Field label="Contexto">{(id) => <textarea id={id} rows={2} maxLength={4000} value={f.context} onChange={set("context")} className={cls.input} />}</Field>
            <Field label="Alternativas consideradas">{(id) => <textarea id={id} rows={2} maxLength={4000} value={f.alternatives} onChange={set("alternatives")} className={cls.input} />}</Field>
            <Field label="Premissas">{(id) => <textarea id={id} rows={2} maxLength={4000} value={f.assumptions} onChange={set("assumptions")} className={cls.input} />}</Field>
            <Field label="Riscos aceitos">{(id) => <textarea id={id} rows={2} maxLength={4000} value={f.acceptedRisks} onChange={set("acceptedRisks")} className={cls.input} />}</Field>
            <Field label="Próxima revisão">{(id) => <input id={id} type="date" value={f.reviewAt} onChange={set("reviewAt")} className={cls.input} />}</Field>
          </div>
        ) : null}
        <ErrorLine error={error} />
        <div className="flex justify-end pt-1">
          <button type="submit" className={cls.primary} disabled={busy || !f.decision.trim()}>
            {busy ? "Salvando…" : "Salvar decisão"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
