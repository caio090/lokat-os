/**
 * Prompt 09 (Studio Image Provider Compatibility) — normalização da
 * resposta de `client.images.generate()` e mapeamento de erro.
 *
 * O restante do Studio (image-runtime.ts, create-studio-visual.ts) já
 * sabe lidar com `ImageGenerationOutput.images[].url` sendo uma
 * `data:` URL OU uma URL remota https (resolveBackgroundBytes em
 * create-studio-visual.ts) -- por isso este normalizador não precisa
 * fazer fetch nenhum pra URL: só decide qual das duas formas construir
 * a partir do que a OpenAI realmente devolveu.
 */
import OpenAI from "openai";
import type { ImagesResponse } from "openai/resources/images";
import { detectMimeFromMagicBytes } from "./image-bytes";

export interface NormalizedOpenAIImage {
  url: string; // data: URL (b64_json) ou URL remota https (fallback url)
  width: number;
  height: number;
}

export type NormalizeOpenAIImageResponseResult =
  | { ok: true; images: NormalizedOpenAIImage[] }
  | { ok: false; error: string };

function parseRequestedSize(size: string | null | undefined): { width: number; height: number } {
  const match = size ? /^(\d+)x(\d+)$/.exec(size) : null;
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Normaliza `ImagesResponse` pra `{url,width,height}[]` -- nunca lança.
 * `requestedSize` vem do próprio request enviado (a OpenAI documenta
 * devolver exatamente o tamanho pedido quando não é "auto") -- usado
 * só como fallback de dimensão, nunca sobrepõe um dado real da resposta.
 */
export function normalizeOpenAIImageResponse(response: ImagesResponse, requestedSize: string | null | undefined): NormalizeOpenAIImageResponseResult {
  const data = response.data ?? [];
  if (data.length === 0) {
    return { ok: false, error: "Nenhuma imagem retornada pelo provider." };
  }

  const { width, height } = parseRequestedSize(requestedSize);
  const images: NormalizedOpenAIImage[] = [];

  for (const item of data) {
    if (item.b64_json) {
      let bytes: Buffer;
      try {
        bytes = Buffer.from(item.b64_json, "base64");
      } catch {
        return { ok: false, error: "A imagem retornada pelo provider não pôde ser decodificada (base64 inválido)." };
      }
      const mimeType = detectMimeFromMagicBytes(bytes);
      if (!mimeType) {
        return { ok: false, error: "Os bytes retornados pelo provider não correspondem a uma imagem válida (PNG/JPEG/WebP)." };
      }
      images.push({ url: `data:${mimeType};base64,${item.b64_json}`, width, height });
      continue;
    }
    if (item.url) {
      // Passthrough -- o fetch seguro real acontece em
      // create-studio-visual.ts (resolveBackgroundBytes), que já
      // decide entre data:/https: sem duplicar lógica aqui.
      images.push({ url: item.url, width, height });
      continue;
    }
    return { ok: false, error: "A resposta do provider não trouxe nem b64_json nem url." };
  }

  return { ok: true, images };
}

/**
 * Mensagem SEMPRE segura pra devolver ao chamador (nunca o texto bruto
 * do erro da OpenAI, que pode ser mais detalhado do que apropriado pra
 * um usuário final). Log detalhado e sanitizado (status/code/param/
 * requestID, nunca a mensagem bruta nem secret) fica a cargo do
 * chamador via logOpenAIImageError.
 */
export function mapOpenAIImageErrorToSafeMessage(error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    const code = String(error.code ?? error.type ?? "");
    if (/moderation|content_policy/i.test(code)) {
      return "O conteúdo solicitado não pôde ser gerado (violação de política de conteúdo do provider).";
    }
    switch (error.status) {
      case 400:
        return "Não foi possível gerar a imagem: parâmetros inválidos para o modelo configurado.";
      case 401:
        return "Falha de autenticação com o provider de imagem.";
      case 403:
        return "Acesso negado pelo provider de imagem.";
      case 429:
        return "Limite de geração de imagem atingido. Tente novamente em instantes.";
      default:
        if (typeof error.status === "number" && error.status >= 500) {
          return "O provider de imagem está indisponível no momento.";
        }
        return "Não foi possível gerar a imagem no momento.";
    }
  }
  return "Não foi possível gerar a imagem no momento.";
}

/** Log server-side sanitizado -- nunca a mensagem bruta (pode ecoar
 *  parte do prompt em erros de moderação), nunca secret. */
export function logOpenAIImageError(error: unknown): void {
  if (error instanceof OpenAI.APIError) {
    console.warn("[image-providers/openai] falha na geração de imagem", {
      status: error.status,
      code: error.code,
      type: error.type,
      param: error.param,
      requestID: error.requestID,
    });
    return;
  }
  console.warn("[image-providers/openai] falha na geração de imagem", { kind: error instanceof Error ? error.constructor.name : typeof error });
}
