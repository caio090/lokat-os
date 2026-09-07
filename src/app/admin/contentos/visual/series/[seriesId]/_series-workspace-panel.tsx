"use client";

/**
 * Prompt 24 (Dedicated Creative Series Workspace) — FASE 27-29:
 * "SeriesPanel dentro do workspace não precisa mais administrar QUAL
 * série está ativa. Ele administra apenas: items, generation, statuses,
 * selection, queue, regenerate." Extraído do antigo `_series-panel.tsx`
 * (Prompt 13/16/18/22), removendo TUDO relacionado a descoberta de
 * identidade: nenhum `useSearchParams`/`router.replace` de `series_id`,
 * nenhuma busca de "série recente", nenhum efeito reagindo a
 * `initialSeries`/`clientId` mudando -- porque, aqui dentro, eles NUNCA
 * mudam: `seriesId`/`initialItems` são a identidade da própria rota
 * (`/admin/contentos/visual/series/[seriesId]`, resolvida uma vez pelo
 * Server Component). Não existe reconciliação porque não existem dois
 * valores que podem divergir -- a causa raiz do P1 recorrente (Prompts
 * 20/21/22) deixa de ser corrigida e passa a ser estruturalmente
 * impossível.
 *
 * Sem dependência de `next/navigation`: handoff (USAR NO CONTEÚDO/ABRIR
 * NO EDITOR) delega a navegação real pro componente pai via `navigate`
 * -- mantém este componente 100% props-driven e montável em qualquer
 * harness de teste (inclusive jsdom, ver __tests__/*.dom.test.tsx) sem
 * precisar mockar o App Router.
 *
 * Prompt 26 (Dedicated Series Workspace Completion) — as três "portas
 * de saída" de um item ready (Baixar, Abrir no EditorOS, Usar no
 * conteúdo) SEMPRE resolvem o ativo através de
 * `GET .../items/[itemId]/asset` (FASE 04/05/34/35): nunca a `image.url`
 * já em memória (pode ter sido resolvida minutos atrás), nunca um
 * `visual_asset_id` inventado no cliente -- o servidor valida
 * série -> item -> asset a cada chamada e gera uma signed URL nova.
 * "Abrir no EditorOS" é uma ação MÍNIMA disponível pra qualquer item
 * ready de uma série Company-scoped (não depende de a série ter
 * nascido do Criar -- usa um id de transporte sintético quando não há
 * `contentId` real, FASE 01/09/19); Free Mode não oferece EditorOS
 * porque o próprio EditorOS exige uma Company pra abrir (arquitetura
 * congelada, não alterada aqui). "Usar no conteúdo" continua exigindo
 * um `contentId` REAL (FASE 15-22).
 */
import { useState } from "react";
import { Loader2, RefreshCw, XCircle, Sparkles, AlertTriangle, Grid3x3, RotateCcw, Wand2, ArrowRight, PenLine, MoreHorizontal, Eye, Download, X } from "lucide-react";
import type { DesignFormat } from "@/lib/providers/shared/types";
import { runSeriesGeneration, cancelPendingItems } from "@/lib/rec-os/studio/series/series-orchestrator";
import type { CreativeSeriesItem } from "@/lib/rec-os/studio/series/types";
import { FeedPreview } from "@/components/rec-os/feed-preview";
import { resolveFeedTemporalContext } from "@/lib/rec-os/social-profile/feed-timeline";
import type { FeedTimelineItem } from "@/lib/rec-os/social-profile/feed-timeline";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";
import { isStudioLaunchedFromCreate } from "@/lib/rec-os/studio/launch-context";
import { seriesItemTransportContentId } from "@/lib/rec-os/studio/series/item-transport-id";
import { writeVisualImportSession } from "@/lib/rec-os-workflow/visual-import-session";
import { buildEditorAssetHandoff, validateEditorAssetHandoff, serializeEditorAssetHandoff } from "@/lib/rec-os-workflow/editor-handoff";

interface GenerateApiResponse {
  ok: boolean;
  error?: string;
  image?: { status: string; image: { url: string; width: number; height: number } | null; error?: { message: string } };
}
interface ItemPatchResponse {
  ok: boolean;
  error?: string;
  assetId?: string | null;
  signedUrl?: string | null;
}
interface CanonicalAssetResponse {
  ok: boolean;
  error?: string;
  signedUrl?: string;
  mimeType?: string;
  fileName?: string;
  width?: number;
  height?: number;
}

/** Fase "REGRA ABSOLUTA": cada item é um request independente ao MESMO endpoint da peça única, nunca "uma imagem com N variações". Referências/assets protegidos efêmeros não sobrevivem à navegação pro workspace (mesma limitação já existente hoje em qualquer refresh -- não é uma regressão desta rota, ver relatório). */
async function callImageProvider(input: {
  skillId: string; clientId: string | null; format: DesignFormat; item: CreativeSeriesItem;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/studio/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillId: input.skillId,
        input: {
          freeformBrief: input.item.brief.trim(), format: input.format,
          companyId: input.clientId ?? undefined,
          headline: input.item.headline?.trim() || undefined, cta: input.item.cta?.trim() || undefined,
        },
        assets: { references: [], protectedAssets: [] },
      }),
    });
    const data = (await response.json().catch(() => null)) as GenerateApiResponse | null;
    if (data?.image?.status === "completed" && data.image.image) {
      return { ok: true, url: data.image.image.url };
    }
    return { ok: false, error: data?.image?.error?.message ?? data?.error ?? "Não foi possível gerar esta peça agora." };
  } catch {
    return { ok: false, error: "Não foi possível conectar ao servidor." };
  }
}

async function patchItem(seriesId: string, itemId: string, body: { status: string; imageDataUrl?: string; errorMessage?: string }): Promise<ItemPatchResponse> {
  try {
    const res = await fetch(`/api/rec-os/series/${seriesId}/items/${itemId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as ItemPatchResponse | null;
    return data ?? { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface SeriesWorkspacePanelProps {
  /** Identidade da rota -- constante durante toda a vida deste componente (uma navegação pra outra série remonta a árvore inteira via Server Component, nunca troca este valor em voo). */
  seriesId: string;
  initialItems: CreativeSeriesItem[];
  clientId: string | null;
  skillId: string;
  format: DesignFormat;
  launchContext: StudioLaunchContext;
  /** Navegação real (router.push) delegada ao pai -- ver comentário do topo. */
  navigate: (path: string) => void;
}

export function SeriesWorkspacePanel({ seriesId, initialItems, clientId, skillId, format, launchContext, navigate }: SeriesWorkspacePanelProps) {
  const [items, setItems] = useState<CreativeSeriesItem[]>(initialItems);
  const [queueRunning, setQueueRunning] = useState(false);
  const [confirmingGenerateAll, setConfirmingGenerateAll] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [regenerateError, setRegenerateError] = useState<{ id: string; message: string } | null>(null);
  const [showFeedPreview, setShowFeedPreview] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<CreativeSeriesItem | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const canceledIds = useState(() => new Set<string>())[0];
  const canUseInContent = isStudioLaunchedFromCreate(launchContext);
  const canOpenInEditor = Boolean(clientId); // FASE 01/09 -- mínimo pra qualquer item ready Company-scoped; EditorOS (arquitetura congelada) sempre exige uma Company, então Free Mode nunca oferece esta ação.

  function applyUpdate(next: CreativeSeriesItem) {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
  }

  /**
   * Fase "GERAR ITEM" -- cadeia única e SEMPRE AGUARDADA: generating
   * (persistido) -> chamada real ao provider -> ready/error
   * (persistido). Preservada exatamente como no Prompt 18/22 (FASE 34
   * "Preservar" -- domínio congelado, nenhuma mudança de contrato).
   */
  async function generateOneItemPersisted(item: CreativeSeriesItem): Promise<{ ok: true; image: { url: string; width: number; height: number } } | { ok: false; error: string }> {
    let working = item;
    if (working.status === "canceled" || working.status === "error") {
      const reactivated = await patchItem(seriesId, working.id, { status: "planned" });
      if (!reactivated.ok) return { ok: false, error: "Não foi possível reativar este item." };
      working = { ...working, status: "planned", error: null };
      applyUpdate(working);
    }

    const startedGenerating = await patchItem(seriesId, working.id, { status: "generating" });
    if (!startedGenerating.ok) return { ok: false, error: "Não foi possível iniciar a geração deste item." };
    applyUpdate({ ...working, status: "generating", error: null });

    const providerResult = await callImageProvider({ skillId, clientId, format, item: working });
    if (!providerResult.ok) {
      await patchItem(seriesId, working.id, { status: "error", errorMessage: providerResult.error });
      applyUpdate({ ...working, status: "error", error: providerResult.error });
      return { ok: false, error: providerResult.error };
    }

    const readyResult = await patchItem(seriesId, working.id, { status: "ready", imageDataUrl: providerResult.url });
    if (!readyResult.ok) {
      const message = readyResult.error ?? "A imagem foi gerada, mas não foi possível salvá-la.";
      applyUpdate({ ...working, status: "error", error: message });
      return { ok: false, error: message };
    }
    const image = { url: providerResult.url, width: 1080, height: 1080 };
    const finalItem: CreativeSeriesItem = { ...working, status: "ready", error: null, image, visualAssetId: readyResult.assetId ?? working.visualAssetId };
    applyUpdate(finalItem);
    return { ok: true, image };
  }

  async function handleGenerateOne(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item || item.status === "generating") return;
    await generateOneItemPersisted(item);
  }

  /** Fase "GERAR TODAS" -- fila explícita, concorrência 1 (series-orchestrator.ts, congelado). */
  async function handleGenerateAll() {
    setConfirmingGenerateAll(false);
    setQueueRunning(true);
    const finalItems = await runSeriesGeneration(items, {
      generate: (item) => generateOneItemPersisted(item),
      onItemUpdate: () => {},
      isCanceled: (id) => canceledIds.has(id),
    });
    setItems(finalItems);
    setQueueRunning(false);
  }

  /** Fase "REGRA DE CANCELAMENTO" -- só "planned"; item em voo nunca é tocado. */
  function cancelPending() {
    const pendingIds = new Set(items.filter((i) => i.status === "planned").map((i) => i.id));
    pendingIds.forEach((id) => canceledIds.add(id));
    setItems((prev) => cancelPendingItems(prev, pendingIds));
    pendingIds.forEach((id) => {
      void patchItem(seriesId, id, { status: "canceled" }).then((res) => {
        if (!res.ok) setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: "planned" as const } : i)));
      });
    });
  }

  async function reactivate(itemId: string) {
    const res = await patchItem(seriesId, itemId, { status: "planned" });
    if (res.ok) applyUpdate({ ...items.find((i) => i.id === itemId)!, status: "planned", error: null });
  }

  /** Fase "REGENERATE ASSET STRATEGY" -- item "ready" nunca passa pela máquina planned/generating antes do resultado; asset antigo só é tratado depois do novo estar ligado (asset-persistence.ts, congelado). */
  async function regenerateReady(item: CreativeSeriesItem) {
    setRegenerateError(null);
    setRegeneratingId(item.id);
    const providerResult = await callImageProvider({ skillId, clientId, format, item });
    if (!providerResult.ok) {
      setRegeneratingId(null);
      setRegenerateError({ id: item.id, message: providerResult.error });
      return;
    }
    const readyResult = await patchItem(seriesId, item.id, { status: "ready", imageDataUrl: providerResult.url });
    setRegeneratingId(null);
    if (!readyResult.ok) {
      setRegenerateError({ id: item.id, message: readyResult.error ?? "Não foi possível salvar a nova versão." });
      return;
    }
    applyUpdate({ ...item, status: "ready", error: null, image: { url: providerResult.url, width: 1080, height: 1080 }, visualAssetId: readyResult.assetId ?? item.visualAssetId });
  }

  function handleRegenerate(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if (item.status === "ready") { void regenerateReady(item); return; }
    void generateOneItemPersisted(item);
  }

  /**
   * Fase 04/05/34/35 -- ATIVO CANÔNICO: sempre resolvido no momento da
   * ação (nunca a `image.url` já em memória), sob RLS, nunca aceitando
   * um `visual_asset_id` vindo do cliente (só seriesId+itemId). Usado
   * pelas três portas de saída (Download/EditorOS/Usar no conteúdo).
   */
  async function resolveCanonicalAsset(itemId: string, contentId?: string | null): Promise<CanonicalAssetResponse> {
    try {
      const qs = contentId ? `?content_id=${encodeURIComponent(contentId)}` : "";
      const res = await fetch(`/api/rec-os/series/${seriesId}/items/${itemId}/asset${qs}`);
      const data = (await res.json().catch(() => null)) as CanonicalAssetResponse | null;
      if (!res.ok || !data?.ok) return { ok: false, error: data?.error ?? "Não foi possível preparar este ativo agora." };
      return data;
    } catch {
      return { ok: false, error: "Não foi possível conectar ao servidor." };
    }
  }

  /** Fase 06/07/08 -- baixa o ativo canônico (nunca a thumbnail/data URL antiga): nome humano, MIME real preservado, full resolution. */
  async function handleDownload(item: CreativeSeriesItem) {
    setHandoffMessage(null);
    setPendingActionId(item.id);
    const asset = await resolveCanonicalAsset(item.id);
    setPendingActionId(null);
    if (!asset.ok || !asset.signedUrl) { setHandoffMessage(asset.error ?? "Não foi possível baixar esta peça agora."); return; }
    try {
      const res = await fetch(asset.signedUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = asset.fileName ?? `serie-${seriesId}-peca-${item.position}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setHandoffMessage("Não foi possível baixar esta peça agora.");
    }
  }

  /** Fase 20 -- prefere a identidade do ativo persistido (nunca reconverte um JPEG persistido em base64 gigante à toa): o data URL só existe efemeramente pra alimentar o canal de sessionStorage que o EditorOS/Criar já leem (FASE 09/19 -- reusa o mecanismo existente, nunca um segundo protocolo). */
  async function writeAssetToSession(clientIdForSession: string, contentIdForSession: string, asset: CanonicalAssetResponse & { ok: true; signedUrl: string }): Promise<boolean> {
    try {
      const res = await fetch(asset.signedUrl);
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const result = writeVisualImportSession(clientIdForSession, contentIdForSession, {
        fileName: asset.fileName ?? `serie-${seriesId}.jpg`, mimeType: asset.mimeType ?? (blob.type || "image/jpeg"), dataUrl, size: blob.size,
      });
      if (!result.ok) { setHandoffMessage(result.error); return false; }
      return true;
    } catch {
      setHandoffMessage("Não foi possível preparar esta peça.");
      return false;
    }
  }

  /** Fase 15-22 -- só disponível com um contentId REAL (canUseInContent); servidor revalida esse contentId contra a Company da série (FASE 36) antes de liberar o asset. */
  async function handleUseInContent(item: CreativeSeriesItem) {
    if (!canUseInContent || !launchContext.clientId || !launchContext.contentId) return;
    setHandoffMessage(null);
    setPendingActionId(item.id);
    const asset = await resolveCanonicalAsset(item.id, launchContext.contentId);
    if (!asset.ok || !asset.signedUrl) { setPendingActionId(null); setHandoffMessage(asset.error ?? "Não foi possível preparar esta peça para o conteúdo."); return; }
    const ok = await writeAssetToSession(launchContext.clientId, launchContext.contentId, asset as CanonicalAssetResponse & { ok: true; signedUrl: string });
    setPendingActionId(null);
    if (ok) navigate(launchContext.returnRoute); // FASE 22 -- 0 chamadas ao provider: só sessionStorage + navegação.
  }

  /** Fase 01/09/19 -- ação MÍNIMA pra qualquer item ready Company-scoped, mesmo sem contentId real (série standalone): usa um id de transporte sintético só pra chave de sessionStorage (nunca um content_items real, nunca usado em nenhuma autorização). */
  async function handleOpenInEditor(item: CreativeSeriesItem) {
    if (!clientId) return;
    setHandoffMessage(null);
    setPendingActionId(item.id);
    const asset = await resolveCanonicalAsset(item.id);
    if (!asset.ok || !asset.signedUrl) { setPendingActionId(null); setHandoffMessage(asset.error ?? "Não foi possível abrir esta peça no EditorOS agora."); return; }
    const effectiveContentId = launchContext.contentId ?? seriesItemTransportContentId(seriesId, item.id);
    const ok = await writeAssetToSession(clientId, effectiveContentId, asset as CanonicalAssetResponse & { ok: true; signedUrl: string });
    setPendingActionId(null);
    if (!ok) return;
    const handoff = buildEditorAssetHandoff({
      workspaceId: clientId, clientId, contentId: effectiveContentId,
      campaignId: launchContext.campaignId, assetId: null, assetSource: "geracao_ia",
      fileUrl: null, mimeType: asset.mimeType ?? null, width: asset.width ?? item.image?.width ?? null, height: asset.height ?? item.image?.height ?? null,
      format: launchContext.format, destination: null, briefingId: null, conceptId: null, copy: null,
      restrictions: [], returnRoute: launchContext.returnRoute, // FASE 14 -- já sanitizado na fonte (parseStudioLaunchContext), nunca um redirect aberto.
    });
    const errors = validateEditorAssetHandoff(handoff);
    if (errors.length > 0) { setHandoffMessage(`Não foi possível abrir o EditorOS: ${errors.join(", ")}.`); return; } // FASE 22 -- 0 chamadas ao provider: só sessionStorage + navegação.
    navigate(`/admin/contentos/editor-os?${serializeEditorAssetHandoff(handoff).toString()}`);
  }

  const plannedCount = items.filter((i) => i.status === "planned").length;
  const inCreation: FeedTimelineItem[] = items
    .filter((i) => i.image)
    .map((i) => ({ id: i.id, status: "in_creation" as const, thumbnailUrl: i.image!.url, label: i.role, occurredAt: null }));
  const feedContext = resolveFeedTemporalContext(inCreation);
  const gridSize = items.length <= 6 ? 6 : 9;

  return (
    <div className="space-y-3" data-testid="series-workspace-panel" data-series-id={seriesId}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[10px] font-black uppercase tracking-wide text-gray-400">
          {items.filter((i) => i.status === "ready").length}/{items.length} prontas
        </p>
        <div className="flex items-center gap-3">
          {queueRunning && items.some((i) => i.status === "planned") && (
            <button type="button" onClick={cancelPending} className="text-[10px] font-bold text-gray-500 hover:text-red-600 flex items-center gap-1">
              <XCircle className="w-3 h-3" /> Cancelar pendentes
            </button>
          )}
          {!queueRunning && plannedCount > 0 && !confirmingGenerateAll && (
            <button type="button" onClick={() => setConfirmingGenerateAll(true)} className="text-[10px] font-bold text-purple-600 flex items-center gap-1">
              <Wand2 className="w-3 h-3" /> Gerar todas
            </button>
          )}
          {items.length > 1 && (
            <button type="button" onClick={() => setShowFeedPreview((v) => !v)} className="text-[10px] font-bold text-purple-600 flex items-center gap-1">
              <Grid3x3 className="w-3 h-3" /> Simular no feed
            </button>
          )}
        </div>
      </div>

      {confirmingGenerateAll && (
        <div className="bg-purple-50 border border-purple-100 rounded-lg p-2.5 flex items-center justify-between gap-3">
          <p className="text-[11px] text-purple-700">Isso vai gerar {plannedCount} {plannedCount === 1 ? "imagem" : "imagens"}.</p>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => void handleGenerateAll()} className="text-[10px] font-bold bg-purple-600 text-white px-2.5 py-1 rounded-lg">Confirmar</button>
            <button type="button" onClick={() => setConfirmingGenerateAll(false)} className="text-[10px] font-bold text-gray-400">Cancelar</button>
          </div>
        </div>
      )}
      {queueRunning && items.some((i) => i.status === "generating") && (
        <p className="text-[10px] text-gray-400">Finalizando peça atual antes de considerar cancelamento…</p>
      )}
      {handoffMessage && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex gap-2 items-start">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-700" />
          <p className="text-xs text-red-700">{handoffMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => {
          const isRegeneratingThis = regeneratingId === item.id;
          return (
            <div key={item.id} className="rounded-xl border border-gray-100 overflow-hidden bg-gray-50" data-testid="series-workspace-item" data-item-status={item.status}>
              <div
                className={`aspect-square flex items-center justify-center relative ${item.status === "ready" && item.image ? "cursor-pointer" : ""}`}
                onClick={() => { if (item.status === "ready" && item.image) setPreviewItem(item); }} // FASE 29 -- clique numa peça ready abre "ver peça" (nunca item 01 fixo -- age sobre o item clicado).
              >
                {item.image ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed URL dinâmica */}
                    <img src={item.image.url} alt={item.role} className="w-full h-full object-cover" />
                    {isRegeneratingThis && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                      </div>
                    )}
                  </>
                ) : item.status === "generating" ? (
                  <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                ) : item.status === "error" ? (
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                ) : (
                  <span className="text-[10px] text-gray-300">{item.status === "canceled" ? "Cancelada" : "Planejada"}</span>
                )}
              </div>
              <div className="p-1.5 space-y-1 relative">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[9px] font-bold text-gray-500 truncate">{item.role}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.status === "planned" && (
                      <button type="button" onClick={() => void handleGenerateOne(item.id)} title="Gerar esta peça" className="text-purple-500 hover:text-purple-700">
                        <Sparkles className="w-3 h-3" />
                      </button>
                    )}
                    {(item.status === "ready" || item.status === "error") && (
                      <button type="button" onClick={() => handleRegenerate(item.id)} disabled={isRegeneratingThis} title={item.status === "ready" ? "Regenerar esta peça" : "Tentar novamente"} className="text-gray-400 hover:text-purple-600 disabled:opacity-40">
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    )}
                    {item.status === "canceled" && (
                      <button type="button" onClick={() => void reactivate(item.id)} title="Reativar" className="text-gray-400 hover:text-purple-600">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                    {/* FASE 01/02/03 -- só ready com asset válido; menu compacto (não lota o card) mas descobrível. */}
                    {item.status === "ready" && item.visualAssetId && (
                      <button type="button" onClick={() => setOpenActionsFor((v) => (v === item.id ? null : item.id))} title="Mais ações" data-testid="series-workspace-item-actions-toggle" className="text-gray-400 hover:text-purple-600">
                        <MoreHorizontal className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                {regenerateError?.id === item.id && (
                  <p className="text-[8px] text-red-500 leading-tight">{regenerateError.message}</p>
                )}
                {openActionsFor === item.id && (
                  <div data-testid="series-workspace-item-actions-menu" className="absolute right-1 top-full z-10 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg py-1 min-w-[140px]">
                    <button type="button" onClick={() => { setOpenActionsFor(null); setPreviewItem(item); }} className="w-full text-left text-[10px] font-bold text-gray-600 hover:bg-gray-50 px-2.5 py-1.5 flex items-center gap-1.5">
                      <Eye className="w-3 h-3" /> Ver peça
                    </button>
                    <button type="button" disabled={pendingActionId === item.id} onClick={() => { setOpenActionsFor(null); void handleDownload(item); }} className="w-full text-left text-[10px] font-bold text-gray-600 hover:bg-gray-50 px-2.5 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
                      <Download className="w-3 h-3" /> Baixar
                    </button>
                    {canOpenInEditor && (
                      <button type="button" disabled={pendingActionId === item.id} onClick={() => { setOpenActionsFor(null); void handleOpenInEditor(item); }} className="w-full text-left text-[10px] font-bold text-gray-600 hover:bg-gray-50 px-2.5 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
                        <PenLine className="w-3 h-3" /> Abrir no EditorOS
                      </button>
                    )}
                    {canUseInContent && (
                      <button type="button" disabled={pendingActionId === item.id} onClick={() => { setOpenActionsFor(null); void handleUseInContent(item); }} className="w-full text-left text-[10px] font-bold text-gray-600 hover:bg-gray-50 px-2.5 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
                        <ArrowRight className="w-3 h-3" /> Usar no conteúdo
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showFeedPreview && (
        <div className="bg-white border border-gray-100 rounded-xl p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Prévia no feed (simulação)</p>
          <FeedPreview context={feedContext} gridSize={gridSize} mode="with_new_piece" />
        </div>
      )}

      {/* FASE 29 -- "ver peça" individual, sempre a peça selecionada (nunca item 01 fixo). */}
      {previewItem?.image && (
        <div data-testid="series-workspace-preview-overlay" className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setPreviewItem(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL dinâmica */}
          <img src={previewItem.image.url} alt={previewItem.role} className="max-w-full max-h-full object-contain rounded-lg" />
          <button type="button" onClick={() => setPreviewItem(null)} aria-label="Fechar" className="absolute top-4 right-4 text-white/80 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
