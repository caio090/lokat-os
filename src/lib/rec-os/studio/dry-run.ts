/**
 * FASE 31G (LKT Image Dry Run Sem Custo) — espelha create-studio-visual.ts
 * (mesma sequência real: business context -> reference analysis ->
 * text directives -> Vidigal -> render plan -> composition guidance ->
 * background guard -> compositor), mas NUNCA chama um provider pago de
 * imagem, e (modo `fullZeroCost`) também nunca chama a Vidigal/análise
 * de referência reais -- troca essas duas etapas por fixtures
 * determinísticas (dry-run-fixtures.ts), reportando SEMPRE quais
 * etapas normalmente teriam custo (nunca mascarado).
 *
 * Preview/Development only -- o gate real (VERCEL_ENV + env flags)
 * fica na rota (api/studio/images/generate/route.ts), nunca aqui;
 * este módulo assume que quem chamou já validou isso, mas também nunca
 * é importado fora desse caminho gated.
 *
 * NÃO toca create-studio-visual.ts, image-runtime.ts, neural-executor.ts
 * (Vidigal), instructions.ts, compositor.ts nem os providers reais --
 * só reaproveita funções puras/exportadas já existentes deles.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudioBriefInput } from "./types";
import type { StudioSkillExecutionResult, StudioSkillBusinessContext } from "./runtime";
import { buildStudioCreativeBusinessContext } from "./business-context";
import { executeStudioSkill } from "./execute";
import type { StudioImageAsset, StudioImageAssetKind } from "./image/types";
import { analyzeStudioReferences, type ReferenceAnalysisResult } from "./render/reference-analysis";
import { parseStudioTextDirectives, resolveFinalText } from "./text-directives";
import { applyCompositionGuidance } from "./image/composition-guidance";
import { applyBackgroundGuardPolicy } from "./image/background-guard";
import { buildDryRunVidigalOutput, buildDryRunBackgroundImage } from "./image/dry-run-fixtures";
import type { VidigalPngOutputContract } from "./skills/vidigal-png/output";
import { buildStudioRenderPlan } from "./render/render-plan";
import { composeStudioVisual, type ProtectedAssetBytes } from "./render/compositor";
import { fetchAssetSafely } from "./render/asset-fetch";
import { decodeImageDataUrl } from "./render/data-url";
import type { StudioProtectedAssetRole, StudioVisualResult } from "./render/types";
import { getActiveProvider } from "@/lib/ai/image-providers";
import type { ImageAspectRatio } from "@/lib/ai/image-providers/types";
import type { DesignFormat } from "@/lib/providers/shared/types";
import { buildOpenAIImageRequest, DEFAULT_OPENAI_IMAGE_MODEL } from "@/lib/ai/image-providers/openai-image-compat";
import { resolveGoogleAspectRatio, resolveGoogleImageSize, DEFAULT_GOOGLE_IMAGE_MODEL } from "@/lib/ai/image-providers/google-gemini-compat";

export interface CreateStudioVisualDryRunRequest {
  skillId: string;
  input: StudioBriefInput;
  companyId: string | null;
  companyName: string | null;
  assets: { references: StudioImageAsset[]; protectedAssets: StudioImageAsset[] };
  db: SupabaseClient;
  /** FASE 31G §3 -- quando true, NENHUMA API paga é chamada em nenhuma etapa (Vidigal/reference-analysis incluídas), usando fixtures. Quando false, só o provider de imagem é mockado -- texto/análise de referência continuam reais (podem custar, se houver saldo). */
  fullZeroCost: boolean;
}

export interface DryRunAssetMatrixEntry {
  id: string;
  label: string;
  kind: StudioImageAssetKind;
  role: "logo" | "product" | null;
  seenBy: { vidigal: boolean; referenceAnalysis: boolean; imageModel: boolean; compositor: boolean };
}

export interface StudioVisualDryRunDiagnosticPacket {
  dryRun: true;
  fullZeroCost: boolean;
  costedStepsNormallyPaid: string[];
  costedStepsSkippedThisRun: string[];
  userBrief: StudioBriefInput;
  businessContext: StudioSkillBusinessContext;
  referenceAnalysis: ReferenceAnalysisResult & { source: "real" | "skipped_zero_cost" | "not_applicable_no_references" };
  textDirectives: { headline: string | null; cta: string | null };
  vidigalOutput: VidigalPngOutputContract;
  vidigalSource: "real" | "fixture";
  visualCompositionPlan: {
    layoutArchetype: VidigalPngOutputContract["layoutArchetype"];
    headlineZone: VidigalPngOutputContract["headlineZone"];
    contrastTreatment: VidigalPngOutputContract["contrastTreatment"];
    ctaStyle: VidigalPngOutputContract["ctaStyle"];
  };
  generationPromptBase: string;
  compositionGuidance: string;
  backgroundGuard: string;
  finalImagePrompt: string;
  imageProviderThatWouldBeUsed: string | null;
  modelThatWouldBeUsed: string | null;
  quality: string | null;
  size: string | null;
  assetMatrix: DryRunAssetMatrixEntry[];
}

export interface StudioVisualDryRunResult {
  text: StudioSkillExecutionResult;
  image: StudioVisualResult | null;
  packet: StudioVisualDryRunDiagnosticPacket | null;
}

/**
 * FASE 31G §1 -- gate real do dry run: nunca ativo em Production, mesmo
 * se a env estiver presente por engano (VERCEL_ENV é decidido pelo
 * runtime da Vercel, nunca pelo cliente). Sem `LKT_IMAGE_DRY_RUN`
 * setada, o comportamento do caller (route.ts) é idêntico ao de antes
 * desta fase.
 */
export function isDryRunActive(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  const raw = process.env.LKT_IMAGE_DRY_RUN?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** FASE 31G §3 -- só tem efeito quando isDryRunActive() também é true. */
export function isFullZeroCostDryRun(): boolean {
  const raw = process.env.LKT_IMAGE_DRY_RUN_FULL_ZERO_COST?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function nowIso(): string {
  return new Date().toISOString();
}

function isVidigalOutput(value: unknown): value is VidigalPngOutputContract {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).generationPrompt === "string";
}

async function resolveProtectedAssetBytes(asset: StudioImageAsset): Promise<{ bytes: Buffer; warning?: string } | { bytes: null; warning: string }> {
  if (asset.url.startsWith("data:")) {
    const bytes = decodeImageDataUrl(asset.url);
    if (!bytes) return { bytes: null, warning: `Ativo protegido "${asset.label}" não pôde ser decodificado -- omitido desta peça (dry run).` };
    return { bytes };
  }
  const fetched = await fetchAssetSafely(asset.url);
  if (!fetched.ok || !fetched.bytes) {
    return { bytes: null, warning: `Ativo protegido "${asset.label}" não pôde ser carregado (${fetched.error ?? "erro desconhecido"}) -- peça gerada sem ele (dry run).` };
  }
  return { bytes: fetched.bytes };
}

// FASE 31G -- cópia diagnóstica da mesma tabela de image-runtime.ts
// (nunca exportada de lá, e este módulo não importa esse arquivo por
// decisão explícita de não tocá-lo). Só pra introspecção read-only do
// aspect ratio que SERIA usado -- nunca chama nenhum provider.
const FORMAT_TO_ASPECT_RATIO: Record<DesignFormat, ImageAspectRatio> = {
  feed_square: "1:1",
  story_vertical: "9:16",
  carousel: "4:5",
  banner: "1.91:1",
  ad: "1.91:1",
  thumbnail: "16:9",
  outdoor: "16:9",
  presentation: "16:9",
};

/** Read-only: nunca chama `.generate()`. Só introspecciona (via funções PURAS já exportadas pelos próprios providers) o que SERIA enviado, pro diagnostic packet (FASE 31G §6). */
function describeImageProviderPlan(prompt: string, format: DesignFormat): { providerId: string | null; model: string | null; quality: string | null; size: string | null } {
  const provider = getActiveProvider();
  if (!provider) return { providerId: null, model: null, quality: null, size: null };
  const aspectRatio = FORMAT_TO_ASPECT_RATIO[format] ?? "1:1";

  if (provider.id === "openai-images") {
    const model = process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
    // highRes nunca é passado pelo pipeline real (image-runtime.ts não envia esse campo) -- undefined aqui reproduz fielmente o comportamento real (quality:"auto").
    const built = buildOpenAIImageRequest({ model, prompt, aspectRatio, highRes: undefined, outputCount: 1 });
    if (built.ok) return { providerId: provider.id, model: built.request.model ?? model, quality: built.request.quality ?? null, size: built.request.size ?? null };
    return { providerId: provider.id, model, quality: null, size: null };
  }
  if (provider.id === "google-gemini") {
    const model = process.env.GOOGLE_IMAGE_MODEL?.trim() || DEFAULT_GOOGLE_IMAGE_MODEL;
    const size = resolveGoogleImageSize(process.env.GOOGLE_IMAGE_SIZE);
    const mappedAspect = resolveGoogleAspectRatio(aspectRatio);
    return { providerId: provider.id, model, quality: null, size: `${size} (${mappedAspect})` };
  }
  return { providerId: provider.id, model: null, quality: null, size: null };
}

export async function createStudioVisualDryRun(request: CreateStudioVisualDryRunRequest): Promise<StudioVisualDryRunResult> {
  const costedStepsNormallyPaid = [
    "vidigal_text (OpenAI Responses API, gpt-4o-mini)",
    "reference_analysis (OpenAI Responses API, gpt-4o-mini -- só quando há referências anexadas)",
    "image_generation (OpenAI Images ou Google Gemini, conforme AI_IMAGE_PROVIDER)",
  ];
  const costedStepsSkippedThisRun = ["image_generation (sempre mockado no dry run)"];

  const context = await buildStudioCreativeBusinessContext(request.db, request.companyId, request.companyName);

  const hasReferences = request.assets.references.length > 0;
  let referenceAnalysis: ReferenceAnalysisResult & { source: "real" | "skipped_zero_cost" | "not_applicable_no_references" };
  if (!hasReferences) {
    referenceAnalysis = { rules: [], warnings: [], source: "not_applicable_no_references" };
  } else if (request.fullZeroCost) {
    referenceAnalysis = { rules: [], warnings: ["Referências anexadas, mas a análise visual foi PULADA (modo zero-cost) -- normalmente custaria uma chamada OpenAI por referência."], source: "skipped_zero_cost" };
    costedStepsSkippedThisRun.push("reference_analysis (pulado -- fullZeroCost)");
  } else {
    const real = await analyzeStudioReferences(request.assets.references.map((r) => ({ url: r.url, label: r.label })));
    referenceAnalysis = { ...real, source: "real" };
  }

  const directives = parseStudioTextDirectives(request.input.freeformBrief ?? "");
  const textInput: StudioBriefInput = {
    ...request.input,
    freeformBrief: directives.headline || directives.cta ? directives.remainingBrief : request.input.freeformBrief,
  };

  let textResult: StudioSkillExecutionResult;
  let vidigalSource: "real" | "fixture";
  if (request.fullZeroCost) {
    const fixtureOutput = buildDryRunVidigalOutput(textInput);
    textResult = {
      skillId: request.skillId, skillVersion: "dry-run-fixture", runtime: "dry_run_fixture", status: "completed",
      output: fixtureOutput, warnings: ["FASE 31G: Vidigal NÃO foi chamada de verdade -- output é uma fixture determinística (fullZeroCost)."],
      generatedAt: nowIso(),
    };
    vidigalSource = "fixture";
    costedStepsSkippedThisRun.push("vidigal_text (pulado -- fullZeroCost)");
  } else {
    textResult = await executeStudioSkill({
      skillId: request.skillId,
      input: textInput,
      context,
      referenceVisualRules: referenceAnalysis.rules.length > 0 ? referenceAnalysis.rules : undefined,
    });
    vidigalSource = "real";
  }

  if (textResult.status !== "completed" || !isVidigalOutput(textResult.output)) {
    return { text: textResult, image: null, packet: null };
  }
  const output = textResult.output;

  const protectedAssets: StudioImageAsset[] = request.assets.protectedAssets.map((a) => ({ ...a, role: a.role ?? "product" }));
  const officialLogo = context.identity?.logoUrl;
  if (officialLogo && !protectedAssets.some((a) => a.url === officialLogo)) {
    protectedAssets.push({ id: "company-logo", label: "Logo oficial da Company", kind: "protected", url: officialLogo, role: "logo" });
  }

  // FASE 31G §1/4 -- MOCK do provider de imagem: nunca chama OpenAI/Google, sempre a mesma fixture determinística (sharp real, decodificável de verdade pelo compositor).
  const fixtureBackground = await buildDryRunBackgroundImage();
  const imagePlan = describeImageProviderPlan(applyBackgroundGuardPolicy(output.headlineZone ? applyCompositionGuidance(output.generationPrompt, output.headlineZone) : output.generationPrompt), request.input.format ?? "feed_square");
  const pipelineWarnings = [
    ...referenceAnalysis.warnings,
    "FASE 31G: imagem de background é uma FIXTURE gerada localmente (sharp) -- nenhuma chamada a OpenAI/Google foi feita.",
  ];

  const finalHeadline = resolveFinalText(request.input.headline, directives.headline, output.suggestedHeadline) ?? output.suggestedHeadline;
  const finalCta = resolveFinalText(request.input.cta, directives.cta, output.suggestedCta);

  const protectedAssetRoles: { assetId: string; role: StudioProtectedAssetRole }[] = protectedAssets.map((a) => ({
    assetId: a.id,
    role: a.role === "logo" ? "logo" : "product",
  }));
  const renderPlan = buildStudioRenderPlan({
    format: request.input.format ?? "feed_square",
    headline: finalHeadline,
    cta: finalCta,
    protectedAssetRoles,
    headlineZone: output.headlineZone,
    contrastTreatment: output.contrastTreatment,
    ctaStyle: output.ctaStyle,
  });
  pipelineWarnings.push(...renderPlan.renderWarnings);

  const protectedAssetBytes: ProtectedAssetBytes[] = [];
  for (const assetLayer of renderPlan.protectedAssets) {
    const source = protectedAssets.find((a) => a.id === assetLayer.assetId);
    if (!source) continue;
    const resolved = await resolveProtectedAssetBytes(source);
    if (resolved.warning) pipelineWarnings.push(resolved.warning);
    if (resolved.bytes) protectedAssetBytes.push({ assetId: assetLayer.assetId, bytes: resolved.bytes });
  }

  // Compositor REAL, sem alteração -- mesma função usada em produção (composeStudioVisual, render/compositor.ts).
  const composed = await composeStudioVisual({ backgroundBytes: fixtureBackground.bytes, renderPlan, protectedAssetBytes });

  const withComposition = output.headlineZone ? applyCompositionGuidance(output.generationPrompt, output.headlineZone) : output.generationPrompt;
  const guardedPrompt = applyBackgroundGuardPolicy(withComposition);

  const assetMatrix: DryRunAssetMatrixEntry[] = [
    ...request.assets.references.map((a) => ({
      id: a.id, label: a.label, kind: a.kind, role: a.role ?? null,
      seenBy: { vidigal: false, referenceAnalysis: hasReferences && !request.fullZeroCost, imageModel: false, compositor: false },
    })),
    ...protectedAssets.map((a) => ({
      id: a.id, label: a.label, kind: a.kind, role: a.role ?? null,
      seenBy: { vidigal: false, referenceAnalysis: false, imageModel: false, compositor: true },
    })),
  ];

  const packet: StudioVisualDryRunDiagnosticPacket = {
    dryRun: true,
    fullZeroCost: request.fullZeroCost,
    costedStepsNormallyPaid,
    costedStepsSkippedThisRun,
    userBrief: request.input,
    businessContext: context,
    referenceAnalysis,
    textDirectives: { headline: directives.headline, cta: directives.cta },
    vidigalOutput: output,
    vidigalSource,
    visualCompositionPlan: {
      layoutArchetype: output.layoutArchetype,
      headlineZone: output.headlineZone,
      contrastTreatment: output.contrastTreatment,
      ctaStyle: output.ctaStyle,
    },
    generationPromptBase: output.generationPrompt,
    compositionGuidance: withComposition,
    backgroundGuard: guardedPrompt,
    finalImagePrompt: guardedPrompt,
    imageProviderThatWouldBeUsed: imagePlan.providerId,
    modelThatWouldBeUsed: imagePlan.model,
    quality: imagePlan.quality,
    size: imagePlan.size,
    assetMatrix,
  };

  if (!composed.ok) {
    return {
      text: textResult,
      image: {
        status: "failed", providerId: "dry-run-mock", image: null, renderPlan,
        warnings: pipelineWarnings,
        error: { code: "STUDIO_RENDER_FAILED", message: composed.error },
        generatedAt: nowIso(),
      },
      packet,
    };
  }

  return {
    text: textResult,
    image: {
      status: "completed",
      providerId: "dry-run-mock",
      image: {
        url: `data:${composed.mime};base64,${composed.buffer.toString("base64")}`,
        width: composed.width,
        height: composed.height,
        mime: composed.mime,
      },
      renderPlan,
      warnings: pipelineWarnings,
      generatedAt: nowIso(),
    },
    packet,
  };
}
