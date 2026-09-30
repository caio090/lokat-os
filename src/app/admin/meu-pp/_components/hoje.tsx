"use client";

import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import type { PersonalTodaySnapshot } from "@/lib/meu-pp/today";
import { CaptureBox } from "./capture";
import { DayClose } from "./day-close";
import { DecisionsToReview } from "./decisions";
import { HistoryLinks } from "./history";
import { Agenda, Priorities } from "./priorities";
import { ContinueProject, NotesInbox, Routines } from "./side";
import { cls } from "./ui";

type Ok = Extract<PersonalTodaySnapshot, { status: "ok" }>;

/**
 * HOJE — "O que importa hoje?". Só agrega (a fonte da verdade são as tabelas
 * pessoais). Mobile: uma coluna, captura curta no topo. Desktop (lg): duas
 * colunas — prioridades/agenda/projeto à esquerda; captura/decisões/rotinas
 * à direita — e o fechamento do dia no fim.
 */
export function MeuPpHoje({ s }: { s: Ok }) {
  const [started, setStarted] = useState(false);
  const [captureInView, setCaptureInView] = useState(true);
  const showHoje = !s.firstUse || started;

  // o atalho flutuante só aparece quando a caixa de captura saiu da tela (nunca cobre o próprio formulário)
  useEffect(() => {
    const box = document.getElementById("meu-pp-captura-mobile");
    if (!box || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCaptureInView(entry.isIntersecting));
    io.observe(box);
    return () => io.disconnect();
  }, [showHoje]);

  if (!showHoje) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-stone-300 bg-[#fbfaf7] px-5 py-8 sm:px-8" data-meu-pp-first-use>
        <p className="max-w-md text-[17px] leading-relaxed text-stone-800">Um espaço para organizar o que você pensa, decide, aprende e constrói.</p>
        <button type="button" className={`${cls.primary} mt-6`} onClick={() => setStarted(true)} data-start-day>
          Começar meu dia
        </button>
      </div>
    );
  }

  const capture = <CaptureBox dateKey={s.dateKey} priorityCount={s.priorities.length} />;
  return (
    <div className="mt-6">
      {s.firstUse ? (
        <ol className="mb-6 grid gap-1 rounded-xl bg-stone-900 px-5 py-4 text-[14px] text-stone-100 sm:grid-cols-3 sm:gap-4" aria-label="Para começar">
          <li><span className="font-serif text-stone-400">1 </span>Escolha até 3 prioridades.</li>
          <li><span className="font-serif text-stone-400">2 </span>Veja sua agenda.</li>
          <li><span className="font-serif text-stone-400">3 </span>Capture algo, se precisar.</li>
        </ol>
      ) : null}

      <div className="scroll-mt-24 lg:hidden" id="meu-pp-captura-mobile">{capture}</div>

      <div className="mt-6 grid gap-8 lg:mt-0 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10">
        <div className="space-y-8">
          <Priorities dateKey={s.dateKey} priorities={s.priorities} suggestions={s.suggestions} />
          <Agenda dateKey={s.dateKey} events={s.events} />
          <div className="lg:hidden">
            <DecisionsToReview dateKey={s.dateKey} decisions={s.decisionsToReview} />
          </div>
          <ContinueProject focus={s.focusProject} />
        </div>
        <div className="space-y-8">
          <div className="hidden lg:block">{capture}</div>
          <div className="hidden lg:block">
            <DecisionsToReview dateKey={s.dateKey} decisions={s.decisionsToReview} />
          </div>
          <Routines dateKey={s.dateKey} routines={s.routines} />
          <NotesInbox notes={s.notes} count={s.notesCount} />
        </div>
      </div>

      <div className="mt-10">
        <DayClose reflection={s.reflection} gratitude={s.gratitude} decidedToday={s.decidedToday} activeDecisions={s.activeDecisionsForLinking} />
      </div>
      <div className="mt-6">
        <HistoryLinks />
      </div>

      {/* captura sempre à mão no celular; fica acima da barra inferior do admin */}
      <button
        type="button"
        aria-label="Capturar"
        onClick={() => {
          const box = document.getElementById("meu-pp-captura-mobile");
          box?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
          box?.querySelector<HTMLTextAreaElement>("[data-meu-pp-capture-input]")?.focus({ preventScroll: true });
        }}
        style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
        className={`${captureInView ? "hidden" : "inline-flex"} fixed right-4 z-30 h-12 w-12 items-center justify-center rounded-full bg-stone-900 text-stone-50 shadow-lg shadow-stone-900/20 lg:hidden`}
      >
        <PenLine className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
