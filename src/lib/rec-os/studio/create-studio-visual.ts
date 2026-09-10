/**
 * Sprint REC OS Studio Image Generation MVP V0.3 / Prompt 01 (Studio
 * Visual Engine) — orquestração server-side única: texto (Vidigal) +
 * DNA da Company + análise de referências + geração de background +
 * composição determinística (produto/logo protegidos + headline/CTA
 * reais), num único ponto de entrada para a rota da API.
 *
 * Pipeline completo (Prompt 01):
 *   USER BRIEF + referências
 *     -> StudioReferenceAnalysis (regras de composição, best-effort)
 *     -> Vidigal Text Runtime (direção + generationPrompt + texto sugerido)
 *     -> StudioRenderPlan (layout determinístico, clampado)
 *     -> Studio Image Runtime (background via provider real)
 *     -> Compositor (Sharp + resvg-js: background + ativos protegidos
 *        intactos + headline/CTA renderizados de verdade)
 *     -> StudioVisualResult (peça final).
 *
 * `image` no retorno é sempre a PEÇA FINAL composta -- nunca o
 * background cru do provider (esse fica só internamente, nunca
 * exposto pela API/UI, para o contrato continuar simples).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeStudioSkill } from "./execute";
import type { StudioSkillExecutionResult } from "./runtime";
import type { StudioBriefInput } from "./types";
import { buildStudioCreativeBusinessContext } from "./business-context";
import { generateStudioImage } from "./image/image-runtime";
import type { StudioImageAsset } from "./image/types";
import type { VidigalPngOutputContract } from "./skills/vidigal-png/output";
import { analyzeStudioReferences } from "./render/reference-analysis";
import { buildStudioRenderPlan } from "./render/render-plan";
import { composeStudioVisual, type ProtectedAssetBytes } from "./render/compositor";
import { fetchAssetSafely } from "./render/asset-fetch";
import { decodeImageDataUrl } from "./render/data-url";
import type { StudioProtectedAssetRole, StudioVisualResult } from "./render/types";
import { parseStudioTextDirectives, resolveFinalText } from "./text-directives";

export interface CreateStudioVisualRequest {
  skillId: string;
  input: StudioBriefInput;
  /** Já resolvido/autorizado pelo caller (rota) -- nunca o valor bruto do cliente. `null` = Free Creation Mode. */
  companyId: string | null;
  companyName: string | null;
  assets: { references: StudioImageAsset[]; protectedAssets: StudioImageAsset[] };
  db: SupabaseClient;
  /** FASE 31K -- override de model/quality já autorizado/validado pela rota (Super Admin + flag). Ausente = comportamento normal. */
  imageOverride?: { model?: string; highRes?: boolean };
}

export interface StudioVisualCreationResult {
  text: StudioSkillExecutionResult;
  /** `null` quando o texto não completou -- nunca tenta gerar imagem sobre uma direção que falhou. */
  image: StudioVisualResult | null;
}

function isVidigalOutput(value: unknown): value is VidigalPngOutputContract {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).generationPrompt === "string";
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Busca os bytes de um asset protegido -- data: URL (upload efêmero do
 *  usuário) decodifica direto; https: (hoje só o logo oficial resolvido
 *  a partir de onboarding_profiles) passa pelo fetch SSRF-safe. Nunca
 *  lança -- asset que não puder ser resolvido é omitido com warning. */
async function resolveProtectedAssetBytes(asset: StudioImageAsset): Promise<{ bytes: Buffer; warning?: string } | { bytes: null; warning: string }> {
  if (asset.url.startsWith("data:")) {
    const bytes = decodeImageDataUrl(asset.url);
    if (!bytes) return { bytes: null, warning: `Ativo protegido "${asset.label}" não pôde ser decodificado -- omitido desta peça.` };
    return { bytes };
  }
  const fetched = await fetchAssetSafely(asset.url);
  if (!fetched.ok || !fetched.bytes) {
    return { bytes: null, warning: `Ativo protegido "${asset.label}" não pôde ser carregado (${fetched.error ?? "erro desconhecido"}) -- peça gerada sem ele.` };
  }
  return { bytes: fetched.bytes };
}

async function resolveBackgroundBytes(imageUrl: string): Promise<Buffer | null> {
  if (imageUrl.startsWith("data:")) return decodeImageDataUrl(imageUrl);
  const fetched = await fetchAssetSafely(imageUrl);
  return fetched.ok && fetched.bytes ? fetched.bytes : null;
}

export async function createStudioVisual(request: CreateStudioVisualRequest): Promise<StudioVisualCreationResult> {
  const context = await buildStudioCreativeBusinessContext(request.db, request.companyId, request.companyName);

  const referenceAnalysis = await analyzeStudioReferences(
    request.assets.references.map((r) => ({ url: r.url, label: r.label })),
  );

  // Prompt 03 (P1) -- reconhece "Headline: ..."/"CTA: ..." dentro do
  // briefing livre de forma determinística (nunca via IA), ANTES de
  // chamar a Vidigal, para que ela raciocine sobre o restante do
  // pedido em vez da sintaxe da directive.
  const directives = parseStudioTextDirectives(request.input.freeformBrief ?? "");
  const textInput: StudioBriefInput = {
    ...request.input,
    freeformBrief: directives.headline || directives.cta ? directives.remainingBrief : request.input.freeformBrief,
  };

  const textResult = await executeStudioSkill({
    skillId: request.skillId,
    input: textInput,
    context,
    referenceVisualRules: referenceAnalysis.rules.length > 0 ? referenceAnalysis.rules : undefined,
  });

  if (textResult.status !== "completed" || !isVidigalOutput(textResult.output)) {
    return { text: textResult, image: null };
  }
  const output = textResult.output;

  // Fase 15 (V0.3) -- logo oficial da Company (quando existir DNA real)
  // é SEMPRE tratada como PROTECTED e com role "logo", automaticamente.
  const protectedAssets: StudioImageAsset[] = request.assets.protectedAssets.map((a) => ({ ...a, role: a.role ?? "product" }));
  const officialLogo = context.identity?.logoUrl;
  if (officialLogo && !protectedAssets.some((a) => a.url === officialLogo)) {
    protectedAssets.push({ id: "company-logo", label: "Logo oficial da Company", kind: "protected", url: officialLogo, role: "logo" });
  }

  const backgroundResult = await generateStudioImage({
    generationPrompt: output.generationPrompt,
    format: request.input.format ?? "feed_square",
    references: request.assets.references,
    protectedAssets,
    // Prompt 20 -- negative space reservado na cena a partir do plano de composição real da Vidigal (nunca gera o fundo primeiro e só depois torce por espaço sobrando).
    headlineZone: output.headlineZone,
    imageOverride: request.imageOverride,
  });

  const pipelineWarnings = [...referenceAnalysis.warnings, ...backgroundResult.warnings];

  if (backgroundResult.status !== "completed" || !backgroundResult.image) {
    return {
      text: textResult,
      image: {
        status: backgroundResult.status, providerId: backgroundResult.providerId, image: null, renderPlan: null,
        warnings: pipelineWarnings,
        error: backgroundResult.error,
        generatedAt: nowIso(),
        diagnostics: backgroundResult.diagnostics,
      },
    };
  }

  // Texto final renderizado -- precedência obrigatória (Prompt 03 P1):
  // (1) campo estruturado do usuário > (2) directive determinística
  // extraída do freeformBrief > (3) sugestão da Vidigal. (3) NUNCA
  // sobrescreve (1)/(2); DNA/tom de marca nunca participa desta escolha.
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
    // Prompt 20 -- plano de composição real da Vidigal decide posição/tratamento visual, nunca sempre o mesmo layout fixo.
    headlineZone: output.headlineZone,
    contrastTreatment: output.contrastTreatment,
    ctaStyle: output.ctaStyle,
  });
  pipelineWarnings.push(...renderPlan.renderWarnings);

  const backgroundBytes = await resolveBackgroundBytes(backgroundResult.image.url);
  if (!backgroundBytes) {
    return {
      text: textResult,
      image: {
        status: "failed", providerId: backgroundResult.providerId, image: null, renderPlan,
        warnings: pipelineWarnings,
        error: { code: "STUDIO_RENDER_FAILED", message: "O background gerado não pôde ser recuperado para composição." },
        generatedAt: nowIso(),
      },
    };
  }

  const protectedAssetBytes: ProtectedAssetBytes[] = [];
  for (const assetLayer of renderPlan.protectedAssets) {
    const source = protectedAssets.find((a) => a.id === assetLayer.assetId);
    if (!source) continue;
    const resolved = await resolveProtectedAssetBytes(source);
    if (resolved.warning) pipelineWarnings.push(resolved.warning);
    if (resolved.bytes) protectedAssetBytes.push({ assetId: assetLayer.assetId, bytes: resolved.bytes });
  }

  const composed = await composeStudioVisual({ backgroundBytes, renderPlan, protectedAssetBytes });
  if (!composed.ok) {
    return {
      text: textResult,
      image: {
        status: "failed", providerId: backgroundResult.providerId, image: null, renderPlan,
        warnings: pipelineWarnings,
        error: { code: "STUDIO_RENDER_FAILED", message: composed.error },
        generatedAt: nowIso(),
      },
    };
  }

  return {
    text: textResult,
    image: {
      status: "completed",
      providerId: backgroundResult.providerId,
      image: {
        url: `data:${composed.mime};base64,${composed.buffer.toString("base64")}`,
        width: composed.width,
        height: composed.height,
        mime: composed.mime,
      },
      renderPlan,
      warnings: pipelineWarnings,
      generatedAt: nowIso(),
      diagnostics: backgroundResult.diagnostics,
    },
  };
}
