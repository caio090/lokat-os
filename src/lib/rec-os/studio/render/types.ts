/**
 * Sprint REC OS Studio Visual Engine (Prompt 01) — contratos do
 * StudioRenderPlan e do resultado final composto. Domínio puro (sem
 * I/O) -- render-plan.ts constrói/valida, compositor.ts executa.
 *
 * O Render Plan é interno ao motor visual: NUNCA substitui os 8
 * outputs da Vidigal (skills/vidigal-png/output.ts) -- é uma etapa
 * a mais entre "direção criativa em texto" e "pixels renderizados".
 */
import type { DesignFormat } from "@/lib/providers/shared/types";
import type { ImageGenerationDiagnostics } from "@/lib/ai/image-providers/types";

export interface StudioCanvasSize {
  width: number;
  height: number;
}

/** Margem de segurança em pixels a partir de cada borda -- nenhuma
 *  layer de texto/logo pode ser posicionada além disso. */
export interface StudioSafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface StudioRenderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StudioTextLayerRole = "headline" | "cta";

export interface StudioTextLayer {
  role: StudioTextLayerRole;
  text: string;
  box: StudioRenderRect;
  fontFamily: string;
  fontWeight: number;
  /** Tamanho MÁXIMO -- o compositor pode reduzir para caber na box, nunca aumentar. */
  maxFontSize: number;
  minFontSize: number;
  color: string;
  align: "left" | "center" | "right";
  /** Cor de fundo opcional (pill/plaquinha/painel/gradiente) para garantir contraste sobre o background gerado. Prompt 20 (Fase 27) -- `style: "gradient"` substitui o preenchimento sólido por um degradê transparente->cor (nunca "caixa preta genérica sempre"). */
  backdrop?: { color: string; opacity: number; radius: number; paddingX: number; paddingY: number; style?: "solid" | "gradient" };
  /** Prompt 20 (Fase 28) -- traço sob o texto, usado pelo ctaStyle UNDERLINE (nunca junto de um backdrop). */
  underline?: { color: string; thickness: number };
}

export type StudioProtectedAssetRole = "logo" | "product";

export interface StudioProtectedAssetLayer {
  assetId: string;
  role: StudioProtectedAssetRole;
  /** Área reservada -- a imagem original é sempre "contain" dentro dela, nunca cropada/distorcida. */
  box: StudioRenderRect;
}

/**
 * Plano determinístico de renderização para UM formato. Nada aqui vem
 * de coordenadas "confiadas" de um LLM -- ver render-plan.ts, que
 * clampa toda geometria contra o canvas antes de devolver o plano
 * (x/y/width/height/fontSize sempre dentro dos limites do canvas).
 */
export interface StudioRenderPlan {
  format: DesignFormat;
  canvas: StudioCanvasSize;
  safeZone: StudioSafeZone;
  /** Área reservada ao elemento principal (produto/cena) -- hoje é sempre o canvas inteiro (V1: sem cutout de produto isolado da cena gerada). */
  focalArea: StudioRenderRect;
  textLayers: StudioTextLayer[];
  protectedAssets: StudioProtectedAssetLayer[];
  renderWarnings: string[];
}

export type StudioVisualErrorCode =
  | "STUDIO_IMAGE_PROVIDER_UNAVAILABLE"
  | "STUDIO_IMAGE_GENERATION_FAILED"
  | "STUDIO_ASSET_LOCK_UNSUPPORTED"
  | "STUDIO_RENDER_PLAN_INVALID"
  | "STUDIO_RENDER_FAILED"
  | "STUDIO_OUTPUT_TOO_LARGE";

export type StudioVisualResultStatus = "completed" | "failed" | "runtime_unavailable";

export interface StudioVisualResult {
  status: StudioVisualResultStatus;
  providerId: string | null;
  image: { url: string; width: number; height: number; mime: string } | null;
  renderPlan: StudioRenderPlan | null;
  warnings: string[];
  error?: { code: StudioVisualErrorCode; message: string };
  generatedAt: string;
  /** FASE 31K §5/11 -- model/quality/size/duration/usage reais do provider, nunca mais descartados. */
  diagnostics?: ImageGenerationDiagnostics;
  /** FASE 31M §3 -- só presente em Company Mode (companyId real). Nunca bytes/base64/URL sensível -- só booleanos/contagens/metadata segura, pra QA administrativo descobrir em que estágio a logo oficial deixou de existir sem precisar consultar o banco. */
  logoDiagnostics?: StudioLogoDiagnostics;
}

/**
 * FASE 31M (Logo Protected Asset Pipeline) — traço seguro do caminho
 * completo da logo oficial (business context -> auto-add -> fetch ->
 * render plan -> compositor). Todo campo é booleano/contagem/metadata
 * não sensível -- nunca bytes, nunca base64, nunca a URL completa
 * (irrelevante aqui: a URL da logo não é secreta, mas mesmo assim
 * nunca exposta por completo neste diagnóstico, por princípio).
 */
export interface StudioLogoDiagnostics {
  companyIdentityPresent: boolean;
  logoUrlPresent: boolean;
  logoAssetAutoAdded: boolean;
  protectedAssetsInputCount: number;
  protectedAssetsAfterAutoAddCount: number;
  logoFetchAttempted: boolean;
  logoFetchSucceeded: boolean;
  logoMimeType: string | null;
  logoDimensions: { width: number; height: number } | null;
  logoBytesPresent: boolean;
  renderPlanLogoPresent: boolean;
  compositorLogoOverlayPresent: boolean;
  logoRendered: boolean;
  /** Motivo seguro (nunca stack trace/secret) só quando algo no caminho da logo falhou -- FASE 31M §10 (LOGO_ASSET_FAILED). */
  logoFailureReason?: string;
}
