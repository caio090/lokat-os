/**
 * Sprint REC OS Studio Foundation V0.1/V0.2 — contratos de execução do
 * Studio. Domínio puro (sem I/O, sem import de provider) -- a chamada
 * real ao provider fica isolada em ./skills/vidigal-png/neural-executor.ts,
 * o único arquivo do domínio Studio que sabe que OpenAI existe.
 *
 * V0.2 evolui StudioSkillExecutionResult (era só o caso "not_connected")
 * para o contrato completo de execução real. `createNotConnectedRuntime`
 * continua existindo -- agora é o fallback explícito quando o provider
 * não está configurado (runtimeStatus continua refletindo essa
 * distinção; "available_contract" nunca implicou "roda de verdade").
 */
import type { StudioBriefInput } from "./types";

export const STUDIO_SKILL_RUNTIME_NOT_CONNECTED = "STUDIO_SKILL_RUNTIME_NOT_CONNECTED" as const;

export type StudioSkillExecutionStatus =
  | "idle"
  | "executing"
  | "completed"
  | "failed"
  | "runtime_unavailable"
  | "invalid_input"
  | "unauthorized_context";

export type StudioSkillErrorCode =
  | "STUDIO_SKILL_NOT_FOUND"
  | "STUDIO_SKILL_RUNTIME_UNAVAILABLE"
  | "STUDIO_SKILL_INVALID_INPUT"
  | "STUDIO_SKILL_OUTPUT_INVALID"
  | "STUDIO_COMPANY_CONTEXT_REQUIRED"
  | "STUDIO_COMPANY_CONTEXT_UNAUTHORIZED"
  | "STUDIO_AI_PROVIDER_UNAVAILABLE";

/**
 * Fase 5 — nunca inventar dado ausente. Cada campo é só o que está
 * genuinamente disponível a partir do contexto canônico já resolvido
 * pelo caller (ResolvedCompanyContext/CanonicalBusinessContext) --
 * nunca preenchido com exemplo, nunca um cliente hardcoded.
 *
 * V0.3 (Image Generation MVP, Fase 8/9) — identity/brand/market/
 * products são opcionais de propósito: só existem quando
 * buildStudioCreativeBusinessContext() (../business-context.ts)
 * encontrar uma linha real em `onboarding_profiles` para a Company.
 * Ausente permanece `null`, nunca um objeto com campos inventados.
 * `initiative` (campanha/projeto) continua sem resolver canônico
 * identificado -- omitido, não inventado.
 */
export interface StudioSkillBusinessContext {
  company: { id: string; name: string | null } | null;
  identity?: {
    brandName: string | null;
    logoUrl: string | null;
    brandColors: unknown;
    visualStyle: string | null;
    visualReferences: string | null;
  } | null;
  brand?: {
    toneOfVoice: string[] | null;
    wordsToUse: string | null;
    wordsToAvoid: string | null;
  } | null;
  market?: {
    segment: string | null;
    idealCustomer: string | null;
    ageRange: string | null;
    audienceLocation: string | null;
    pains: string | null;
    desires: string | null;
    objections: string | null;
  } | null;
  products?: {
    productsServices: string | null;
  } | null;
}

export interface StudioSkillExecutionRequest {
  skillId: string;
  input: StudioBriefInput;
  context: StudioSkillBusinessContext;
  /** Prompt 01 (Studio Visual Engine) -- regras visuais já extraídas das
   *  referências anexadas por render/reference-analysis.ts (nunca a
   *  imagem em si, nunca texto/marca copiada literalmente). Omitido
   *  quando não há referências ou a análise falhou -- nunca inventado. */
  referenceVisualRules?: string[];
}

export interface StudioSkillExecutionResult<TOutput = unknown> {
  skillId: string;
  skillVersion: string | null;
  /** Rótulo do runtime que de fato respondeu -- dado de execução, nunca
   *  uma dependência estática do manifesto da skill (Fase "Vidigal PNG
   *  não conhece provider"). FASE 31G -- "dry_run_fixture": nenhuma
   *  chamada de IA foi feita, o output é uma fixture determinística
   *  (LKT_IMAGE_DRY_RUN_FULL_ZERO_COST, Preview/Development only) --
   *  nunca confundido com "not_connected" (provider ausente) nem
   *  "openai_responses_api" (chamada real), pra nunca mascarar a origem. */
  runtime: "not_connected" | "openai_responses_api" | "dry_run_fixture";
  status: StudioSkillExecutionStatus;
  output: TOutput | null;
  warnings: string[];
  error?: { code: StudioSkillErrorCode; message: string };
  generatedAt: string;
}

export interface StudioSkillRuntime {
  skillId: string;
  execute(request: StudioSkillExecutionRequest): Promise<StudioSkillExecutionResult>;
}

/** Espelha isAgentRuntimeAvailable() (neural-core/agents.ts): usado
 *  quando o provider configurável não está disponível (sem API key,
 *  etc.) -- nunca chama nenhum provider, sempre retorna o mesmo estado
 *  explícito. */
export function createNotConnectedRuntime(skillId: string): StudioSkillRuntime {
  return {
    skillId,
    async execute() {
      return {
        skillId,
        skillVersion: null,
        runtime: "not_connected",
        status: "runtime_unavailable",
        output: null,
        warnings: [],
        error: { code: "STUDIO_AI_PROVIDER_UNAVAILABLE", message: `A skill "${skillId}" não tem um provider de IA configurado no servidor.` },
        generatedAt: new Date().toISOString(),
      };
    },
  };
}
