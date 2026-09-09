/**
 * Prompt 31 (Google Image Provider Migration) — normalização da
 * resposta de `models/{model}:generateContent` e mapeamento de erro.
 * Mesmo espírito de openai-image-response.ts (Prompt 09): nunca
 * confia cegamente na resposta do provider, nunca devolve sucesso com
 * imagem vazia/inválida.
 *
 * FASE 12 -- o Gemini não devolve width/height no payload (diferente
 * da OpenAI, que documenta devolver exatamente o tamanho pedido).
 * "Não inventar width/height se a API não fornecer dimensões reais":
 * decodifica os bytes reais com sharp (já dependência nativa testada
 * do projeto, usada de verdade em render/compositor.ts) para ler as
 * dimensões reais -- nunca um valor fixo/chutado.
 */
import sharp from "sharp";
import { detectMimeFromMagicBytes } from "./image-bytes";

export interface NormalizedGeminiImage {
  url: string; // data: URL (sempre -- Gemini só devolve inlineData base64, nunca uma URL remota)
  width: number;
  height: number;
  mimeType: string;
}

export type NormalizeGeminiImageResponseResult =
  | { ok: true; images: NormalizedGeminiImage[] }
  | { ok: false; error: string };

interface GeminiInlinePart {
  inlineData?: { mimeType?: string; data?: string };
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiInlinePart[] };
  finishReason?: string;
}
interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

const SAFETY_FINISH_REASONS = new Set(["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "RECITATION"]);

/**
 * Nunca lança. Sucesso exige: candidate presente, uma `part` com
 * `inlineData.data` não vazio, base64 decodificável, e os bytes
 * decodificados batendo com magic bytes de uma imagem real (PNG/JPEG/
 * WebP) -- nunca aceita uma string base64 arbitrária só porque
 * decodificou sem lançar (mesmo princípio de openai-image-response.ts).
 */
export async function normalizeGeminiImageResponse(json: unknown): Promise<NormalizeGeminiImageResponseResult> {
  const response = json as GeminiGenerateContentResponse | null;

  if (response?.promptFeedback?.blockReason) {
    return { ok: false, error: "O conteúdo solicitado não pôde ser gerado (bloqueado por política de segurança do provider)." };
  }

  const candidates = response?.candidates ?? [];
  if (candidates.length === 0) {
    return { ok: false, error: "Nenhuma imagem retornada pelo provider." };
  }

  const first = candidates[0];
  if (first.finishReason && SAFETY_FINISH_REASONS.has(first.finishReason)) {
    return { ok: false, error: "O conteúdo solicitado não pôde ser gerado (bloqueado por política de segurança do provider)." };
  }

  const parts = first.content?.parts ?? [];
  const imagePart = parts.find((p): p is GeminiInlinePart & { inlineData: { data: string; mimeType?: string } } => Boolean(p.inlineData?.data));
  if (!imagePart) {
    return { ok: false, error: "Nenhuma imagem retornada pelo provider." };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(imagePart.inlineData.data, "base64");
  } catch {
    return { ok: false, error: "A imagem retornada pelo provider não pôde ser decodificada (base64 inválido)." };
  }
  if (bytes.length === 0) {
    return { ok: false, error: "A imagem retornada pelo provider está vazia." };
  }

  const mimeType = detectMimeFromMagicBytes(bytes);
  if (!mimeType) {
    return { ok: false, error: "Os bytes retornados pelo provider não correspondem a uma imagem válida (PNG/JPEG/WebP)." };
  }

  // FASE 12 -- dimensões REAIS, nunca fixas/chutadas.
  let width: number | undefined;
  let height: number | undefined;
  try {
    const metadata = await sharp(bytes).metadata();
    width = metadata.width;
    height = metadata.height;
  } catch {
    return { ok: false, error: "A imagem retornada pelo provider não pôde ser lida (metadados inválidos)." };
  }
  if (!width || !height) {
    return { ok: false, error: "A imagem retornada pelo provider não trouxe dimensões válidas." };
  }

  return { ok: true, images: [{ url: `data:${mimeType};base64,${imagePart.inlineData.data}`, width, height, mimeType }] };
}

interface GeminiErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

/** Mensagem SEMPRE segura pro chamador -- nunca a mensagem bruta do Google (pode ecoar parte do prompt). */
export function mapGeminiHttpErrorToSafeMessage(status: number, body: unknown): string {
  const parsed = body as GeminiErrorBody | null;
  const googleStatus = parsed?.error?.status;
  if (googleStatus === "RESOURCE_EXHAUSTED" || status === 429) {
    return "Limite de geração de imagem atingido. Tente novamente em instantes.";
  }
  if (status === 401 || status === 403 || googleStatus === "UNAUTHENTICATED" || googleStatus === "PERMISSION_DENIED") {
    return "Falha de autenticação com o provider de imagem.";
  }
  if (status === 404 || googleStatus === "NOT_FOUND") {
    return "O modelo de geração de imagem configurado não está disponível.";
  }
  if (status === 400 || googleStatus === "INVALID_ARGUMENT") {
    return "Não foi possível gerar a imagem: parâmetros inválidos para o modelo configurado.";
  }
  if (status >= 500) {
    return "O provider de imagem está indisponível no momento.";
  }
  return "Não foi possível gerar a imagem no momento.";
}

/** Log server-side sanitizado -- nunca a mensagem bruta, nunca a API key. */
export function logGeminiImageError(status: number, body: unknown): void {
  const parsed = body as GeminiErrorBody | null;
  console.warn("[image-providers/google] falha na geração de imagem", {
    status, code: parsed?.error?.code, googleStatus: parsed?.error?.status,
  });
}
