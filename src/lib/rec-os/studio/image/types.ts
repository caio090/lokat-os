/**
 * Sprint REC OS Studio Image Generation MVP V0.3 — contratos do runtime
 * visual. Domínio puro (sem I/O, sem import de provider) -- a chamada
 * real ao provider fica isolada em ./image-runtime.ts (o único arquivo
 * deste domínio que importa @/lib/ai/image-providers).
 *
 * Vidigal PNG (skills/vidigal-png/) NUNCA importa nada deste diretório
 * -- a orquestração (create-studio-visual.ts) é quem conecta o texto ao
 * runtime visual, nunca a skill em si.
 */
import type { DesignFormat } from "@/lib/providers/shared/types";
import type { VidigalHeadlineZone } from "../skills/vidigal-png/output";
import type { ImageGenerationDiagnostics } from "@/lib/ai/image-providers/types";

/**
 * Prompt 20 (Studio Visual Quality) — Fase 09/10: contrato conceitual
 * que separa o que REALMENTE chama o provider de imagem do que é só
 * UI organizando assets já existentes. SINGLE_PIECE e SERIES_ITEM
 * geram UMA composição cada (nunca "várias peças numa imagem só").
 * FEED_PREVIEW e STORY_PREVIEW NUNCA chamam o provider -- eles só
 * organizam thumbnails/placeholders de peças que já existem (ver
 * components/rec-os/feed-preview.tsx, testado explicitamente em
 * visual-quality.structural.test.ts). Este tipo é só documentação/
 * label -- a garantia real já está em qual código importa
 * image-runtime.ts (só create-studio-visual.ts, nunca FeedPreview).
 */
export type VisualOutputIntent = "SINGLE_PIECE" | "SERIES_ITEM" | "FEED_PREVIEW" | "STORY_PREVIEW";

export type StudioImageAssetKind = "reference" | "protected";

/**
 * Fase 12/13 — um asset anexado a UMA geração. `url` é sempre efêmero
 * (data: URL enviado pelo cliente para esta requisição, ou uma URL já
 * pública conhecida, como o logo oficial da Company) -- nunca
 * persistido por este domínio (sem banco, sem tabela).
 */
export interface StudioImageAsset {
  id: string;
  label: string;
  kind: StudioImageAssetKind;
  url: string;
  /** Prompt 01 (Studio Visual Engine) -- só relevante para kind:"protected":
   *  decide o slot de layout no StudioRenderPlan (logo = canto pequeno,
   *  product = card central). Omitido para "reference". O logo oficial
   *  da Company é sempre "logo" (create-studio-visual.ts); um asset
   *  protegido enviado pelo usuário é sempre "product" por padrão (a UI
   *  hoje não distingue logo/produto no upload). */
  role?: "logo" | "product";
}

export type StudioImageCapabilityKey =
  | "textToImage"
  | "referenceImages"
  | "imageEditing"
  | "maskEditing"
  | "transparentBackground"
  | "protectedAssetSupport";

/**
 * Fase 6 — declarar SOMENTE o que o provider real suporta hoje. Nenhuma
 * capability é inventada: a auditoria desta sprint confirmou que nem
 * google-gemini.ts nem openai-images.ts realmente enviam
 * styleReference/subjectReference ao provider (campos mortos) -- por
 * isso referenceImages/imageEditing/maskEditing/transparentBackground/
 * protectedAssetSupport são sempre false nesta versão.
 */
export interface StudioImageCapabilities {
  providerId: string | null;
  available: boolean;
  supports: Record<StudioImageCapabilityKey, boolean>;
}

export interface StudioImageGenerationRequest {
  generationPrompt: string;
  format: DesignFormat;
  references: StudioImageAsset[];
  protectedAssets: StudioImageAsset[];
  /** Prompt 20 -- decidido pela Vidigal (VisualCompositionPlan); reserva negative space na cena ANTES da geração, nunca depois. Opcional/retrocompatível -- ausência cai no comportamento anterior (nenhuma instrução de zona). */
  headlineZone?: VidigalHeadlineZone;
  /**
   * FASE 31K (Sunburst Studio QA Readiness) -- override explícito de
   * model/quality, já autorizado e validado na rota (Super Admin +
   * `LKT_PRODUCTION_SUNBURST_QA`, ver route.ts) antes de chegar aqui.
   * Ausente = comportamento normal, idêntico ao de antes desta fase.
   */
  imageOverride?: { model?: string; highRes?: boolean };
}

export type StudioImageResultStatus = "completed" | "failed" | "runtime_unavailable";

export type StudioImageErrorCode =
  | "STUDIO_IMAGE_PROVIDER_UNAVAILABLE"
  | "STUDIO_IMAGE_GENERATION_FAILED"
  | "STUDIO_ASSET_LOCK_UNSUPPORTED";

export interface StudioImageGenerationResult {
  status: StudioImageResultStatus;
  providerId: string | null;
  image: { url: string; width: number; height: number } | null;
  /** Nunca vazio quando existem limitações reais de capability -- nunca
   *  altera o resultado em silêncio (Fase 14: "falhar explícito ou
   *  classificar como referência, nunca alterar o original em silêncio"). */
  warnings: string[];
  error?: { code: StudioImageErrorCode; message: string };
  generatedAt: string;
  /** FASE 31K §5/11 -- nunca mais descartado; presente em sucesso e em falha (quando o provider chegou a tentar). */
  diagnostics?: ImageGenerationDiagnostics;
}
