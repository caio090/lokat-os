/**
 * Interface abstrata para provedores de geração de imagem.
 * Nunca expor chaves de API no frontend. Toda chamada acontece no servidor.
 */

export type ImageAspectRatio = "1:1" | "9:16" | "16:9" | "4:5" | "1.91:1";

export interface ImageGenerationInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: ImageAspectRatio;
  styleReference?: string; // URL de referência visual
  subjectReference?: string; // URL de pessoa/produto/logo
  outputCount?: number; // 1–4
  highRes?: boolean;
  /**
   * FASE 31K (Sunburst Studio QA Readiness) -- override explícito de
   * modelo, autorizado e validado SOMENTE na rota (Super Admin + feature
   * flag Production, ver route.ts) -- nunca confiado do cliente aqui.
   * Ausente = comportamento normal (modelo default do provider, `MODEL`
   * em openai-images.ts). Providers que não suportam override (ex.
   * Google) simplesmente ignoram este campo -- nenhuma mudança neles.
   */
  modelOverride?: string;
}

/** FASE 31K -- shape real de `response.usage` da OpenAI (mesmos nomes de campo do benchmark e do SDK -- ImagesResponse.Usage -- nunca inventado). */
export interface ImageGenerationUsage {
  input_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  output_tokens?: number;
  total_tokens?: number;
  output_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

/** FASE 31K -- só "UPSTREAM_TIMEOUT" existe por ora (a única categoria que hoje se perdia, ver openai-images.ts). */
export type ImageGenerationErrorCategory = "UPSTREAM_TIMEOUT";

/**
 * FASE 31K §5/11 -- nunca mais descartado silenciosamente. Opcional e
 * aditivo: nenhum consumidor existente quebra por não usá-lo. Não é
 * exibido em UI nenhuma ainda (nem exigido) -- só disponível no
 * payload da resposta pra QA/diagnóstico. `quality`/`size` aceitam
 * `null` porque o SDK da OpenAI tipa esses campos como `string | null`
 * (nunca convertido silenciosamente -- só repassado como veio).
 */
export interface ImageGenerationDiagnostics {
  model: string;
  quality?: string | null;
  size?: string | null;
  durationMs?: number;
  usage?: ImageGenerationUsage;
  errorCategory?: ImageGenerationErrorCategory;
}

export interface ImageGenerationOutput {
  success: boolean;
  images?: { url: string; width: number; height: number }[];
  error?: string;
  providerRaw?: unknown; // dados brutos do provider para debug interno
  diagnostics?: ImageGenerationDiagnostics;
}

export interface ImageProvider {
  id: string;
  label: string;
  isAvailable(): boolean;
  generate(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}
