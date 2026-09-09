import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { executeStudioSkill } from "@/lib/rec-os/studio/execute";
import { buildVidigalSystemInstructions } from "@/lib/rec-os/studio/skills/vidigal-png/instructions";
import { VIDIGAL_PNG_SKILL } from "@/lib/rec-os/studio/skills/vidigal-png/manifest";
import { buildStudioCreativeBusinessContext } from "@/lib/rec-os/studio/business-context";
import { applyCompositionGuidance } from "@/lib/rec-os/studio/image/composition-guidance";
import { applyBackgroundGuardPolicy } from "@/lib/rec-os/studio/image/background-guard";
import { buildOpenAIImageRequest } from "@/lib/ai/image-providers/openai-image-compat";
import { normalizeOpenAIImageResponse, mapOpenAIImageErrorToSafeMessage, logOpenAIImageError } from "@/lib/ai/image-providers/openai-image-response";
import type { VidigalPngOutputContract } from "@/lib/rec-os/studio/skills/vidigal-png/output";

/**
 * FASE 31F.0B/D — mecanismo de benchmark TEMPORÁRIO, SOMENTE-PREVIEW:
 * compara gpt-image-2 vs gpt-image-2.5-sunburst com o MESMO
 * generationPrompt (brief -> Vidigal, uma única vez -> mesma string
 * reaproveitada nas duas chamadas de imagem, nunca duas gerações de
 * texto divergentes). Nunca roda em Production.
 *
 * FASE 31F.0D -- removido o token hardcoded que existia aqui antes
 * (nunca deveria ir pro commit). Proteção agora é só a combinação já
 * existente no projeto: VERCEL_ENV==="preview" (nunca spoofável pelo
 * cliente) + Vercel Deployment Protection (SSO da própria Vercel,
 * confirmado habilitado neste projeto pra qualquer URL que não seja o
 * domínio customizado de Production) -- nenhum secret novo criado.
 *
 * Split em dois steps (?step=prompt e ?step=generate) -- este projeto
 * roda no plano Hobby da Vercel, com maxDuration travado em 60s (ver
 * mesmo limite em ../studio/images/generate/route.ts). Duas gerações
 * quality=high SEQUENCIAIS numa única invocação estouram esse teto de
 * forma pouco previsível; cada invocação agora faz UMA coisa só (texto
 * Vidigal, OU uma geração de imagem), sempre dentro do limite. O
 * orquestrador (quem chama este endpoint) garante A antes de B e
 * reaproveita a MESMA string de prompt (devolvida por ?step=prompt)
 * nas duas chamadas de ?step=generate -- nunca duas gerações de texto.
 *
 * NÃO É CÓDIGO DE PRODUTO. Arquivo temporário -- remover depois do
 * benchmark (ver relatório).
 */

export const maxDuration = 60;

const VALID_MODELS = ["gpt-image-2", "gpt-image-2.5-sunburst"] as const;

const PRICE_PER_1M = { textInput: 5, imageInput: 8, imageOutput: 30 } as const; // USD, developers.openai.com/api/docs/models/gpt-image-2.5-sunburst ("Token rates match GPT Image 2")

function costFor(usage: { input_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number }; output_tokens?: number; total_tokens?: number } | undefined) {
  if (!usage) return { textInputCostUsd: null, imageInputCostUsd: null, imageOutputCostUsd: null, totalCostUsd: null, note: "usage não retornado pela API" };
  const textTokens = usage.input_tokens_details?.text_tokens ?? 0;
  const imageInputTokens = usage.input_tokens_details?.image_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const textInputCostUsd = (textTokens / 1_000_000) * PRICE_PER_1M.textInput;
  const imageInputCostUsd = (imageInputTokens / 1_000_000) * PRICE_PER_1M.imageInput;
  const imageOutputCostUsd = (outputTokens / 1_000_000) * PRICE_PER_1M.imageOutput;
  return {
    textInputCostUsd: Number(textInputCostUsd.toFixed(6)),
    imageInputCostUsd: Number(imageInputCostUsd.toFixed(6)),
    imageOutputCostUsd: Number(imageOutputCostUsd.toFixed(6)),
    totalCostUsd: Number((textInputCostUsd + imageInputCostUsd + imageOutputCostUsd).toFixed(6)),
    note: null,
  };
}

/** FASE 31F.0D §5 -- normaliza o erro sem esconder a causa real, nunca vaza a key (a mensagem do SDK da OpenAI nunca contém a key). */
type OpenAIErrorShape = { status?: number; name?: string; message?: string; code?: string; type?: string };
type ErrorCategory = "INSUFFICIENT_QUOTA" | "AUTH_ERROR" | "OTHER";

function classifyOpenAIError(error: unknown): { category: ErrorCategory; status: number | null; code: string | null; type: string | null; message: string } {
  const e = error as OpenAIErrorShape;
  const status = e?.status ?? null;
  const code = e?.code ?? null;
  const type = e?.type ?? null;
  const message = e?.message ?? String(error);
  let category: ErrorCategory = "OTHER";
  if (status === 429 && (code === "credit_balance_exhausted" || type === "insufficient_quota")) {
    category = "INSUFFICIENT_QUOTA";
  } else if (status === 401) {
    category = "AUTH_ERROR";
  }
  return { category, status, code, type, message };
}

/** Diagnóstico isolado -- nunca toca neural-executor.ts (que engole o erro real por design de produção). Só pra ver a causa real do STUDIO_AI_PROVIDER_UNAVAILABLE, sem nunca logar a key. Chamada mínima e barata (texto curto, sem schema). */
async function runDiagTextStep() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, step: "diag_text", openaiAvailable: false, category: "AUTH_ERROR" as ErrorCategory, message: "OPENAI_API_KEY not configured in this environment" }, { status: 200 });
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000 });
  try {
    const response = await client.responses.create({ model: "gpt-4o-mini", store: false, input: "ping" });
    return NextResponse.json({ ok: true, step: "diag_text", openaiAvailable: true, result: response.output_text }, { status: 200 });
  } catch (error) {
    const classified = classifyOpenAIError(error);
    return NextResponse.json({ ok: false, step: "diag_text", openaiAvailable: true, ...classified }, { status: 200 });
  }
}

// Cópia verbatim de VIDIGAL_PNG_JSON_SCHEMA (não exportado por
// neural-executor.ts) -- só pra este diagnóstico isolado, nunca altera
// o arquivo real. Reproduz a MESMA chamada real (mesmo model/instructions/
// schema) fora do catch que engole o erro, pra ver a causa raiz.
const stringArray = { type: "array", items: { type: "string" } } as const;
const DIAG_VIDIGAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    briefReading: { type: "string" },
    creativeDirection: { type: "string" },
    conceptualBasis: { type: "string" },
    visualStructure: { type: "string" },
    visualGuidelines: { type: "string" },
    generationPrompt: { type: "string" },
    variations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, direction: { type: "string" }, promptDelta: { type: "string" } },
        required: ["title", "direction", "promptDelta"],
      },
    },
    adaptations: stringArray,
    suggestedHeadline: { type: "string" },
    suggestedCta: { type: ["string", "null"] },
    layoutArchetype: { type: "string", enum: ["EDITORIAL_HERO", "PRODUCT_FOCUS", "LIFESTYLE_HERO", "BOLD_PROMO", "MINIMAL_POSTER", "INFORMATIONAL", "BRAND_STATEMENT"] },
    headlineZone: { type: "string", enum: ["TOP", "BOTTOM"] },
    contrastTreatment: { type: "string", enum: ["SCRIM", "GRADIENT", "PANEL"] },
    ctaStyle: { type: "string", enum: ["PILL", "LABEL", "UNDERLINE", "SMALL_BLOCK"] },
  },
  required: [
    "briefReading", "creativeDirection", "conceptualBasis", "visualStructure", "visualGuidelines", "generationPrompt", "variations", "adaptations", "suggestedHeadline", "suggestedCta",
    "layoutArchetype", "headlineZone", "contrastTreatment", "ctaStyle",
  ],
} as const;

async function runDiagVidigalStep() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, step: "diag_vidigal", openaiAvailable: false, category: "AUTH_ERROR" as ErrorCategory, message: "OPENAI_API_KEY not configured in this environment" }, { status: 200 });
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000 });
  const systemInstructions = buildVidigalSystemInstructions(VIDIGAL_PNG_SKILL.modules);
  const requestPayload = {
    business_context: { company: null, identity: null, brand: null, market: null, products: null },
    reference_analysis: null,
    user_brief: {
      freeformBrief: "Crie uma arte para divulgar nosso combo de hambúrguer artesanal. Ambiente de hamburgueria premium, iluminação noturna aconchegante, foco na comida.",
      objective: null, pieceType: null, format: "carousel", headline: null, supportingCopy: null, cta: null, references: null, brandContext: null, restrictions: null, variationCount: null, notes: null,
    },
  };
  try {
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      store: false,
      instructions: systemInstructions,
      input: JSON.stringify(requestPayload),
      text: { format: { type: "json_schema", name: "vidigal_png_output", strict: true, schema: DIAG_VIDIGAL_SCHEMA } },
    });
    return NextResponse.json({ ok: true, step: "diag_vidigal", openaiAvailable: true, result: response.output_text }, { status: 200 });
  } catch (error) {
    const classified = classifyOpenAIError(error);
    return NextResponse.json({ ok: false, step: "diag_vidigal", openaiAvailable: true, ...classified }, { status: 200 });
  }
}

async function runPromptStep() {
  // companyId=null -> buildStudioCreativeBusinessContext retorna sem NUNCA tocar `db` (Free Mode, ver business-context.ts) -- cliente Supabase real não é necessário aqui, e não está configurado neste ambiente de diagnóstico.
  const context = await buildStudioCreativeBusinessContext(null as unknown as SupabaseClient, null, null);
  const textResult = await executeStudioSkill({
    skillId: "vidigal_png",
    input: {
      freeformBrief: "Crie uma arte para divulgar nosso combo de hambúrguer artesanal. Ambiente de hamburgueria premium, iluminação noturna aconchegante, foco na comida.",
      format: "carousel",
    },
    context,
  });

  const output = textResult.output as VidigalPngOutputContract | null;
  if (textResult.status !== "completed" || !output) {
    return NextResponse.json({ step: "vidigal_text", ok: false, textResult }, { status: 502 });
  }

  // Mesmo tratamento que image-runtime.ts aplica no pipeline real -- reaproveitado, nunca reescrito.
  const withComposition = applyCompositionGuidance(output.generationPrompt, output.headlineZone);
  const guardedPrompt = applyBackgroundGuardPolicy(withComposition);

  return NextResponse.json({ ok: true, prompt: guardedPrompt, headlineZone: output.headlineZone }, { status: 200 });
}

async function runGenerateStep(model: string, prompt: string) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured in this environment" }, { status: 503 });
  }
  const built = buildOpenAIImageRequest({ model, prompt, aspectRatio: "4:5", highRes: true, outputCount: 1 });
  if (!built.ok) {
    return NextResponse.json({ ok: false, error: built.error, model }, { status: 200 });
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 55_000 });
  try {
    const response = await client.images.generate(built.request);
    const usage = response.usage;
    const normalized = normalizeOpenAIImageResponse(response, built.request.size);
    if (!normalized.ok) {
      return NextResponse.json({ ok: false, error: normalized.error, model }, { status: 200 });
    }
    return NextResponse.json({
      ok: true,
      model,
      quality: built.request.quality,
      size: built.request.size,
      image: normalized.images[0],
      usage: usage ? { input_tokens: usage.input_tokens, input_tokens_details: usage.input_tokens_details, output_tokens: usage.output_tokens, total_tokens: usage.total_tokens, output_tokens_details: usage.output_tokens_details } : null,
      cost: costFor(usage),
    }, { status: 200 });
  } catch (error) {
    logOpenAIImageError(error);
    return NextResponse.json({ ok: false, error: mapOpenAIImageErrorToSafeMessage(error), model }, { status: 200 });
  }
}

export async function GET(request: NextRequest) {
  // FASE 2/14/31F.0D -- nunca em Production, sem exceção. Preview real, verificado pelo próprio runtime Vercel (nunca spoofável pelo cliente). Única proteção além disso: Vercel Deployment Protection (SSO), já habilitado no projeto -- nenhum secret/token novo neste arquivo.
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const step = request.nextUrl.searchParams.get("step");

  if (step === "diag_text") {
    return runDiagTextStep();
  }

  if (step === "diag_vidigal") {
    return runDiagVidigalStep();
  }

  if (step === "prompt") {
    return runPromptStep();
  }

  if (step === "generate") {
    const model = request.nextUrl.searchParams.get("model") ?? "";
    const prompt = request.nextUrl.searchParams.get("prompt") ?? "";
    if (!(VALID_MODELS as readonly string[]).includes(model) || !prompt) {
      return NextResponse.json({ error: "missing/invalid model or prompt" }, { status: 400 });
    }
    return runGenerateStep(model, prompt);
  }

  return NextResponse.json({ error: "missing step (diag_text|diag_vidigal|prompt|generate)" }, { status: 400 });
}
