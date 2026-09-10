/**
 * FASE 31G (LKT Image Dry Run Sem Custo) — fixtures determinísticas
 * usadas SOMENTE quando LKT_IMAGE_DRY_RUN está ativo (Preview/
 * Development, nunca Production -- gate real fica em dry-run.ts/
 * route.ts, nunca aqui). Nenhuma chamada de rede/IA neste arquivo.
 *
 * `buildDryRunVidigalOutput` tem a MESMA FORMA de um
 * VidigalPngOutputContract real (todos os 14 campos, enums válidos) --
 * nunca simplifica o contrato, só substitui o CONTEÚDO (que normalmente
 * viria de uma chamada paga à OpenAI) por texto claramente rotulado
 * como fixture, pra nunca mascarar a origem (FASE 31G §3).
 */
import sharp from "sharp";
import type { StudioBriefInput } from "../types";
import type { VidigalPngOutputContract } from "../skills/vidigal-png/output";

export function buildDryRunVidigalOutput(input: StudioBriefInput): VidigalPngOutputContract {
  const brief = input.freeformBrief?.trim() || input.objective?.trim() || input.headline?.trim() || input.pieceType?.trim() || "peça de teste (dry run)";
  return {
    briefReading: `[DRY RUN FIXTURE] Leitura determinística do briefing: "${brief}". Nenhuma chamada real à Vidigal foi feita.`,
    creativeDirection: "[DRY RUN FIXTURE] Direção criativa simulada -- serve só para exercitar o restante do pipeline (render plan, compositor, Asset Lock) sem custo externo.",
    conceptualBasis: "[DRY RUN FIXTURE] Base conceitual simulada, sem valor criativo real.",
    visualStructure: "[DRY RUN FIXTURE] Estrutura visual simulada -- cena única, sem colagem, sem múltiplos painéis.",
    visualGuidelines: "[DRY RUN FIXTURE] Diretrizes visuais simuladas -- sem texto/logo/marca d'água no background (mesma regra do Background Guard real).",
    generationPrompt: `Professional commercial background for: ${brief}. Clean editorial composition, strong negative space reserved for typography. [DRY RUN FIXTURE -- este generationPrompt nunca é enviado a nenhum provider real de imagem]`,
    variations: [
      { title: "Variação A (fixture)", direction: "Direção alternativa simulada.", promptDelta: "leve variação de iluminação (fixture)" },
    ],
    adaptations: ["Adaptação simulada para outros formatos (fixture, sem custo)."],
    suggestedHeadline: input.headline?.trim() || "Headline de teste (dry run)",
    suggestedCta: input.cta?.trim() || "Peça agora (dry run)",
    layoutArchetype: "EDITORIAL_HERO",
    headlineZone: "BOTTOM",
    contrastTreatment: "SCRIM",
    ctaStyle: "PILL",
  };
}

/**
 * Gera um PNG válido (não uma imagem em branco arbitrária) via `sharp`,
 * só pra provar decodificação/composição real -- nunca avaliado por
 * qualidade artística (FASE 31G §4). O compositor real sempre
 * redimensiona o background pro canvas do formato (`fit:"cover"`,
 * ver render/compositor.ts), então as dimensões aqui não precisam
 * corresponder ao formato final -- qualquer imagem decodificável serve.
 */
export async function buildDryRunBackgroundImage(): Promise<{ bytes: Buffer; url: string; width: number; height: number }> {
  const width = 1200;
  const height = 1200;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2b2320"/>
        <stop offset="100%" stop-color="#6b4a33"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="50%" font-size="42" fill="#ffffff66" text-anchor="middle" font-family="sans-serif">LKT DRY RUN FIXTURE</text>
  </svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const meta = await sharp(bytes).metadata();
  return { bytes, url: `data:image/png;base64,${bytes.toString("base64")}`, width: meta.width ?? width, height: meta.height ?? height };
}
