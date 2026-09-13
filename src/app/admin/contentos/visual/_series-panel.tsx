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
 * Prompt 26 (Dedicated Series Workspace Completion) introduziu "Séries
 * Recentes" aqui dentro -- Prompt 28 (Content Handoff Authorization &
 * Recent Series Repair) moveu essa seção pra `_recent-series-section.tsx`,
 * montada INCONDICIONALMENTE em `_studio-execution-form.tsx` (FASE 29:
 * "Séries Recentes é navegação/recovery, não deve depender de o usuário
 * selecionar Série Visual antes" -- este componente só existe/monta
 * quando `quantity !== 1`, então Séries Recentes nunca podia aparecer
 * no modo padrão "Peça única").
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import type { DesignFormat } from "@/lib/providers/shared/types";
import type { CreativeSeriesSize } from "@/lib/rec-os/studio/series/types";
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
  clientId, format, freeformBrief, quantity, launchContext, disabled = false,
}: {
  clientId: string | null;
  format: DesignFormat;
  freeformBrief: string;
  quantity: CreativeSeriesSize;
  /** FASE 17/37 -- usado só pra construir a URL do workspace (content_id/campaign_id/social_profile_id/source_format/return_to), nunca pra decidir qual série mostrar aqui. */
  launchContext: StudioLaunchContext;
  /** FASE 31P (Company Branding Gate) -- true quando Company Mode exige logo oficial e ela ainda não existe; bloqueia "Criar série" pelo mesmo motivo do botão "Criar arte" (série usa a MESMA rota de geração por item -- ver _series-workspace-panel.tsx --, então sem isto o gate seria contornável criando uma série em vez de uma peça única). Checagem real fica no servidor -- isto é só UX. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const contentId = launchContext.contentId;

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
      <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 flex items-center justify-between gap-3">
        <p className="text-xs text-purple-700">
          {quantity === 1 ? "Cria a estrutura da peça." : `Cria a estrutura da série com ${quantity} peças (nenhuma geração começa ainda).`}
        </p>
        <button type="button" onClick={() => void createSeries()} disabled={!freeformBrief.trim() || creating || disabled}
          className="text-xs font-bold bg-purple-600 text-white px-4 py-2 rounded-xl disabled:bg-gray-200 disabled:text-gray-400 flex items-center gap-1.5 shrink-0">
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {quantity === 1 ? "Criar peça" : "Criar série"}
        </button>
      </div>
    </div>
  );
}
