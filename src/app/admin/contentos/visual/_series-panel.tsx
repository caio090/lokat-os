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
 * regra de produto inalterada desde o Prompt 18). Depois de criar (ou
 * de escolher "continuar"), navega DE VERDADE
 * (`/admin/contentos/visual/series/[seriesId]`, ver
 * `series/[seriesId]/page.tsx`) -- nunca tenta hidratar/administrar
 * items aqui. Toda a gestão de geração/fila/regenerate vive agora em
 * `series/[seriesId]/_series-workspace-panel.tsx`, que não precisa
 * (nem pode) descobrir qual série mostrar: a rota já escolheu.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, RotateCcw } from "lucide-react";
import type { DesignFormat } from "@/lib/providers/shared/types";
import type { CreativeSeriesSize } from "@/lib/rec-os/studio/series/types";
import type { CreativeSeriesWithItems } from "@/lib/rec-os/studio/series/repository";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";
import { buildSeriesWorkspaceUrl } from "@/lib/rec-os/studio/launch-context";

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
  const [recent, setRecent] = useState<CreativeSeriesWithItems | null>(null);
  const contentId = launchContext.contentId;

  /** FASE 19 -- Studio root pode continuar mostrando séries recentes; nunca as carrega como estado escondido aqui (FASE 20 -- abrir sempre navega pro workspace). */
  useEffect(() => {
    const params = new URLSearchParams();
    if (clientId) params.set("client_id", clientId);
    if (contentId) params.set("content_id", contentId);
    fetch(`/api/rec-os/series?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => { if (data?.ok && data.series) setRecent(data.series as CreativeSeriesWithItems); })
      .catch(() => {});
  }, [clientId, contentId]);

  /** FASE 20 -- abrir uma série recente sempre navega pro workspace canônico, nunca hidrata localmente. */
  function continueRecent() {
    if (!recent) return;
    router.push(buildSeriesWorkspaceUrl(recent.series.id, launchContext));
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
      {recent && recent.items.length > 0 && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-600">
            Série recente: {recent.items.filter((i) => i.status === "ready").length}/{recent.items.length} prontas
          </p>
          <button type="button" onClick={continueRecent} className="text-xs font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1 shrink-0">
            <RotateCcw className="w-3 h-3" /> Continuar
          </button>
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
