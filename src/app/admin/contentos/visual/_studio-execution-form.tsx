"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, AlertTriangle, Sparkles, Download, RefreshCw, Wand2, ChevronDown, ChevronUp, X, Building2, UserRound,
  Maximize2, Grid3x3, Square, PenLine, ArrowRight, FlaskConical, CheckCircle2,
} from "lucide-react";
import { AttachmentUploader, type AttachmentValue } from "@/components/attachment-uploader";
import type { DesignFormat } from "@/lib/providers/shared/types";
import { VIDIGAL_PNG_DELIVERY_STEPS } from "@/lib/rec-os/studio/skills/vidigal-png/instructions";
import type { VidigalPngOutputContract } from "@/lib/rec-os/studio/skills/vidigal-png/output";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";
import { isStudioLaunchedFromCreate } from "@/lib/rec-os/studio/launch-context";
import type { StudioImageGenerateRequestBody } from "@/lib/rec-os/studio";
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
  image?: {
    status: string; image: { url: string; width: number; height: number } | null; providerId: string | null; warnings: string[]; error?: { code: string; message: string };
    // FASE 31K -- só presente quando o provider real chegou a responder (sucesso ou falha); nunca exigido pelo fluxo normal.
    diagnostics?: { model?: string; quality?: string | null; size?: string | null; durationMs?: number; usage?: unknown };
  };
  // FASE 31G.2 -- só presentes quando o Modo QA (Dry Run) foi autorizado pelo servidor.
  dryRun?: boolean;
  qaMode?: string;
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
  skills, clientId, launchContext, isAdmin = false, isSuperAdmin = false,
}: { skills: { id: string; name: string }[]; clientId: string | null; launchContext: StudioLaunchContext; isAdmin?: boolean; isSuperAdmin?: boolean }) {
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
  // FASE 31G.2 -- Modo QA (Dry Run), visível/acionável SOMENTE pra ADM
  // (checado no server -- este estado só decide o QUE ENVIAR, nunca
  // decide autorização sozinho). `qaMode` no state (não só numa
  // variável local do submit) garante que handleRegenerate/handleVariation
  // -- que só rechamam runGeneration() com o estado atual -- também
  // continuem em Dry Run, nunca convertendo silenciosamente pra uma
  // chamada paga (§12).
  const [qaModeEnabled, setQaModeEnabled] = useState(false);
  const [resultWasDryRun, setResultWasDryRun] = useState(false);
  // FASE 31K -- override REAL (nunca mock) de model/quality, visível/
  // acionável SOMENTE pra Super Admin. Mesmo raciocínio de estado do
  // Modo QA acima -- regenerate/variação continuam usando Sunburst HIGH
  // enquanto ligado, nunca convertendo silenciosamente pro default.
  const [sunburstQaEnabled, setSunburstQaEnabled] = useState(false);
  const [resultDiagnostics, setResultDiagnostics] = useState<{ model?: string; quality?: string | null; size?: string | null; durationMs?: number; usage?: unknown } | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const protectedInputRef = useRef<HTMLInputElement>(null);
  const fromCreate = isStudioLaunchedFromCreate(launchContext);

  // FASE 31P (Company Branding Gate) -- Company Mode SEMPRE prioriza a
  // identidade oficial: ao entrar em mode="company" com uma Company
  // selecionada, verifica context.identity.logoUrl (via o mesmo GET já
  // usado pelo editor /admin/empresa/dna, FASE 31O -- nenhuma rota
  // nova). Ausente = geração bloqueada até o upload inline. A checagem
  // AUTORITATIVA real fica no servidor (route.ts) -- isto é só UX,
  // igual ao Modo QA/Sunburst QA acima.
  const [companyLogoStatus, setCompanyLogoStatus] = useState<"idle" | "loading" | "present" | "absent" | "error">("idle");
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [logoUploadValue, setLogoUploadValue] = useState<AttachmentValue | null>(null);
  const [logoSwapOpen, setLogoSwapOpen] = useState(false);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoSaveError, setLogoSaveError] = useState<string | null>(null);

  async function fetchCompanyLogoStatus(id: string) {
    setCompanyLogoStatus("loading");
    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(id)}/onboarding-profile`);
      if (!res.ok) { setCompanyLogoStatus("error"); return; }
      const data = await res.json().catch(() => null);
      const url = (data?.profile?.logo_url as string | null | undefined) ?? null;
      setCompanyLogoUrl(url);
      setCompanyLogoStatus(url ? "present" : "absent");
    } catch {
      setCompanyLogoStatus("error");
    }
  }

  // Company Mode + Company selecionada -> reavalia a logo sempre que a
  // Company muda (nunca reaproveita o resultado da Company anterior);
  // Free Mode nunca aciona este gate.
  useEffect(() => {
    if (mode === "company" && clientId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo padrão já usado em company-context-bar.tsx: "loading" precisa ser setado antes do fetch disparar.
      void fetchCompanyLogoStatus(clientId);
    } else {
      setCompanyLogoStatus("idle");
      setCompanyLogoUrl(null);
    }
    setLogoUploadValue(null);
    setLogoSwapOpen(false);
    setLogoSaveError(null);
  }, [mode, clientId]);

  async function saveCompanyLogo() {
    if (!clientId || !logoUploadValue?.url) return;
    setLogoSaving(true);
    setLogoSaveError(null);
    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(clientId)}/onboarding-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logo_url: logoUploadValue.url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setLogoSaveError(typeof data?.error === "string" ? data.error : "Não foi possível salvar a logo agora.");
        setLogoSaving(false);
        return;
      }
      setLogoUploadValue(null);
      setLogoSwapOpen(false);
      await fetchCompanyLogoStatus(clientId); // FASE 31P §6 -- revalida o Company Context sem exigir reload manual.
    } catch {
      setLogoSaveError("Erro de conexão ao salvar a logo.");
    }
    setLogoSaving(false);
  }

  // FASE 31P §7/8 -- enquanto Company Mode + Company selecionada e a
  // logo não estiver confirmada PRESENTE (ausente/carregando/erro conta
  // como bloqueado -- fail closed, nunca libera por omissão), a geração
  // fica bloqueada. Nenhum "Continuar sem logo": a única saída é
  // cadastrar a logo.
  const brandingGateBlocking = mode === "company" && !!clientId && companyLogoStatus !== "present";

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
    setResultWasDryRun(false);
    setResultDiagnostics(null);
    const stepTimer = setInterval(() => setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 1800);

    try {
      // FASE 31L -- contrato EXPLÍCITO e tipado com a rota real
      // (StudioImageGenerateRequestBody, studio/types.ts). Causa raiz
      // do bug real encontrado na FASE 31K.1 ("Company selecionada na
      // UI virava free_mode"): companyId vivia dentro de `input` (um
      // campo genérico do briefing, lido por OUTRA rota --
      // /api/studio/skills/execute -- nunca por esta), enquanto a rota
      // de imagem sempre autorizou a partir do nível SUPERIOR do body.
      // Construir a variável tipada ANTES do fetch garante, em tempo
      // de compilação, que companyId nunca mais fica preso dentro de
      // `input` por engano.
      const requestBody: StudioImageGenerateRequestBody = {
        skillId,
        mode,
        companyId: mode === "company" ? (clientId ?? undefined) : undefined,
        input: {
          freeformBrief: brief.trim(), format,
          headline: headline.trim() || undefined, cta: cta.trim() || undefined,
        },
        assets: {
          references: references.map((a) => ({ label: a.label, url: a.url })),
          protectedAssets: protectedAssets.map((a) => ({ label: a.label, url: a.url })),
        },
        // FASE 31G.2 -- só enviado quando o ADM ligou o Modo QA; servidor decide se autoriza de verdade (nunca confia só nisto).
        ...(isAdmin && qaModeEnabled ? { qaMode: "dry_run" as const } : {}),
        // FASE 31K -- só enviado quando o Super Admin ligou o Sunburst QA; servidor decide se autoriza de verdade (nunca confia só nisto).
        ...(isSuperAdmin && sunburstQaEnabled ? { qaImageModel: "gpt-image-2.5-sunburst" as const, qaImageQuality: "high" as const } : {}),
      };
      const response = await fetch("/api/studio/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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
      setResultWasDryRun(Boolean(data.dryRun));
      setResultDiagnostics(data.image.diagnostics ?? null);
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

      {/* FASE 31G.2 -- controle de QA discreto, SOMENTE visível pra ADM (checagem real fica no servidor -- isto é só UX). */}
      {isAdmin && (
        <label className="flex items-center gap-2 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 w-fit cursor-pointer">
          <input type="checkbox" checked={qaModeEnabled} onChange={(e) => setQaModeEnabled(e.target.checked)} className="accent-amber-600" />
          <FlaskConical className="w-3.5 h-3.5" /> Modo QA — Dry Run sem custo
        </label>
      )}

      {/* FASE 31K -- controle SOMENTE visível pra Super Admin (mais restrito que Modo QA acima -- checagem real fica no servidor, isto é só UX). Geração REAL, nunca mock. */}
      {isSuperAdmin && (
        <label className="flex items-center gap-2 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 w-fit cursor-pointer">
          <input type="checkbox" checked={sunburstQaEnabled} onChange={(e) => setSunburstQaEnabled(e.target.checked)} className="accent-indigo-600" />
          <FlaskConical className="w-3.5 h-3.5" /> Sunburst QA — High
        </label>
      )}

      {/* FASE 31P (Company Branding Gate) -- só em Company Mode com Company selecionada; Free Mode nunca exibe/exige isto. Estruturado como o primeiro item de um futuro "BRAND ASSETS" (paleta, fontes, fotos, produtos, referências) -- só Logo é obrigatória por enquanto. */}
      {mode === "company" && clientId && (
        <CompanyBrandingSection
          status={companyLogoStatus}
          logoUrl={companyLogoUrl}
          uploadValue={logoUploadValue}
          onUploadChange={setLogoUploadValue}
          swapOpen={logoSwapOpen}
          onToggleSwap={() => { setLogoSwapOpen((v) => !v); setLogoUploadValue(null); setLogoSaveError(null); }}
          onSave={() => void saveCompanyLogo()}
          onRetry={() => clientId && void fetchCompanyLogoStatus(clientId)}
          saving={logoSaving}
          saveError={logoSaveError}
        />
      )}

      {quantity === 1 ? (
        <>
          <button type="button" onClick={handleSubmit} disabled={status === "preparing" || !freeformBrief.trim() || brandingGateBlocking}
            className="text-xs font-bold bg-purple-600 text-white px-4 py-2.5 rounded-xl disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1.5">
            {status === "preparing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {status === "preparing" ? LOADING_STEPS[loadingStep] : "Criar arte"}
          </button>
          {brandingGateBlocking && companyLogoStatus === "absent" && (
            <p className="text-[11px] font-bold text-amber-600">Cadastre a logo oficial da empresa para continuar.</p>
          )}

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
          disabled={brandingGateBlocking}
        />
      )}

      {(status === "completed" || status === "image_unavailable") && warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
          {warnings.map((w) => <p key={w} className="text-[10px] text-amber-600">{w}</p>)}
        </div>
      )}

      {status === "completed" && image && (
        <div className="space-y-3 pt-1">
          {/* FASE 31G.2 §9 -- indicador visual OBRIGATÓRIO quando o resultado veio do Dry Run, pra nunca confundir fixture com arte real. Só pode aparecer pra ADM (resultWasDryRun só fica true quando o servidor autorizou qaMode). */}
          {resultWasDryRun && (
            <div className="bg-amber-100 border border-amber-300 rounded-xl px-3 py-2 flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <p className="text-[11px] font-black text-amber-800 uppercase tracking-wide">DRY RUN · SEM CUSTO · PROVIDER MOCK</p>
            </div>
          )}
          {/* FASE 31K §11 -- só ADM/Super Admin veem isto (resultDiagnostics só vem preenchido quando o servidor devolveu diagnostics reais); sem UI bonita exigida, só visibilidade discreta pro Codex/QA. */}
          {isSuperAdmin && resultDiagnostics?.model && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold text-indigo-700">
                {resultDiagnostics.model} · quality={resultDiagnostics.quality ?? "auto"} · size={resultDiagnostics.size ?? "?"}
                {typeof resultDiagnostics.durationMs === "number" ? ` · ${(resultDiagnostics.durationMs / 1000).toFixed(1)}s` : ""}
              </p>
              {!!resultDiagnostics.usage && (
                <p className="text-[10px] text-indigo-500 mt-0.5">usage: {JSON.stringify(resultDiagnostics.usage)}</p>
              )}
            </div>
          )}
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

/**
 * FASE 31P (Company Branding Gate) -- "IDENTIDADE DA EMPRESA": hoje só
 * a Logo é obrigatória; a estrutura (wrapper + uma linha por asset) já
 * comporta futuras linhas (Paleta, Fontes, Fotos, Produtos,
 * Referências -- item 15 da fase) sem precisar refatorar, mas essas
 * linhas NÃO são implementadas agora (nenhuma delas é obrigatória
 * ainda). Reaproveita AttachmentUploader (já corrigido na FASE 31O.2)
 * -- nenhum uploader novo.
 */
function CompanyBrandingSection({
  status, logoUrl, uploadValue, onUploadChange, swapOpen, onToggleSwap, onSave, onRetry, saving, saveError,
}: {
  status: "idle" | "loading" | "present" | "absent" | "error";
  logoUrl: string | null;
  uploadValue: AttachmentValue | null;
  onUploadChange: (v: AttachmentValue | null) => void;
  swapOpen: boolean;
  onToggleSwap: () => void;
  onSave: () => void;
  onRetry: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  return (
    <div className="border border-gray-100 rounded-xl p-3 space-y-2" data-testid="company-branding-section">
      <p className="text-[10px] font-black uppercase tracking-wide text-gray-400">Identidade da empresa</p>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando identidade da empresa…
        </div>
      )}

      {status === "error" && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-center justify-between gap-2">
          <p className="text-[11px] text-red-600">Não foi possível verificar a identidade da empresa.</p>
          <button type="button" onClick={onRetry} className="text-[11px] font-bold text-red-700 shrink-0">Tentar novamente</button>
        </div>
      )}

      {status === "present" && (
        <div>
          <div className="flex items-center gap-3">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- logo oficial vem do Company DNA (URL externa/storage), nunca um asset local
              <img src={logoUrl} alt="Logo oficial da empresa" className="w-10 h-10 rounded-lg object-contain border border-gray-100 bg-white shrink-0" />
            )}
            <p className="flex-1 text-xs font-bold text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Logo oficial carregada
            </p>
            <button type="button" onClick={onToggleSwap} className="text-[10px] font-bold text-purple-600 shrink-0">
              {swapOpen ? "Cancelar" : "Trocar logo"}
            </button>
          </div>
          {swapOpen && (
            <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
              <AttachmentUploader value={uploadValue} onChange={onUploadChange} label="Nova logo oficial" />
              <button type="button" onClick={onSave} disabled={!uploadValue?.url || saving}
                className="text-[11px] font-bold bg-purple-600 text-white px-3 py-1.5 rounded-lg disabled:bg-gray-200 disabled:text-gray-400 flex items-center gap-1.5">
                {saving && <Loader2 className="w-3 h-3 animate-spin" />} Salvar nova logo
              </button>
              {saveError && <p className="text-[10px] text-red-600">{saveError}</p>}
            </div>
          )}
        </div>
      )}

      {status === "absent" && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-2">
          <p className="text-xs font-black text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Logo oficial não cadastrada
          </p>
          <p className="text-[11px] text-amber-700">Adicione a logo oficial desta empresa antes de criar peças visuais.</p>
          <AttachmentUploader value={uploadValue} onChange={onUploadChange} label="Logo oficial (PNG, SVG ou WEBP)" />
          <button type="button" onClick={onSave} disabled={!uploadValue?.url || saving}
            className="text-[11px] font-bold bg-purple-600 text-white px-3 py-1.5 rounded-lg disabled:bg-gray-200 disabled:text-gray-400 flex items-center gap-1.5">
            {saving && <Loader2 className="w-3 h-3 animate-spin" />} Salvar logo
          </button>
          {saveError && <p className="text-[10px] text-red-600">{saveError}</p>}
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
