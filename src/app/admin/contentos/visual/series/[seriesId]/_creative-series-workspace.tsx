"use client";

/**
 * Prompt 24 (Dedicated Creative Series Workspace) — FASE 07/40/41:
 * shell fino do workspace canônico de uma Creative Series. Não duplica
 * o Studio inteiro (FASE 07) -- só um cabeçalho discreto (Série,
 * Company, quantidade, formato, status) + "Voltar ao Studio" +
 * `SeriesWorkspacePanel` (generation/queue/regenerate, ver arquivo
 * irmão). Único ponto deste workspace que conhece `next/navigation`
 * (SeriesWorkspacePanel é 100% props-driven, sem router).
 */
import { useRouter } from "next/navigation";
import { Palette, Building2, UserRound, ArrowLeft } from "lucide-react";
import type { CreativeSeriesRow } from "@/lib/rec-os/studio/series/repository";
import type { CreativeSeriesItem } from "@/lib/rec-os/studio/series/types";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";
import type { DesignFormat } from "@/lib/providers/shared/types";
import { SeriesWorkspacePanel } from "./_series-workspace-panel";

const FORMAT_LABEL: Record<DesignFormat, string> = {
  carousel: "Feed 4:5", story_vertical: "Story 9:16", feed_square: "Quadrado 1:1",
  banner: "Banner", ad: "Anúncio", thumbnail: "Thumbnail", outdoor: "Outdoor", presentation: "Apresentação",
};
const STATUS_LABEL: Record<CreativeSeriesRow["status"], string> = {
  draft: "Rascunho", generating: "Gerando", ready: "Pronta", error: "Com erro",
};

export function CreativeSeriesWorkspace({
  series, initialItems, clientId, companyName, launchContext, skillId, format,
}: {
  series: CreativeSeriesRow;
  initialItems: CreativeSeriesItem[];
  clientId: string | null;
  companyName: string | null;
  launchContext: StudioLaunchContext;
  skillId: string;
  format: DesignFormat;
}) {
  const router = useRouter();
  const backHref = `/admin/contentos/visual${clientId ? `?client=${clientId}` : ""}`;

  return (
    <div className="space-y-4">
      {/* FASE 40 -- cabeçalho discreto, nunca um dashboard novo. FASE 42 -- deixa claro que isto é uma série PERSISTIDA, não "Criar arte" de novo. */}
      <div className="bg-purple-50 border border-purple-100 rounded-2xl p-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-purple-800 mb-1 flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" /> SÉRIE VISUAL
          </p>
          <p className="text-xs text-purple-600">
            {series.count} {series.count === 1 ? "peça" : "peças"} · {FORMAT_LABEL[format] ?? format} · {STATUS_LABEL[series.status]}
          </p>
          <p className="text-[11px] text-purple-500 mt-1 flex items-center gap-1">
            {clientId ? (<><Building2 className="w-3 h-3" /> {companyName ?? "Empresa"}</>) : (<><UserRound className="w-3 h-3" /> Modo livre</>)}
          </p>
        </div>
        {/* FASE 41 -- ação clara pra sair da série (também é a única forma segura de trocar de Company, ver company-context-bar.tsx). */}
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="text-xs font-bold text-purple-700 flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao Studio
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <SeriesWorkspacePanel
          seriesId={series.id}
          initialItems={initialItems}
          clientId={clientId}
          skillId={skillId}
          format={format}
          launchContext={launchContext}
          navigate={(path) => router.push(path)}
        />
      </div>
    </div>
  );
}
