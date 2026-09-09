/**
 * Prompt 31 (Google Image Provider Migration) — compatibilidade entre
 * o Studio e o modelo de imagem do Google. Auditoria (Prompt 30)
 * confirmou que a implementação anterior estava sobre Imagen 3
 * (`imagen-3.0-generate-001`, endpoint `:predict`) -- caminho
 * obsoleto. Migrado para Gemini 3 Pro Image ("Nano Banana Pro") via
 * `models/{model}:generateContent`, mesma família de API já usada
 * (padrão REST documentado do Google: `contents[].parts[].text` +
 * `generationConfig.imageConfig.{aspectRatio,imageSize,imageOutputOptions}`).
 *
 * Nenhum SDK do Google importado aqui (nem em google-gemini.ts) --
 * `fetch()` cru, mesmo princípio de "provider sem dependência extra"
 * já usado pela OpenAI (SDK oficial lá porque já era dependência do
 * projeto; aqui não há SDK do Gemini instalado, e instalar um só pra
 * isto infla o escopo pedido nesta migração).
 *
 * Puro, sem I/O -- só decide o QUE enviar, nunca envia nada (mesmo
 * padrão de openai-image-compat.ts).
 */
import type { ImageAspectRatio } from "./types";

/** Fonte canônica única do modelo default -- nunca duplicar essa string em outro arquivo. */
export const DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-3-pro-image";

export type GoogleImageSize = "1K" | "2K" | "4K";
/** FASE 6 -- padrão de produção inicial; Draft/Final global fica pra depois (fora de escopo deste prompt). */
export const DEFAULT_GOOGLE_IMAGE_SIZE: GoogleImageSize = "2K";
const VALID_IMAGE_SIZES: readonly GoogleImageSize[] = ["1K", "2K", "4K"];

/** Nunca lança em valor inválido de env -- cai pro default, nunca um valor inventado/silencioso além dos 3 documentados. */
export function resolveGoogleImageSize(raw: string | undefined): GoogleImageSize {
  const trimmed = raw?.trim().toUpperCase();
  if (trimmed && (VALID_IMAGE_SIZES as readonly string[]).includes(trimmed)) return trimmed as GoogleImageSize;
  return DEFAULT_GOOGLE_IMAGE_SIZE;
}

/**
 * FASE 5 -- aspect ratios reais suportados pelo Gemini 3 Pro Image
 * ("1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9",
 * documentação oficial). O Studio só usa os 5 valores de
 * `ImageAspectRatio` -- todos com equivalente EXATO, exceto "1.91:1"
 * (usado por banner/ad), que não tem correspondente direto: aproxima
 * pra "16:9" (mesmo princípio já documentado em image-runtime.ts pra
 * outdoor/presentation/thumbnail -- "nunca distorce a imagem, só usa a
 * proporção suportada mais próxima"). Nunca trata aspectRatio como
 * metadata pós-geração -- o valor mapeado aqui é o que realmente vai
 * no request (corrige o problema real da auditoria: width/height fixos).
 */
const GOOGLE_ASPECT_RATIO_MAP: Record<ImageAspectRatio, string> = {
  "1:1": "1:1",
  "4:5": "4:5",
  "9:16": "9:16",
  "16:9": "16:9",
  "1.91:1": "16:9",
};

export function resolveGoogleAspectRatio(aspectRatio: ImageAspectRatio): string {
  return GOOGLE_ASPECT_RATIO_MAP[aspectRatio] ?? "1:1";
}

export interface GeminiGenerateContentRequestBody {
  contents: { role: "user"; parts: { text: string }[] }[];
  generationConfig: {
    imageConfig: {
      aspectRatio: string;
      imageSize: GoogleImageSize;
      imageOutputOptions: { mimeType: "image/png" };
    };
  };
}

export interface BuildGeminiImageRequestParams {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  imageSize?: GoogleImageSize;
}

/**
 * FASE 7 -- transporta o prompt recebido de image-runtime.ts (que já
 * inclui composition-guidance + background-guard) SEM reescrevê-lo
 * conceitualmente -- só o texto exato, dentro de `contents[0].parts[0].text`.
 * FASE 8 -- nunca inclui protectedAssets/references aqui: esta função
 * nem os recebe como parâmetro.
 */
export function buildGeminiImageRequestBody(params: BuildGeminiImageRequestParams): GeminiGenerateContentRequestBody {
  return {
    contents: [{ role: "user", parts: [{ text: params.prompt }] }],
    generationConfig: {
      imageConfig: {
        aspectRatio: resolveGoogleAspectRatio(params.aspectRatio),
        imageSize: params.imageSize ?? DEFAULT_GOOGLE_IMAGE_SIZE,
        imageOutputOptions: { mimeType: "image/png" },
      },
    },
  };
}

/** URL do endpoint real -- fonte única, nunca montada inline em mais de um lugar. */
export function buildGeminiGenerateContentUrl(apiBase: string, model: string): string {
  return `${apiBase}/models/${encodeURIComponent(model)}:generateContent`;
}
