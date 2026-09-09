"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, AlertTriangle, Sparkles, Download, RefreshCw, Wand2, ChevronDown, ChevronUp, X, Building2, UserRound,
  Maximize2, Grid3x3, Square, PenLine, ArrowRight,
} from "lucide-react";
import type { DesignFormat } from "@/lib/providers/shared/types";
import { VIDIGAL_PNG_DELIVERY_STEPS } from "@/lib/rec-os/studio/skills/vidigal-png/instructions";
import type { VidigalPngOutputContract } from "@/lib/rec-os/studio/skills/vidigal-png/output";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";
import { isStudioLaunchedFromCreate } from "@/lib/rec-os/studio/launch-context";
import { writeVisualImportSession } from "@/lib/rec-os-workflow/visual-import-session";
import { buildEditorAssetHandoff, validateEditorAssetHandoff, serializeEditorAssetHandoff } from "@/lib/rec-os-workflow/editor-handoff";
import { SeriesQuantityPicker, SeriesPanel } from "./_series-panel";
import { RecentSeriesSection } from "./_recent-series-section";
import type { CreativeSeriesSize } from "@/lib/rec-os/studio/series/types";
import { FeedPreview } from "@/components/rec-os/feed-preview";
import { resolveFeedTemporalContext } from "@/lib/rec-os/social-profile/feed-timeline";

/**
 * Sprint REC OS Studio Image Generation MVP V0.3 — experiência de
 * criação completa. Único ponto do Studio que chama
 * POST /api/studio/images/generate -- nunca importa nenhum provider de
 * IA/imagem diretamente (Vidigal PNG também não conhece o provider).
 *
 * Dois modos (Fase 2): "company" reaproveita o `clientId` já
 * selecionado na navegação do REC OS (ContentosSubNavServer/?client=,
 * nenhum seletor novo criado aqui); "free" nunca envia companyId --
 * nunca cria Company fictícia.
 *
 * Assets são efêmeros: convertidos para data: URL no navegador
 * (mesma técnica já usada em CanvasEditor.handleImageUpload), nunca
 * enviados a um bucket -- sem banco, sem tabela, sem permanência.
 */

const IMAGE_FORMATS: { id: DesignFormat; label: string }[] = [
  { id: "carousel", label: "Feed 4:5" },
  { id: "story_vertical", label: "Story 9:16" },
  { id: "feed_square", label: "Quadrado 1:1" },
];

type FormStatus = "idle" | "preparing" | "completed" | "error" | "ai_unavailable" | "image_unavailable";
type CreationMode = "company" | "free";

interface LocalAsset {
  id: string;
  label: string;
  url: string; // data: URL
}

interface GenerateApiResponse {
  ok: boolean;
  error?: string;
  code?: string;
  text?: { status: string; output: VidigalPngOutputContract | null; warnings: string[]; error?: { code: string; message: string } };
  image?: { status: string; image: { url: string; width: number; height: number } | null; providerId: string | null; warnings: string[]; error?: { code: string; message: string } };
}

const LOADING_STEPS = [
  "Entendendo o briefing…",
  "Lendo a identidade da marca…",
  "Definindo a direção criativa…",
  "Preparando a composição…",
  "Criando o visual…",
  "Finalizando a arte…",
];
const AI_UNAVAILABLE_CODES = new Set(["STUDIO_AI_PROVIDER_UNAVAILABLE", "STUDIO_SKILL_RUNTIME_UNAVAILABLE"]);
const IMAGE_UNAVAILABLE_CODES = new Set(["STUDIO_IMAGE_PROVIDER_UNAVAILABLE"]);

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Fase 07/08 -- teto de exibição por formato, nunca a dimensão real do arquivo (que continua 1080x{1080,1350,1920}). */
const PREVIEW_ASPECT: Record<DesignFormat, { ratio: string; maxWidth: number }> = {
  feed_square: { ratio: "1 / 1", maxWidth: 360 },
  carousel: { ratio: "4 / 5", maxWidth: 360 },
  story_vertical: { ratio: "9 / 16", maxWidth: 270 },
  banner: { ratio: "1.91 / 1", maxWidth: 400 },
  ad: { ratio: "1.91 / 1", maxWidth: 400 },
  thumbnail: { ratio: "16 / 9", maxWidth: 400 },
  outdoor: { ratio: "16 / 9", maxWidth: 400 },
  presentation: { ratio: "16 / 9", maxWidth: 400 },
};

type PreviewMode = "piece" | "feed" | "fullscreen";

export function StudioExecutionForm({
  skills, clientId, launchContext,
}: { skills: { id: string; name: string }[]; clientId: string | null; launchContext: StudioLaunchContext }) {
  const router = useRouter();
  const [mode, setMode] = useState<CreationMode>(clientId ? "company" : "free");
  const [freeformBrief, setFreeformBrief] = useState("");
  const [headline, setHeadline] = useState("");
  const [cta, setCta] = useState("");
  const [showTextFields, setShowTextFields] = useState(false);
  const [format, setFormat] = useState<DesignFormat>(IMAGE_FORMATS[0].id);
  const [quantity, setQuantity] = useState<CreativeSeriesSize>(1);
  const [skillId] = useState(skills[0]?.id ?? "vidigal_png");
  const [references, setReferences] = useState<LocalAsset[]>([]);
  const [protectedAssets, setProtectedAssets] = useState<LocalAsset[]>([]);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [loadingStep, setLoadingStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [textOutput, setTextOutput] = useState<VidigalPngOutputContract | null>(null);
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showDirection, setShowDirection] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("piece");
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const protectedInputRef = useRef<HTMLInputElement>(null);
  const fromCreate = isStudioLaunchedFromCreate(launchContext);

  async function handleAddAsset(kind: "reference" | "protected", fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setErrorMessage("A imagem selecionada passa de 6MB.");
      return;
    }
    const url = await fileToDataUrl(file);
    const asset: LocalAsset = { id: `${kind}-${Date.now()}`, label: file.name, url };
    if (kind === "reference") setReferences((prev) => (prev.length >= 4 ? prev : [...prev, asset]));
    else setProtectedAssets((prev) => (prev.length >= 4 ? prev : [...prev, asset]));
  }

  function removeAsset(kind: "reference" | "protected", id: string) {
    if (kind === "reference") setReferences((prev) => prev.filter((a) => a.id !== id));
    else setProtectedAssets((prev) => prev.filter((a) => a.id !== id));
  }

  async function runGeneration(brief: string) {
    setStatus("preparing");
    setLoadingStep(0);
    setErrorMessage(null);
    setTextOutput(null);
    setImage(null);
    setWarnings([]);
    const stepTimer = setInterval(() => setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 1800);

    try {
      const response = await fetch("/api/studio/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId,
          input: {
            freeformBrief: brief.trim(), format, companyId: mode === "company" ? (clientId ?? undefined) : undefined,
            headline: headline.trim() || undefined, cta: cta.trim() || undefined,
          },
          assets: {
            references: references.map((a) => ({ label: a.label, url: a.url })),
            protectedAssets: protectedAssets.map((a) => ({ label: a.label, url: a.url })),
          },
        }),
      });
      const data = (await response.json().catch(() => null)) as GenerateApiResponse | null;

      const textCode = data?.text?.error?.code ?? data?.code;
      if (textCode && AI_UNAVAILABLE_CODES.has(textCode)) {
        setStatus("ai_unavailable");
        return;
      }
      if (data?.text?.status !== "completed" || !data.text.output) {
        setErrorMessage(data?.text?.error?.message ?? data?.error ?? "Não foi possível preparar a direção criativa agora.");
        setStatus("error");
        return;
      }
      setTextOutput(data.text.output);

      const imageCode = data.image?.error?.code;
      if (imageCode && IMAGE_UNAVAILABLE_CODES.has(imageCode)) {
        setWarnings(data.image?.warnings ?? []);
        setStatus("image_unavailable");
        return;
      }
      if (data.image?.status !== "completed" || !data.image.image) {
        setErrorMessage(data?.image?.error?.message ?? "A direção criativa ficou pronta, mas não foi possível gerar a imagem agora.");
        setWarnings(data.image?.warnings ?? []);
        setStatus("error");
        return;
      }

      setImage(data.image.image);
      setWarnings([...(data.text.warnings ?? []), ...(data.image.warnings ?? [])]);
      setStatus("completed");
    } catch {
      setErrorMessage("Não foi possível conectar ao servidor.");
      setStatus("error");
    } finally {
      clearInterval(stepTimer);
    }
  }

  function handleSubmit() {
    if (!freeformBrief.trim()) return;
    void runGeneration(freeformBrief);
  }

  function handleRegenerate() {
    void runGeneration(freeformBrief);
  }

  function handleVariation(variation: { direction: string; promptDelta: string }) {
    const nudged = `${freeformBrief}\n\nPara esta nova versão, ajuste a direção: ${variation.direction} (${variation.promptDelta})`;
    void runGeneration(nudged);
  }

  /** Fase 05/52 -- mesmo mecanismo de sessionStorage já usado por Criar/EditorOS (rec-os-workflow/visual-import-session.ts), nunca um handoff novo. */
  async function writeImageToSession(): Promise<boolean> {
    if (!image || !launchContext.clientId || !launchContext.contentId) return false;
    try {
      const res = await fetch(image.url);
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const result = writeVisualImportSession(launchContext.clientId, launchContext.contentId, {
        fileName: `studio-vidigal-${new Date().toISOString().slice(0, 10)}.${blob.type === "image/png" ? "png" : "jpg"}`,
        mimeType: blob.type || "image/png", dataUrl, size: blob.size,
      });
      if (!result.ok) { setHandoffMessage(result.error); return false; }
      return true;
    } catch {
      setHandoffMessage("Não foi possível preparar esta peça para o conteúdo.");
      return false;
    }
  }

  /** Fase 04/52 -- "USAR NO CONTEÚDO": grava no mesmo formato que Criar já lê como upload manual, depois volta pro fluxo. */
  async function handleUseInContent() {
    setHandoffMessage(null);
    const ok = await writeImageToSession();
    if (ok) router.push(launchContext.returnRoute);
  }

  /** Fase 05 -- "Abrir no EditorOS": mesmo adaptador central já usado pela Criar flow (rec-os-workflow/editor-handoff.ts), nunca um segundo canvas. */
  async function handleOpenInEditor() {
    if (!launchContext.clientId || !launchContext.contentId) return;
    setHandoffMessage(null);
    const ok = await writeImageToSession();
    if (!ok) return;
    const handoff = buildEditorAssetHandoff({
      workspaceId: launchContext.clientId, clientId: launchContext.clientId, contentId: launchContext.contentId,
      campaignId: launchContext.campaignId, assetId: null, assetSource: "geracao_ia",
      fileUrl: null, mimeType: null, width: image?.width ?? null, height: image?.height ?? null,
      format: launchContext.format, destination: null, briefingId: null, conceptId: null, copy: null,
      restrictions: [], returnRoute: launchContext.returnRoute,
    });
    const errors = validateEditorAssetHandoff(handoff);
    if (errors.length > 0) { setHandoffMessage(`Não foi possível abrir o EditorOS: ${errors.join(", ")}.`); return; }
    router.push(`/admin/contentos/editor-os?${serializeEditorAssetHandoff(handoff).toString()}`);
  }

  async function handleDownload() {
    if (!image) return;
    try {
      const res = await fetch(image.url);
      const blob = await res.blob();
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `studio-vidigal-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setErrorMessage("Não foi possível baixar a imagem agora.");
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Nova criação visual</h2>

      {/* Fase 04/52 -- StudioLaunchContext: indicação discreta de que este Studio foi aberto a partir de um conteúdo do Criar. */}
      {fromCreate && (
        <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2">
          <p className="text-[11px] text-purple-700">Criando visual para um conteúdo em andamento no Criar.</p>
        </div>
      )}

      <div>
        <label htmlFor="studio-brief" className="text-xs font-bold text-gray-600 mb-1.5 block">O que vamos criar?</label>
        <textarea
          id="studio-brief" rows={3} value={freeformBrief} onChange={(e) => setFreeformBrief(e.target.value)}
          placeholder='Ex.: "Crie uma arte anunciando nosso combo por R$ 29"'
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-200"
        />
      </div>

      <div>
        <p className="text-xs font-bold text-gray-600 mb-1.5">Empresa</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("company")} disabled={!clientId}
            className={`text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 ${mode === "company" ? "bg-purple-600 text-white" : "bg-gray-50 text-gray-500"} ${!clientId ? "opacity-40 cursor-not-allowed" : ""}`}>
            <Building2 className="w-3.5 h-3.5" /> {clientId ? "Empresa selecionada" : "Selecione uma empresa acima"}
          </button>
          <button type="button" onClick={() => setMode("free")}
            className={`text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 ${mode === "free" ? "bg-purple-600 text-white" : "bg-gray-50 text-gray-500"}`}>
            <UserRound className="w-3.5 h-3.5" /> Sem empresa — criação livre
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-gray-600 mb-1.5">Formato</p>
        <div className="flex gap-2">
          {IMAGE_FORMATS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFormat(f.id)}
              className={`text-xs font-bold px-3 py-2 rounded-xl ${format === f.id ? "bg-purple-600 text-white" : "bg-gray-50 text-gray-500"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <SeriesQuantityPicker value={quantity} onChange={setQuantity} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-bold text-gray-600 mb-1.5">Referências (estilo/atmosfera)</p>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {references.map((a) => (
              <span key={a.id} className="text-[10px] bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 flex items-center gap-1">
                {a.label.slice(0, 16)} <button type="button" onClick={() => removeAsset("reference", a.id)}><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
          <button type="button" onClick={() => referenceInputRef.current?.click()} disabled={references.length >= 4} className="text-[10px] font-bold text-purple-600 disabled:text-gray-300">+ adicionar referência</button>
          <input ref={referenceInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleAddAsset("reference", e.target.files)} />
        </div>
        <div>
          <p className="text-xs font-bold text-gray-600 mb-1.5">Assets oficiais (logo/produto — protegidos)</p>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {protectedAssets.map((a) => (
              <span key={a.id} className="text-[10px] bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 flex items-center gap-1">
                {a.label.slice(0, 16)} <button type="button" onClick={() => removeAsset("protected", a.id)}><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
          <button type="button" onClick={() => protectedInputRef.current?.click()} disabled={protectedAssets.length >= 4} className="text-[10px] font-bold text-purple-600 disabled:text-gray-300">+ adicionar asset oficial</button>
          <input ref={protectedInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleAddAsset("protected", e.target.files)} />
        </div>
      </div>

      <div>
        <button type="button" onClick={() => setShowTextFields((v) => !v)}
          className="text-[10px] font-bold text-purple-600 flex items-center gap-1">
          {showTextFields ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Texto da arte (opcional)
        </button>
        {showTextFields && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <div>
              <label htmlFor="studio-headline" className="text-xs font-bold text-gray-600 mb-1.5 block">Headline</label>
              <input
                id="studio-headline" type="text" value={headline} onChange={(e) => setHeadline(e.target.value)}
                placeholder="Ex.: HOJE ATÉ MAIS TARDE"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              />
            </div>
            <div>
              <label htmlFor="studio-cta" className="text-xs font-bold text-gray-600 mb-1.5 block">CTA</label>
              <input
                id="studio-cta" type="text" value={cta} onChange={(e) => setCta(e.target.value)}
                placeholder="Ex.: PEÇA AGORA"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
              />
            </div>
            <p className="text-[10px] text-gray-400 sm:col-span-2">
              Preenchido aqui, o texto vai para a peça exatamente como escrito. Deixe em branco para a Vidigal sugerir
              (ou escreva direto no briefing acima: &quot;Headline: seu texto&quot; / &quot;CTA: seu texto&quot;).
            </p>
          </div>
        )}
      </div>

      {/* Prompt 28 -- FASE 29/30: Séries Recentes é navegação/recovery, montada INCONDICIONALMENTE (nunca escondida atrás do modo "Série Visual"). */}
      <RecentSeriesSection clientId={mode === "company" ? clientId : null} contentId={launchContext.contentId} />

      {quantity === 1 ? (
        <>
          <button type="button" onClick={handleSubmit} disabled={status === "preparing" || !freeformBrief.trim()}
            className="text-xs font-bold bg-purple-600 text-white px-4 py-2.5 rounded-xl disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1.5">
            {status === "preparing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {status === "preparing" ? LOADING_STEPS[loadingStep] : "Criar arte"}
          </button>

          {status === "ai_unavailable" && (
            <StatusBanner tone="amber" text="IA indisponível no momento — o provider de direção criativa não está configurado ou não respondeu. Tente novamente mais tarde." />
          )}
          {status === "image_unavailable" && (
            <StatusBanner tone="amber" text="A direção criativa ficou pronta, mas a geração de imagem está indisponível no momento (provider não configurado)." />
          )}
          {status === "error" && errorMessage && <StatusBanner tone="red" text={errorMessage} />}
        </>
      ) : (
        // Fase 20-24 -- Série Visual: N requests independentes ao MESMO endpoint, nunca 1 imagem com N layouts.
        // Prompt 24 -- criar só cria a estrutura e navega pro workspace canônico (/visual/series/[seriesId]); gestão de geração/fila/regenerate vive lá, nunca aqui.
        <SeriesPanel
          clientId={mode === "company" ? clientId : null} format={format} freeformBrief={freeformBrief}
          quantity={quantity}
          launchContext={launchContext}
        />
      )}

      {(status === "completed" || status === "image_unavailable") && warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
          {warnings.map((w) => <p key={w} className="text-[10px] text-amber-600">{w}</p>)}
        </div>
      )}

      {status === "completed" && image && (
        <div className="space-y-3 pt-1">
          {/* Fase 07/08 -- teto de EXIBIÇÃO por formato (nunca a dimensão real do arquivo, que continua 1080x{1080,1350,1920}). Três modos: Peça (escala pequena), Feed (simulação de placement), Tela cheia. */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setPreviewMode("piece")} className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 ${previewMode === "piece" ? "bg-purple-100 text-purple-700" : "text-gray-400 hover:bg-gray-50"}`}>
              <Square className="w-3 h-3" /> Peça
            </button>
            <button type="button" onClick={() => setPreviewMode("feed")} className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 ${previewMode === "feed" ? "bg-purple-100 text-purple-700" : "text-gray-400 hover:bg-gray-50"}`}>
              <Grid3x3 className="w-3 h-3" /> Feed / Placement
            </button>
            <button type="button" onClick={() => setPreviewMode("fullscreen")} className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 ${previewMode === "fullscreen" ? "bg-purple-100 text-purple-700" : "text-gray-400 hover:bg-gray-50"}`}>
              <Maximize2 className="w-3 h-3" /> Tela cheia
            </button>
          </div>

          {previewMode === "piece" && (
            <div className="mx-auto" style={{ maxWidth: PREVIEW_ASPECT[format].maxWidth }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL dinâmica (composed em memória), mesmo padrão já usado no restante do Studio */}
              <img
                src={image.url} alt="Peça gerada pela Vidigal PNG"
                className="w-full h-auto rounded-xl border border-gray-100 object-contain bg-gray-50"
                style={{ aspectRatio: PREVIEW_ASPECT[format].ratio }}
              />
            </div>
          )}

          {previewMode === "feed" && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 max-w-[400px] mx-auto">
              <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">
                {format === "story_vertical" ? "Prévia de Story/Reels (vertical, nunca exibido como grid quadrado)" : "Prévia no feed"}
              </p>
              <FeedPreview
                context={resolveFeedTemporalContext([{ id: "current", status: "in_creation", thumbnailUrl: image.url, label: "Esta peça", occurredAt: null }])}
                gridSize={6} mode="with_new_piece"
              />
            </div>
          )}

          {previewMode === "fullscreen" && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setPreviewMode("piece")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL dinâmica, mesmo padrão já usado no restante do Studio */}
              <img src={image.url} alt="Peça gerada pela Vidigal PNG (tela cheia)" className="max-w-full max-h-full object-contain rounded-lg" />
              <button type="button" onClick={() => setPreviewMode("piece")} aria-label="Fechar" className="absolute top-4 right-4 text-white/80 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
          )}

          {handoffMessage && <StatusBanner tone="red" text={handoffMessage} />}

          <div className="flex flex-wrap gap-2">
            <ActionButton icon={RefreshCw} label="Gerar novamente" onClick={handleRegenerate} />
            <ActionButton icon={Download} label="Baixar" onClick={() => void handleDownload()} />
            {fromCreate && <ActionButton icon={ArrowRight} label="Usar no conteúdo" onClick={() => void handleUseInContent()} />}
            {fromCreate && <ActionButton icon={PenLine} label="Abrir no EditorOS" onClick={() => void handleOpenInEditor()} />}
            <ActionButton icon={showDirection ? ChevronUp : ChevronDown} label="Ver direção criativa" onClick={() => setShowDirection((v) => !v)} />
          </div>

          {textOutput && textOutput.variations.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Criar variação</p>
              <div className="flex flex-wrap gap-2">
                {textOutput.variations.map((v, i) => (
                  <button key={`${v.title}-${i}`} type="button" onClick={() => handleVariation(v)}
                    className="text-[10px] font-bold bg-gray-50 border border-gray-100 hover:bg-purple-50 hover:border-purple-100 text-gray-600 px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> {v.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showDirection && textOutput && (
            <div className="space-y-2 pt-1">
              {VIDIGAL_PNG_DELIVERY_STEPS.filter((s) => s.id !== "variations" && s.id !== "adaptations").map((step) => (
                <div key={step.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-1">{String(step.order).padStart(2, "0")} {step.label}</p>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap">{textOutput[step.id as "briefReading" | "creativeDirection" | "conceptualBasis" | "visualStructure" | "visualGuidelines" | "generationPrompt"]}</p>
                </div>
              ))}
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">08 Adaptações</p>
                <ul className="list-disc list-inside space-y-1">
                  {textOutput.adaptations.map((a, i) => <li key={i} className="text-xs text-gray-700">{a}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBanner({ tone, text }: { tone: "amber" | "red"; text: string }) {
  const cls = tone === "amber" ? "bg-amber-50 border-amber-100 text-amber-700" : "bg-red-50 border-red-100 text-red-700";
  return (
    <div className={`border rounded-xl p-3 flex gap-2 items-start ${cls}`}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: typeof Download; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-bold bg-gray-50 hover:bg-gray-100 text-gray-700 px-3 py-2 rounded-xl flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
