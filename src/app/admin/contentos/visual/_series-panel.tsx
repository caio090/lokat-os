"use client";

/**
 * Prompt 13/16/18 (REC OS Core Experience / Persistence Completion /
 * Creative Series Control & Asset Link Repair) — Fase 20-24 (Série
 * Visual) + persistência real (Prompt 16) + controle explícito de
 * geração (Prompt 18).
 *
 * Prompt 24 (Dedicated Creative Series Workspace) — reescrita completa:
 * três QAs de Production (Prompts 20/21/22) provaram que o problema
 * NUNCA foi persistência/RLS/Company scope (todos corretos) -- era
 * WORKSPACE IDENTITY: uma série persistente vivendo como hóspede
 * temporário (query-param + estado React) dentro da rota genérica do
 * Studio, disputando autoridade com o Company Context do cliente.
 *
 * Este componente agora só faz o que uma "porta de entrada" precisa
 * fazer (FASE 15-20): mostrar séries recentes pra continuar, e criar a
 * ESTRUTURA de uma nova série (1 creative_series + N
 * creative_series_items, todos "planned", ZERO chamadas ao provider --
 * regra de produto inalterada desde o Prompt 18). Depois de criar,
 * navega DE VERDADE (`/admin/contentos/visual/series/[seriesId]`, ver
 * `series/[seriesId]/page.tsx`) -- nunca tenta hidratar/administrar
 * items aqui. Toda a gestão de geração/fila/regenerate vive agora em
 * `series/[seriesId]/_series-workspace-panel.tsx`, que não precisa
 * (nem pode) descobrir qual série mostrar: a rota já escolheu.
 *
 * Prompt 26 (Dedicated Series Workspace Completion) — FASE 23-28/33:
 * "Séries Recentes" vira uma lista LEVE (3-6 entradas, nunca uma
 * biblioteca completa; nunca hidrata imagem nenhuma -- só progresso via
 * `GET /api/rec-os/series/recent`). Abrir uma série recente é sempre
 * STANDALONE (FASE 33 -- "não inventar return_to"): nunca reusa o
 * `launchContext` da sessão atual (que pertence à intenção ATUAL do
 * usuário, não à série antiga que ele está reabrindo) -- navega direto
 * pra `/visual/series/[id]`, sem query nenhuma.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, ArrowRight } from "lucide-react";
import type { DesignFormat } from "@/lib/providers/shared/types";
import type { CreativeSeriesSize } from "@/lib/rec-os/studio/series/types";
import type { CreativeSeriesSummary } from "@/lib/rec-os/studio/series/repository";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";
import { buildSeriesWorkspaceUrl } from "@/lib/rec-os/studio/launch-context";

const FORMAT_LABEL: Record<string, string> = { carousel: "Feed 4:5", story_vertical: "Story 9:16", feed_square: "Quadrado 1:1" };
const STATUS_LABEL: Record<string, string> = { draft: "Rascunho", generating: "Gerando", ready: "Pronta", error: "Com erro" };
const RECENT_SERIES_LIMIT = 6;

const SIZES: CreativeSeriesSize[] = [1, 3, 6, 9];

export function SeriesQuantityPicker({ value, onChange }: { value: CreativeSeriesSize; onChange: (v: CreativeSeriesSize) => void }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-600 mb-1.5">Quantidade</p>
      <div className="flex gap-2">
        {SIZES.map((size) => (
          <button key={size} type="button" onClick={() => onChange(size)}
            className={`text-xs font-bold px-3 py-2 rounded-xl ${value === size ? "bg-purple-600 text-white" : "bg-gray-50 text-gray-500"}`}>
            {size === 1 ? "Peça única" : `Série de ${size}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SeriesPanel({
  clientId, format, freeformBrief, quantity, launchContext,
}: {
  clientId: string | null;
  format: DesignFormat;
  freeformBrief: string;
  quantity: CreativeSeriesSize;
  /** FASE 17/37 -- usado só pra construir a URL do workspace (content_id/campaign_id/social_profile_id/source_format/return_to), nunca pra decidir qual série mostrar aqui. */
  launchContext: StudioLaunchContext;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [recentList, setRecentList] = useState<CreativeSeriesSummary[]>([]);
  const contentId = launchContext.contentId;

  /** FASE 19/23-28 -- Studio root mostra uma lista LEVE de séries recentes (nunca hidrata items/imagens aqui -- FASE 20/27: abrir sempre navega pro workspace). */
  useEffect(() => {
    const params = new URLSearchParams();
    if (clientId) params.set("client_id", clientId);
    if (contentId) params.set("content_id", contentId);
    params.set("limit", String(RECENT_SERIES_LIMIT));
    fetch(`/api/rec-os/series/recent?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => { if (data?.ok && Array.isArray(data.series)) setRecentList(data.series as CreativeSeriesSummary[]); })
      .catch(() => {});
  }, [clientId, contentId]);

  /** FASE 27/33 -- abrir uma série recente é sempre STANDALONE: nunca reusa o launchContext atual (a série antiga pode ter nascido num contexto de retorno completamente diferente), nunca hidrata localmente. */
  function openRecentSeries(seriesId: string) {
    router.push(`/admin/contentos/visual/series/${seriesId}`);
  }

  /** FASE 16-18 -- "CRIAR SÉRIE" só cria a estrutura (0 chamadas ao provider); FASE 17/18 -- aceita o roundtrip e navega pro workspace, nunca tenta evitar navegação com malabarismo de state. */
  async function createSeries() {
    setCreating(true);
    const created = await fetch("/api/rec-os/series", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientId ?? undefined, contentId: contentId ?? undefined, format, freeformBrief: freeformBrief.trim(), count: quantity }),
    }).then((r) => r.json()).catch(() => null);
    setCreating(false);
    if (!created?.ok) return;
    const newSeriesId = created.series.series.id as string;
    router.push(buildSeriesWorkspaceUrl(newSeriesId, launchContext));
  }

  return (
    <div className="space-y-2">
      {/* FASE 23-28 -- lista leve (3-6), nunca uma biblioteca completa. */}
      {recentList.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-wide text-gray-400">Séries recentes</p>
          {recentList.map((s) => (
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
      )}
      <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 flex items-center justify-between gap-3">
        <p className="text-xs text-purple-700">
          {quantity === 1 ? "Cria a estrutura da peça." : `Cria a estrutura da série com ${quantity} peças (nenhuma geração começa ainda).`}
        </p>
        <button type="button" onClick={() => void createSeries()} disabled={!freeformBrief.trim() || creating}
          className="text-xs font-bold bg-purple-600 text-white px-4 py-2 rounded-xl disabled:bg-gray-200 disabled:text-gray-400 flex items-center gap-1.5 shrink-0">
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {quantity === 1 ? "Criar peça" : "Criar série"}
        </button>
      </div>
    </div>
  );
}
