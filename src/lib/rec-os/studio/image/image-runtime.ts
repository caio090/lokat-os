/**
 * Sprint REC OS Studio Image Generation MVP V0.3 — Studio Image
 * Runtime. ÚNICO arquivo do domínio Studio que importa
 * @/lib/ai/image-providers (Fase 5/7: Vidigal PNG não conhece
 * provider, e esta sprint não cria um terceiro sistema de IA -- reusa
 * a fábrica de provider já existente e nunca chamada por ninguém antes
 * desta sprint, confirmado por auditoria: getActiveProvider()/
 * isAiImageAvailable()/activeProviderLabel(), google-gemini.ts,
 * openai-images.ts).
 *
 * Capability real hoje: só text-to-image. styleReference/
 * subjectReference existem no tipo ImageGenerationInput mas nenhum dos
 * dois providers realmente os envia ao provider (confirmado lendo os
 * dois arquivos) -- por isso referenceImages/imageEditing/
 * maskEditing/transparentBackground/protectedAssetSupport são sempre
 * false aqui. Assets protegidos NUNCA são enviados ao provider (nunca
 * arriscar regenerar um logo/produto oficial) -- a imagem gerada é
 * sempre só o entorno/cenário, nunca uma tentativa de recriar o ativo;
 * isso é reportado como warning explícito, nunca alterado em silêncio.
 */
import { getActiveProvider, isAiImageAvailable, activeProviderLabel } from "@/lib/ai/image-providers";
import type { ImageAspectRatio } from "@/lib/ai/image-providers/types";
import type { DesignFormat } from "@/lib/providers/shared/types";
import type { StudioImageCapabilities, StudioImageGenerationRequest, StudioImageGenerationResult } from "./types";
import { applyBackgroundGuardPolicy } from "./background-guard";
import { applyCompositionGuidance } from "./composition-guidance";

const IMAGE_GENERATION_TIMEOUT_MS = 45_000;

/**
 * Fase 19 — mapeia os formatos do Studio para o ImageAspectRatio real
 * do provider. `outdoor` (3:2) e `presentation`/`thumbnail` (16:9) não
 * têm equivalente exato no provider -- aproximados para "16:9" (nunca
 * distorce a imagem, só usa a proporção suportada mais próxima).
 */
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

export function getStudioImageCapabilities(): StudioImageCapabilities {
  const available = isAiImageAvailable();
  return {
    providerId: available ? activeProviderLabel() : null,
    available,
    supports: {
      textToImage: available,
      referenceImages: false,
      imageEditing: false,
      maskEditing: false,
      transparentBackground: false,
      protectedAssetSupport: false,
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Ponto único de geração visual. Nunca lança -- toda falha vira um
 * StudioImageGenerationResult com status/error explícitos (mesmo
 * princípio do executor textual).
 */
export async function generateStudioImage(request: StudioImageGenerationRequest): Promise<StudioImageGenerationResult> {
  const warnings: string[] = [];
  if (request.protectedAssets.length > 0) {
    warnings.push(
      `${request.protectedAssets.length} ativo(s) protegido(s) identificado(s) -- não enviados ao provider de imagem ` +
      "(o provider não suporta preservação pixel-perfect via prompt). Esta etapa gera só o entorno/cenário -- " +
      "o pixel original do ativo protegido é composto por cima depois, sem redesenho (ver render/compositor.ts)."
    );
  }
  if (request.references.length > 0) {
    warnings.push(
      "Referências visuais anexadas não são enviadas diretamente a este provider " +
      "(o provider atual não suporta image-to-image/reference images) -- suas regras de composição/atmosfera, " +
      "quando extraídas com sucesso, já influenciam o texto do prompt de geração (ver StudioReferenceAnalysis)."
    );
  }

  const provider = getActiveProvider();
  if (!provider || !provider.isAvailable()) {
    return {
      status: "runtime_unavailable", providerId: null, image: null, warnings,
      error: { code: "STUDIO_IMAGE_PROVIDER_UNAVAILABLE", message: "Nenhum provider de geração de imagem está configurado no servidor." },
      generatedAt: nowIso(),
    };
  }

  const aspectRatio = FORMAT_TO_ASPECT_RATIO[request.format] ?? "1:1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_GENERATION_TIMEOUT_MS);
  try {
    // Nunca envia protectedAssets/references ao provider hoje -- só o
    // prompt de texto (Vidigal já o escreve descrevendo só o entorno
    // quando há Asset Lock, ver V0.2.1). Prompt 20 -- se headlineZone
    // foi decidido, reserva negative space na cena ANTES da política
    // final (Fase 19/20: nunca gera o fundo primeiro pra só depois
    // torcer por espaço sobrando). Prompt 13 -- Background Guard
    // (Defesa 1): sempre anexa a política "sem texto/logo/marca
    // d'água/colagem" como a ÚLTIMA instrução, independente do que a
    // Vidigal escreveu (defesa em profundidade contra contaminação do
    // background).
    const withComposition = request.headlineZone ? applyCompositionGuidance(request.generationPrompt, request.headlineZone) : request.generationPrompt;
    const guardedPrompt = applyBackgroundGuardPolicy(withComposition);
    const result = await provider.generate({
      prompt: guardedPrompt, aspectRatio, outputCount: 1,
      // FASE 31K -- só presente quando já autorizado/validado na rota (Super Admin + flag); ausente em todo request normal.
      highRes: request.imageOverride?.highRes,
      modelOverride: request.imageOverride?.model,
    });
    if (!result.success || !result.images || result.images.length === 0) {
      return {
        status: "failed", providerId: provider.id, image: null, warnings,
        error: { code: "STUDIO_IMAGE_GENERATION_FAILED", message: result.error ?? "Não foi possível gerar a imagem no momento." },
        generatedAt: nowIso(),
        diagnostics: result.diagnostics,
      };
    }
    const img = result.images[0];
    return {
      status: "completed", providerId: provider.id,
      image: { url: img.url, width: img.width, height: img.height },
      warnings, generatedAt: nowIso(),
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    console.warn("[studio/image-runtime] geração indisponível", { timedOut });
    return {
      status: "failed", providerId: provider.id, image: null, warnings,
      error: { code: "STUDIO_IMAGE_GENERATION_FAILED", message: timedOut ? "A geração de imagem excedeu o tempo limite." : "O provider de imagem está indisponível no momento." },
      generatedAt: nowIso(),
    };
  } finally {
    clearTimeout(timer);
  }
}
