/**
 * Provedor: OpenAI Images (GPT Image)
 *
 * Variáveis necessárias para ativar:
 *   OPENAI_API_KEY      — chave da conta central da LOKAT OS (nunca expor ao cliente)
 *   OPENAI_IMAGE_MODEL   — ex: "gpt-image-2" (default) ou outro modelo GPT Image real
 *
 * Prompt 09 (Studio Image Provider Compatibility) — reescrito para usar
 * o SDK oficial (`client.images.generate()`, tipado, satisfaz
 * `ImageGenerateParamsNonStreaming` sem `as any`) em vez de um
 * `fetch()` cru com corpo hardcoded. A compatibilidade por família de
 * modelo fica centralizada em openai-image-compat.ts, nunca espalhada
 * em `if (model.startsWith(...))` neste arquivo.
 *
 * Prompt 11 (GPT-Image-2 Production Migration) — segundo incidente
 * real de Production (`dpl_EHFbxtcH6Czf2xFfmmDrb9UzmTtC`): o default
 * hardcoded `"dall-e-3"` (usado porque `OPENAI_IMAGE_MODEL` não estava
 * configurada) foi rejeitado pela API real com
 * `code: "invalid_value", param: "model"` -- dall-e-2/dall-e-3 foram
 * removidos da API da OpenAI. Novo default: `DEFAULT_OPENAI_IMAGE_MODEL`
 * (`"gpt-image-2"`, definido em openai-image-compat.ts -- fonte
 * canônica única, nunca duplicada). `resolveOpenAIImageModelFamily`
 * reconhece `dall-e-2`/`dall-e-3` explicitamente como `"removed"` e
 * `buildOpenAIImageRequest` nunca constrói um request pra eles --
 * nenhum fallback silencioso de um modelo removido pra outro modelo.
 */

import OpenAI from "openai";
import type { ImageProvider, ImageGenerationInput, ImageGenerationOutput } from "./types";
import { buildOpenAIImageRequest, DEFAULT_OPENAI_IMAGE_MODEL } from "./openai-image-compat";
import { normalizeOpenAIImageResponse, mapOpenAIImageErrorToSafeMessage, logOpenAIImageError } from "./openai-image-response";

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
/**
 * Prompt 11, Fase 17/18 — orçamento do pipeline dentro do teto real da
 * rota (maxDuration, ver route.ts).
 *
 * FASE 31K (Sunburst Studio QA Readiness) — subiu de 42s pra 120s.
 * Decisão de arquitetura já tomada na FASE 31J: Hobby + Fluid Compute
 * suporta até 300s (sem custo adicional); `maxDuration` da rota subiu
 * junto pra 180s (route.ts). Orçamento validado matematicamente:
 * referência(até 20s) + Vidigal(15s) + esta chamada(120s) +
 * compositor(~1s) + overhead de auth/resposta ≈ 158s, com ~22s de
 * margem real abaixo do teto de 180s. 120s dá espaço real pro
 * gpt-image-2.5-sunburst (observado em benchmark real: 77,9s
 * client-side) terminar sem abortar prematuramente, o que o valor
 * anterior de 42s garantidamente faria.
 */
const IMAGE_TIMEOUT_MS = 120_000;

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: API_KEY, timeout: IMAGE_TIMEOUT_MS });
  return cachedClient;
}

export const OpenAIImagesProvider: ImageProvider = {
  id: "openai-images",
  label: "OpenAI Images",

  isAvailable(): boolean {
    return !!API_KEY;
  },

  async generate(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    if (!API_KEY) {
      return { success: false, error: "OPENAI_API_KEY não configurada. Geração desativada." };
    }

    // FASE 31K §6/7 -- override só tem efeito quando explicitamente
    // enviado (já autorizado e validado na rota, Super Admin + flag).
    // Ausente (todo usuário normal, sempre) -> MODEL de sempre, nenhuma
    // mudança de comportamento.
    const model = input.modelOverride?.trim() || MODEL;

    const built = buildOpenAIImageRequest({
      model,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio ?? "1:1",
      highRes: input.highRes,
      outputCount: input.outputCount,
    });
    if (!built.ok) {
      // Prompt 11 -- `built.error` é a mensagem sanitizada (segura pro
      // cliente); `internalDetail` é só logado aqui, nunca devolvido.
      console.warn("[image-providers/openai] modelo de imagem não construiu request", { family: built.family, internalDetail: built.internalDetail });
      return { success: false, error: built.error };
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      const response = await getClient().images.generate(built.request, { signal: controller.signal });
      const durationMs = Date.now() - startedAt;
      const usage = response.usage;
      const normalized = normalizeOpenAIImageResponse(response, built.request.size);
      if (!normalized.ok) {
        return { success: false, error: normalized.error, diagnostics: { model, quality: built.request.quality, size: built.request.size, durationMs } };
      }
      return {
        success: true,
        images: normalized.images,
        providerRaw: { model, family: built.family, size: built.request.size, quality: built.request.quality },
        // FASE 31K §5 -- usage real nunca mais descartado (antes só existia em providerRaw incompleto, sem usage nenhum).
        diagnostics: {
          model, quality: built.request.quality, size: built.request.size, durationMs,
          usage: usage ? { input_tokens: usage.input_tokens, input_tokens_details: usage.input_tokens_details, output_tokens: usage.output_tokens, total_tokens: usage.total_tokens, output_tokens_details: usage.output_tokens_details } : undefined,
        },
      };
    } catch (error) {
      logOpenAIImageError(error);
      const durationMs = Date.now() - startedAt;
      // FASE 31K §4 -- o SDK lança OpenAI.APIUserAbortError (subclasse
      // real de APIError) quando o AbortSignal dispara -- nunca um
      // Error nativo com .name==="AbortError". O check antigo nunca
      // era verdadeiro de fato; a classificação de timeout se perdia,
      // caindo na mensagem genérica de mapOpenAIImageErrorToSafeMessage.
      const timedOut = error instanceof OpenAI.APIUserAbortError;
      return {
        success: false,
        error: timedOut ? "A geração de imagem excedeu o tempo limite." : mapOpenAIImageErrorToSafeMessage(error),
        diagnostics: { model, quality: built.request.quality, size: built.request.size, durationMs, errorCategory: timedOut ? "UPSTREAM_TIMEOUT" : undefined },
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
