import Link from "next/link";
import { Lock } from "lucide-react";
import { MEU_PP_SECTIONS } from "@/lib/meu-pp/navigation";
import type { PersonalTodaySnapshot } from "@/lib/meu-pp/today";
import { MeuPpHoje } from "./_components/hoje";

/**
 * Meu PP V2 — shell pessoal (server): cabeçalho, 5 seções (só HOJE ativa) e
 * o HOJE interativo. Sem Company, sem dados falsos. Recebe o snapshot já
 * carregado com a sessão do próprio usuário.
 */
function formatToday(dateKey: string): string {
  // dateKey já é o dia civil de America/Fortaleza; meio-dia UTC evita virar o dia na formatação
  const d = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
}

export function MeuPpShell({ today }: { today: Exclude<PersonalTodaySnapshot, { status: "unauthenticated" }> }) {
  return (
    <div className="min-h-full bg-[#f6f4ef] text-stone-900">
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-8 sm:pb-16 sm:pt-10">
        <header>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.22em] text-stone-500">
            <Lock className="h-3 w-3" aria-hidden />
            Pessoal · privado
          </p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight text-stone-900 sm:text-5xl">Meu PP</h1>
          <p className="mt-1.5 max-w-md text-[15px] leading-relaxed text-stone-600">
            Seu espaço pessoal de estratégia, memória e decisão.
          </p>
        </header>

        <nav aria-label="Seções do Meu PP" className="mt-6 border-b border-stone-300/70">
          <ul className="-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none] sm:gap-7">
            {MEU_PP_SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                {s.active && s.href ? (
                  <Link
                    href={s.href}
                    aria-current="page"
                    title={s.question}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center border-b-2 border-stone-900 text-[12px] font-semibold uppercase tracking-[0.16em] text-stone-900"
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

        <section aria-labelledby="meu-pp-hoje" className="mt-8">
          <p className="text-[12px] uppercase tracking-[0.18em] text-stone-500">{formatToday(today.dateKey)}</p>
          <h2 id="meu-pp-hoje" className="mt-1 font-serif text-2xl text-stone-900 sm:text-3xl">
            O que importa hoje?
          </h2>

          {today.status === "unavailable" ? (
            <p role="status" className="mt-6 border-l-2 border-stone-400 pl-4 text-[15px] text-stone-600">
              Não foi possível carregar o seu espaço agora. Tente de novo em instantes.
            </p>
          ) : (
            <MeuPpHoje s={today} />
          )}
        </section>

        <p className="mt-12 text-[12px] leading-relaxed text-stone-500">
          Visível só para você. Nada daqui aparece em empresas, clientes, relatórios ou no painel administrativo.
        </p>
      </div>
    </div>
  );
}
