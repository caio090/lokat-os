/**
 * Provedor: Google Gemini — geração nativa de imagem (Gemini 3 Pro
 * Image, "Nano Banana Pro").
 *
 * Prompt 31 (Google Image Provider Migration) — substitui a
 * implementação anterior (Imagen 3, `imagen-3.0-generate-001`,
 * endpoint `:predict`, obsoleto/nunca ativado em Production real) por
 * `models/{model}:generateContent`, a API real do Gemini pra geração
 * de imagem (`generationConfig.imageConfig`). Nenhuma mudança na
 * arquitetura externa do Studio: mesma interface `ImageProvider`,
 * mesmo `AI_IMAGE_PROVIDER=google` seleciona este arquivo via
 * index.ts (nunca um provider paralelo "nano-banana").
 *
 * Variáveis necessárias para ativar:
 *   GOOGLE_GEMINI_API_KEY — chave da conta central da LOKAT OS (nunca exposta ao cliente, nunca logada)
 *   GOOGLE_IMAGE_MODEL    — opcional, ex.: "gemini-3-pro-image" (default)
 *   GOOGLE_IMAGE_SIZE     — opcional, "1K"|"2K"|"4K" (default "2K" -- FASE 6: preparado pra Draft/Final futuro, sem lógica espalhada)
 *
 * FASE 8/9 (Asset Lock/referências) -- este provider nunca recebe
 * protectedAssets/references: a interface `ImageGenerationInput` já
 * não os expõe (mesma limitação documentada em image/types.ts), e
 * este arquivo não muda isso. O compositor (render/compositor.ts,
 * intocado nesta migração) continua aplicando ativos protegidos por
 * cima, depois, pixel a pixel.
 */
import type { ImageProvider, ImageGenerationInput, ImageGenerationOutput } from "./types";
import { buildGeminiImageRequestBody, buildGeminiGenerateContentUrl, resolveGoogleImageSize, DEFAULT_GOOGLE_IMAGE_MODEL } from "./google-gemini-compat";
import { normalizeGeminiImageResponse, mapGeminiHttpErrorToSafeMessage, logGeminiImageError } from "./google-gemini-response";

const API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const MODEL = process.env.GOOGLE_IMAGE_MODEL?.trim() || DEFAULT_GOOGLE_IMAGE_MODEL;
const IMAGE_SIZE = resolveGoogleImageSize(process.env.GOOGLE_IMAGE_SIZE);
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Mesmo orçamento da OpenAI (openai-images.ts) -- ambos os providers dividem o mesmo teto de rota (maxDuration=60s, route.ts, intocado nesta migração). */
const IMAGE_TIMEOUT_MS = 42_000;

export const GoogleGeminiProvider: ImageProvider = {
  id: "google-gemini",
  label: "Google Gemini (Nano Banana Pro)",

  isAvailable(): boolean {
    return Boolean(API_KEY);
  },

  async generate(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    if (!API_KEY) {
      return { success: false, error: "GOOGLE_GEMINI_API_KEY não configurada. Geração desativada." };
    }

    const aspectRatio = input.aspectRatio ?? "1:1";
    // FASE 7 -- transporta input.prompt (generationPrompt + composition-guidance + background-guard, já montados por image-runtime.ts) sem reescrever.
    const body = buildGeminiImageRequestBody({ prompt: input.prompt, aspectRatio, imageSize: IMAGE_SIZE });
    const url = buildGeminiGenerateContentUrl(API_BASE, MODEL);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch {
        return { success: false, error: response.ok ? "Nenhuma imagem retornada pelo provider." : "O provider de imagem está indisponível no momento." };
      }

      if (!response.ok) {
        logGeminiImageError(response.status, parsedBody);
        return { success: false, error: mapGeminiHttpErrorToSafeMessage(response.status, parsedBody) };
      }

      const normalized = await normalizeGeminiImageResponse(parsedBody);
      if (!normalized.ok) {
        return { success: false, error: normalized.error };
      }

      return {
        success: true,
        images: normalized.images.map((img) => ({ url: img.url, width: img.width, height: img.height })),
        providerRaw: {
          provider: "google", model: MODEL,
          requestedAspectRatio: body.generationConfig.imageConfig.aspectRatio,
          requestedImageSize: IMAGE_SIZE,
          mimeType: normalized.images[0]?.mimeType,
        },
      };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      console.warn("[image-providers/google] falha na geração de imagem", { timedOut });
      return { success: false, error: timedOut ? "A geração de imagem excedeu o tempo limite." : "O provider de imagem está indisponível no momento." };
    } finally {
      clearTimeout(timer);
    }
  },
};
