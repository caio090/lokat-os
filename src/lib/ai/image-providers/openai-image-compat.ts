/**
 * Prompt 09/11 (Studio Image Provider Compatibility / GPT-Image-2
 * Production Migration) — compatibilidade real entre o Studio e as
 * famílias de modelo de imagem da OpenAI.
 *
 * Prompt 09 corrigiu o incidente de `response_format` (nunca mais
 * enviado, pra nenhuma família -- ver `buildOpenAIImageRequest`).
 *
 * Prompt 11 corrigiu um segundo incidente real de Production
 * (`dpl_EHFbxtcH6Czf2xFfmmDrb9UzmTtC`): HTTP 400,
 * `type: "image_generation_user_error"`, `code: "invalid_value"`,
 * `param: "model"`, modelo enviado `"dall-e-3"` -- o próprio default
 * hardcoded do código (`OPENAI_IMAGE_MODEL` não configurada em
 * Production). Causa raiz: **dall-e-2 e dall-e-3 foram removidos da
 * API da OpenAI** -- não é mais um problema de parâmetro incompatível
 * dentro de uma família válida, é a família inteira que deixou de
 * existir. O modelo atual recomendado é `gpt-image-2`.
 *
 * Os tipos do SDK instalado (`openai@6.45.0`) ainda incluem
 * `'dall-e-2' | 'dall-e-3'` no union `ImageModel` (surface de tipos
 * não foi atualizada pra remover os nomes legados, mesmo com a API
 * real já rejeitando-os) -- por isso `resolveOpenAIImageModelFamily`
 * reconhece esses dois IDs explicitamente como `"removed"` (nunca
 * `"unknown"`), pra devolver um erro específico e útil em vez de um
 * genérico "modelo não reconhecido". Nenhum fallback silencioso de
 * "removed"/"unknown" pra um modelo diferente -- ambos falham
 * explicitamente, nunca chamam o provider (ver buildOpenAIImageRequest).
 */
import type { ImageGenerateParamsNonStreaming } from "openai/resources/images";
import type { ImageAspectRatio } from "./types";

/**
 * Fonte canônica única do modelo default -- nunca duplicar essa
 * string em outro arquivo. `gpt-image-2` é o modelo recomendado atual
 * (documentação oficial da OpenAI: "state-of-the-art image generation
 * model"), sucessor direto dos modelos DALL-E removidos da API.
 */
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2";

export type OpenAIImageModelFamily = "gpt_image" | "removed" | "unknown";

/**
 * Determinístico, sem chamada de rede. `unknown` nunca ganha
 * compatibilidade inventada -- ver buildOpenAIImageRequest. `removed`
 * é reconhecido explicitamente (não cai em `unknown`) só pra permitir
 * uma mensagem de erro melhor -- o comportamento (nunca chamar o
 * provider) é o mesmo dos dois casos.
 */
export function resolveOpenAIImageModelFamily(model: string): OpenAIImageModelFamily {
  if (model === "dall-e-2" || model === "dall-e-3") return "removed";
  // gpt-image-1, gpt-image-1-mini, gpt-image-1.5, gpt-image-2,
  // gpt-image-2-*, chatgpt-image-latest -- todos os IDs GPT Image
  // reais do union `ImageModel` do SDK instalado.
  if (/^(gpt-image-|chatgpt-image-)/.test(model)) return "gpt_image";
  return "unknown";
}

/**
 * Tamanhos reais aceitos pela família GPT Image
 * (node_modules/openai/resources/images.d.ts, ImageGenerateParamsBase.size)
 * -- nunca um valor inventado. `gpt-image-2`/`gpt-image-2-2026-04-21`
 * também aceitam WIDTHxHEIGHT arbitrário, mas o Studio só precisa dos
 * presets padrão (o compositor já resolve pra 1080x{1080,1350,1920}
 * depois via `fit:"cover"` -- ver render/compositor.ts -- o background
 * é só um ponto de partida, nunca é exigido que o provider gere
 * exatamente essas dimensões finais; "cover" corta o excedente sem
 * NUNCA distorcer, então quanto mais perto a proporção do background
 * estiver da proporção final, melhor o enquadramento resultante).
 *
 * A API só tem 3 formas discretas (1.0 / 0.667 / 1.5, width/height) --
 * cada ImageAspectRatio usa a mais PRÓXIMA numericamente, nunca uma
 * escolha arbitrária:
 *   1:1     = 1.0   -> 1024x1024 (1.0)   exata
 *   9:16    = 0.5625-> 1024x1536 (0.667) mais próxima (dist. 0.104 vs 0.4375 do quadrado)
 *   16:9    = 1.778 -> 1536x1024 (1.5)   mais próxima (dist. 0.278 vs 0.778 do quadrado)
 *   1.91:1  = 1.91  -> 1536x1024 (1.5)   mais próxima (única opção >1.0 disponível)
 *   4:5     = 0.8   -> 1024x1536 (0.667) mais próxima (dist. 0.133 vs 0.2 do quadrado)
 *
 * FASE 31H.2 -- "4:5" estava mapeado pra "1024x1024" (quadrado, dist.
 * 0.2) antes desta fase: um bug real, não uma escolha defensável --
 * 0.667 (retrato) é numericamente mais perto de 0.8 que 1.0 é.
 * Confirmado em Production (benchmark real: pedido aspectRatio=4:5,
 * devolvido pelo provider como 1024x1024) antes desta correção.
 */
const GPT_IMAGE_SIZE_MAP: Record<ImageAspectRatio, ImageGenerateParamsNonStreaming["size"]> = {
  "1:1": "1024x1024",
  "9:16": "1024x1536",
  "16:9": "1536x1024",
  "4:5": "1024x1536",
  "1.91:1": "1536x1024",
};

export interface BuildOpenAIImageRequestParams {
  model: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  highRes?: boolean;
  outputCount?: number;
}

export type BuildOpenAIImageRequestResult =
  | { ok: true; family: "gpt_image"; request: ImageGenerateParamsNonStreaming }
  | { ok: false; family: "removed" | "unknown"; error: string; internalDetail: string };

function clampCount(count: number | undefined, max: number): number {
  return Math.min(Math.max(count ?? 1, 1), max);
}

/**
 * Constrói o request pra `client.images.generate()` contendo SOMENTE
 * os parâmetros válidos pra família do modelo -- satisfaz os tipos do
 * SDK (nenhum `as any`/`as unknown as`), nunca `response_format`
 * (Prompt 09), nunca um modelo removido da API (Prompt 11).
 *
 * Request MÍNIMO de propósito (Prompt 11, Fase 09): só os parâmetros
 * que o Studio realmente precisa controlar. `quality: "auto"` por
 * padrão (não "high") -- decisão consciente de custo/latência (Fase
 * 16); `highRes` (pedido explícito de alta qualidade) usa "high".
 */
export function buildOpenAIImageRequest(params: BuildOpenAIImageRequestParams): BuildOpenAIImageRequestResult {
  const family = resolveOpenAIImageModelFamily(params.model);

  if (family === "removed") {
    return {
      ok: false,
      family: "removed",
      error: "O modelo de geração de imagem configurado não está disponível.",
      internalDetail: `configured OpenAI image model has been removed from the API: "${params.model}" (dall-e-2/dall-e-3 removidos -- configure OPENAI_IMAGE_MODEL para um modelo GPT Image atual, ex.: "${DEFAULT_OPENAI_IMAGE_MODEL}")`,
    };
  }
  if (family === "unknown") {
    return {
      ok: false,
      family: "unknown",
      error: "O modelo de geração de imagem configurado não está disponível.",
      internalDetail: `unrecognized OpenAI image model: "${params.model}" -- nenhuma compatibilidade foi assumida`,
    };
  }

  const request: ImageGenerateParamsNonStreaming = {
    model: params.model,
    prompt: params.prompt,
    size: GPT_IMAGE_SIZE_MAP[params.aspectRatio] ?? "1024x1024",
    quality: params.highRes ? "high" : "auto",
    n: clampCount(params.outputCount, 10),
    // Nunca style (só dall-e-3, removido), nunca response_format (ver
    // topo do arquivo), nunca background/moderation/output_format
    // (Studio não precisa controlar -- Fase 09, request mínimo).
  };
  return { ok: true, family, request };
}
