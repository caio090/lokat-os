"use client";

import { useState } from "react";
import { Sheet, cls } from "./ui";

type Reflection = { id: string; reflection_date: string; text: string | null; what_changed: string | null; learning: string | null; open_loops: string | null; changed_mind: string | null };
type Decision = { id: string; title: string; decision: string; rationale: string | null; decided_on: string; status: "active" | "superseded"; previous: { title: string; decision: string; decided_on: string } | null };

const fmt = (d: string) => new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

/** Histórico simples, carregado só quando aberto (não é o Mapa Vivo nem busca). */
export function HistoryLinks() {
  const [kind, setKind] = useState<"reflections" | "decisions" | null>(null);
  const [data, setData] = useState<{ reflections?: Reflection[]; decisions?: Decision[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const open = async (k: "reflections" | "decisions") => {
    setKind(k);
    setData(null);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/meu-pp/history?kind=${k}`);
      const json = await res.json();
      if (!json.ok) throw new Error();
      setData(json);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="flex flex-wrap gap-x-1">
      <button type="button" className={`${cls.ghost} -ml-3`} onClick={() => open("reflections")}>Reflexos recentes</button>
      <button type="button" className={cls.ghost} onClick={() => open("decisions")}>Decisões recentes</button>
      <Sheet open={kind !== null} onClose={() => setKind(null)} title={kind === "decisions" ? "Decisões recentes" : "Reflexos recentes"}>
        {failed ? <p className="text-[14px] text-stone-600">Não foi possível carregar agora.</p> : !data ? <p className="text-[14px] text-stone-500">Carregando…</p> : null}
        {kind === "reflections" && data?.reflections ? (
          data.reflections.length ? (
            <ul className="space-y-4">
              {data.reflections.map((r) => (
                <li key={r.id} className="border-b border-stone-200 pb-3 last:border-0">
                  <p className={cls.label}>{fmt(r.reflection_date)}</p>
                  {r.what_changed ? <p className="mt-1 text-[14px]"><span className="text-stone-500">Mudou: </span>{r.what_changed}</p> : null}
                  {r.learning ? <p className="mt-1 text-[14px]"><span className="text-stone-500">Aprendi: </span>{r.learning}</p> : null}
                  {r.open_loops ? <p className="mt-1 text-[14px]"><span className="text-stone-500">Ficou aberto: </span>{r.open_loops}</p> : null}
                  {r.changed_mind ? <p className="mt-1 text-[14px]"><span className="text-stone-500">Mudei de visão: </span>{r.changed_mind}</p> : null}
                  {r.text ? <p className="mt-1 whitespace-pre-line text-[14px] text-stone-700">{r.text}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-stone-500">Nenhum reflexo registrado ainda.</p>
          )
        ) : null}
        {kind === "decisions" && data?.decisions ? (
          data.decisions.length ? (
            <ul className="space-y-4">
              {data.decisions.map((d) => (
                <li key={d.id} className="border-b border-stone-200 pb-3 last:border-0">
                  <p className={cls.label}>
                    {fmt(d.decided_on)} {d.status === "superseded" ? "· substituída" : ""}
                  </p>
                  <p className={`mt-1 text-[15px] font-medium ${d.status === "superseded" ? "text-stone-500" : "text-stone-900"}`}>{d.title}</p>
                  {d.previous ? (
                    <div className="mt-2 grid gap-1 rounded-lg bg-white p-3 text-[14px]" aria-label="Mudança de opinião">
                      <p><span className="text-stone-500">Eu pensava ({fmt(d.previous.decided_on)}): </span>{d.previous.decision}</p>
                      <p><span className="text-stone-500">Agora penso: </span>{d.decision}</p>
                    </div>
                  ) : (
                    <p className="mt-1 text-[14px] text-stone-700">{d.decision}</p>
                  )}
                  {d.rationale ? <p className="mt-1 text-[13px] text-stone-600">Por quê: {d.rationale}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-stone-500">Nenhuma decisão registrada ainda.</p>
          )
        ) : null}
      </Sheet>
    </div>
  );
}
