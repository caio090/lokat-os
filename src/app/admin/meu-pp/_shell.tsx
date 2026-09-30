import Link from "next/link";
import { Lock } from "lucide-react";
import { MEU_PP_SECTIONS, PHASE_1_PREVIEW } from "@/lib/meu-pp/navigation";
import type { PersonalTodaySnapshot } from "@/lib/meu-pp/today";

/**
 * Meu PP V2 — Fase 0: apresentação do shell pessoal (sem dados, sem hooks,
 * sem Company). Recebe o snapshot já carregado com a sessão do usuário.
 * Só HOJE está ativa; as demais seções aparecem como "em breve", sem rota.
 */
function formatToday(dateKey: string): string {
  // dateKey já é o dia civil de America/Fortaleza; meio-dia UTC evita virar o dia na formatação
  const d = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
}

export function MeuPpShell({ today }: { today: Exclude<PersonalTodaySnapshot, { status: "unauthenticated" }> }) {
  const hasData = today.status === "ok" && today.pendingTasks + today.eventsToday + today.activeRoutines > 0;

  return (
    <div className="min-h-full bg-[#f6f4ef] text-stone-900">
      <div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <header>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.22em] text-stone-500">
            <Lock className="h-3 w-3" aria-hidden />
            Pessoal · privado
          </p>
          <h1 className="mt-3 font-serif text-4xl tracking-tight text-stone-900 sm:text-5xl">Meu PP</h1>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-stone-600">
            Seu espaço pessoal de estratégia, memória e decisão.
          </p>
        </header>

        <nav aria-label="Seções do Meu PP" className="mt-8 border-b border-stone-300/70">
          <ul className="-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none] sm:gap-7">
            {MEU_PP_SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                {s.active && s.href ? (
                  <Link
                    href={s.href}
                    aria-current="page"
                    title={s.question}
                    className="inline-flex min-h-11 items-center border-b-2 border-stone-900 text-[12px] font-semibold uppercase tracking-[0.16em] text-stone-900"
                  >
                    {s.label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    title={`${s.question} — em breve`}
                    className="inline-flex min-h-11 cursor-default items-center gap-1.5 border-b-2 border-transparent text-[12px] font-medium uppercase tracking-[0.16em] text-stone-400"
                  >
                    {s.label}
                    <span className="text-[9px] font-normal normal-case tracking-normal text-stone-400">em breve</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <section aria-labelledby="meu-pp-hoje" className="mt-10">
          <p className="text-[12px] uppercase tracking-[0.18em] text-stone-500">
            {formatToday(today.dateKey)}
          </p>
          <h2 id="meu-pp-hoje" className="mt-1 font-serif text-2xl text-stone-900 sm:text-3xl">Hoje</h2>

          {today.status === "unavailable" ? (
            <p role="status" className="mt-6 border-l-2 border-stone-400 pl-4 text-[15px] text-stone-600">
              Não foi possível carregar o seu espaço agora. Tente de novo em instantes.
            </p>
          ) : hasData && today.status === "ok" ? (
            <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-stone-300/70 bg-stone-300/70">
              {[
                { label: "Tarefas em aberto", value: today.pendingTasks },
                { label: "Agenda de hoje", value: today.eventsToday },
                { label: "Rotinas ativas", value: today.activeRoutines },
              ].map((m) => (
                <div key={m.label} className="bg-[#fbfaf7] px-4 py-4">
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-stone-500">{m.label}</dt>
                  <dd className="mt-1 font-serif text-2xl text-stone-900">{m.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mt-6 rounded-lg border border-dashed border-stone-300 bg-[#fbfaf7] px-5 py-7 sm:px-7" data-meu-pp-empty>
              <p className="text-[17px] text-stone-800">Ainda não há nada aqui.</p>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-stone-600">
                Um espaço para organizar o que você pensa, decide, aprende e constrói.
              </p>
              <div className="mt-6 border-t border-stone-200 pt-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Na próxima fase</p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-stone-600">
                  {PHASE_1_PREVIEW.map((item) => (
                    <li key={item} className="before:mr-1.5 before:text-stone-400 before:content-['•']">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        <p className="mt-12 text-[12px] leading-relaxed text-stone-500">
          Visível só para você. Nada daqui aparece em empresas, clientes, relatórios ou no painel administrativo.
        </p>
      </div>
    </div>
  );
}
