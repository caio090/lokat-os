"use client";

/**
 * Prompt 28 (Content Handoff Authorization & Recent Series Repair) —
 * PARTE H: "Séries Recentes" (implementada no Prompt 26 --
 * listRecentCreativeSeries + GET /api/rec-os/series/recent) nunca
 * aparecia de verdade no Studio root porque vivia DENTRO de
 * `SeriesPanel`, que só é montado quando `quantity !== 1` (ou seja, só
 * depois do usuário escolher "Série Visual"). FASE 29 -- Séries
 * Recentes é NAVEGAÇÃO/RECOVERY, não deve depender do modo de criação
 * escolhido. Extraído pra este componente próprio, montado
 * INCONDICIONALMENTE em `_studio-execution-form.tsx` (FASE 30 --
 * abaixo da entrada principal, nunca um dashboard).
 *
 * FASE 33/34 -- estados honestos (idle/loading nunca se confundem com
 * "lista vazia"; erro de fetch nunca some silenciosamente).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, AlertTriangle } from "lucide-react";
import type { CreativeSeriesSummary } from "@/lib/rec-os/studio/series/repository";

const FORMAT_LABEL: Record<string, string> = { carousel: "Feed 4:5", story_vertical: "Story 9:16", feed_square: "Quadrado 1:1" };
const STATUS_LABEL: Record<string, string> = { draft: "Rascunho", generating: "Gerando", ready: "Pronta", error: "Com erro" };
const RECENT_SERIES_LIMIT = 6;

type FetchState = "loading" | "ready" | "error";

export function RecentSeriesSection({ clientId, contentId }: { clientId: string | null; contentId: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<FetchState>("loading");
  const [list, setList] = useState<CreativeSeriesSummary[]>([]);
  const paramsKey = `${clientId ?? ""}|${contentId ?? ""}`;
  const [prevParamsKey, setPrevParamsKey] = useState(paramsKey);

  // Ajuste de estado DURANTE o render (padrão oficial React "adjusting
  // state when a prop changes", já usado no workspace de série --
  // Prompt 22/24): quando Company/contentId mudam de verdade, marca
  // "loading" imediatamente (nunca deixa a lista antiga da Company
  // anterior visível enquanto o novo fetch corre) -- nunca dentro do
  // efeito abaixo, que só reage a uma mudança JÁ ocorrida chamando
  // setState nos callbacks assíncronos (satisfaz react-hooks/set-state-in-effect).
  if (paramsKey !== prevParamsKey) {
    setPrevParamsKey(paramsKey);
    setState("loading");
  }

  /** FASE 31/32 -- Company scope quando selecionada; owner-scoped (RLS) em Free Mode. */
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (clientId) params.set("client_id", clientId);
    if (contentId) params.set("content_id", contentId);
    params.set("limit", String(RECENT_SERIES_LIMIT));
    fetch(`/api/rec-os/series/recent?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.series)) { setList(data.series as CreativeSeriesSummary[]); setState("ready"); }
        else setState("error");
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [clientId, contentId]);

  /** FASE 27/33 -- abrir uma série recente é sempre STANDALONE: nunca reusa launchContext/query-state (a série antiga pode ter nascido num contexto de retorno completamente diferente). */
  function openRecentSeries(seriesId: string) {
    router.push(`/admin/contentos/visual/series/${seriesId}`);
  }

  // FASE 34 -- fetch ainda não ocorreu/em andamento nunca é confundido com "lista vazia".
  if (state === "loading") {
    return (
      <div data-testid="recent-series-section" data-state={state} className="space-y-1.5">
        <p className="text-[10px] font-black uppercase tracking-wide text-gray-400">Séries recentes</p>
        <div className="h-10 bg-gray-50 border border-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div data-testid="recent-series-section" data-state="error" className="bg-amber-50 border border-amber-100 rounded-xl p-2.5 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <p className="text-[11px] text-amber-700">Não foi possível carregar séries recentes agora.</p>
      </div>
    );
  }

  // FASE 34 -- lista realmente vazia: oculta o bloco (nunca vira dashboard/estado vazio ruidoso).
  if (list.length === 0) return null;

  return (
    <div data-testid="recent-series-section" data-state="ready" className="space-y-1.5">
      <p className="text-[10px] font-black uppercase tracking-wide text-gray-400">Séries recentes</p>
      {list.map((s) => (
        <div key={s.id} data-testid="recent-series-card" className="bg-gray-50 border border-gray-100 rounded-xl p-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-gray-700 truncate">
              {s.count === 1 ? "Peça" : `Série de ${s.count}`} · {FORMAT_LABEL[s.format ?? ""] ?? s.format ?? "Formato padrão"}
            </p>
            <p className="text-[10px] text-gray-400">
              {s.readyCount}/{s.totalCount} prontas · {STATUS_LABEL[s.status] ?? s.status} · {new Date(s.createdAt).toLocaleDateString("pt-BR")}
            </p>
          </div>
          <button type="button" onClick={() => openRecentSeries(s.id)} className="text-xs font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1 shrink-0">
            <ArrowRight className="w-3 h-3" /> Abrir série
          </button>
        </div>
      ))}
    </div>
  );
}
