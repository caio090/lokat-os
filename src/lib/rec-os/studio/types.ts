/**
 * Sprint REC OS Studio Foundation V0.1 — contratos do domínio Studio.
 * Reaproveita AgentStatus (neural-core/agents.ts) para o vocabulário
 * "contrato existe, runtime não" -- já é o padrão estabelecido para
 * exatamente esse conceito (available_contract/planned/locked/
 * experimental/unavailable); nenhum segundo vocabulário paralelo
 * criado aqui. Reaproveita DesignFormat (providers/shared/types.ts)
 * para o campo de formato -- já é o enum canônico de formatos de peça
 * usado pelo Design Editor Provider.
 *
 * Nenhuma execução de IA, nenhum import de Supabase/next neste
 * arquivo -- domínio puro.
 */
import type { AgentStatus } from "@/lib/neural-core/agents";
import type { CanonicalBusinessContext } from "@/lib/neural-core/context";
import type { DesignFormat } from "@/lib/providers/shared/types";

export type StudioSkillCategory = "visual_direction";

/** "documented" = módulo com regras já definidas (ver o master prompt referenciado em instructions.ts).
 *  "placeholder_contract" = módulo registrado na árvore mas sem comportamento definido ainda -- nunca inventar aqui. */
export type StudioModuleStatus = "documented" | "placeholder_contract";

/** V0.2 -- "connected" significa que existe um executor real ligado a
 *  esta skill (ver skills/<id>/neural-executor.ts), NUNCA que o
 *  provider está configurado/disponível AGORA (isso é um fato de
 *  runtime, checado em isStudioSkillRuntimeAvailable() e refletido no
 *  status de cada StudioSkillExecutionResult -- nunca pré-declarado
 *  aqui). Campo mantido explícito (em vez de um boolean) para que uma
 *  eventual skill sem executor real continue "not_connected" mesmo
 *  com outras skills já conectadas. */
export type StudioSkillRuntimeStatus = "not_connected" | "connected";

export interface StudioSkillModule {
  id: string;
  label: string;
  status: StudioModuleStatus;
  description: string;
}

/**
 * Contrato mínimo de uma skill do Studio. `status: "available_contract"`
 * NUNCA significa "roda de verdade" -- só que a definição existe e pode
 * ser referenciada pelo Registry/UI. Ver isStudioSkillRuntimeAvailable()
 * em registry.ts, que retorna false para toda skill nesta Foundation.
 */
export interface StudioSkillDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  category: StudioSkillCategory;
  status: AgentStatus;
  runtimeStatus: StudioSkillRuntimeStatus;
  /** Chaves de StudioBriefInput que esta skill sabe interpretar. */
  supportedInputs: readonly string[];
  /** Chaves do contrato de saída desta skill (ver skills/<id>/output.ts). */
  produces: readonly string[];
  modules: readonly StudioSkillModule[];
  /** Lista livre e descritiva -- nada aqui está implementado. */
  futureCapabilities: readonly string[];
}

/**
 * Briefing de entrada genérico do Studio. A maioria dos campos é
 * opcional de propósito (Fase 5 do brief): a UI não pode virar
 * formulário obrigatório gigante -- por isso `freeformBrief` existe,
 * para um pedido como "Quero uma arte do aniversário da Duh para
 * feed." já ser um input válido sozinho.
 */
export interface StudioBriefInput {
  companyId?: string;
  projectId?: string;
  campaignId?: string;
  objective?: string;
  pieceType?: string;
  format?: DesignFormat;
  headline?: string;
  supportingCopy?: string;
  cta?: string;
  references?: string[];
  brandContext?: string;
  assets?: string[];
  restrictions?: string[];
  variationCount?: number;
  notes?: string;
  freeformBrief?: string;
}

/**
 * Fase 8 (preparação Neural, NÃO implementada) — quando o Studio ganhar
 * runtime real, o input deve ser enriquecido a partir do contexto
 * canônico já existente, nunca de um resolver de Company paralelo.
 * Fluxo futuro: Company Context -> Neural Context -> Studio -> Skill ->
 * Executor. Este alias só documenta que campos de CanonicalBusinessContext
 * (neural-core/context.ts) já cobrem o que o Studio precisaria consumir
 * -- nenhuma implementação, nenhum caller usa isto ainda.
 */
export type FutureStudioNeuralBridge = Pick<
  CanonicalBusinessContext,
  "companyId" | "workspaceId" | "role" | "capabilities" | "connections"
>;

/**
 * FASE 31L (Company Context Fix) — contrato EXPLÍCITO do body de POST
 * /api/studio/images/generate. Front (_studio-execution-form.tsx) e
 * rota (route.ts) importam este MESMO tipo -- nunca dois shapes
 * divergentes de novo. Causa raiz real corrigida nesta fase:
 * `companyId` estava sendo enviado dentro de `input` (StudioBriefInput.
 * companyId é um campo genérico do briefing, usado por outras rotas
 * como /api/studio/skills/execute -- que lê `input.companyId` de
 * propósito, um contrato DIFERENTE e válido pra ela) enquanto esta
 * rota sempre autorizou a partir do nível SUPERIOR do body -- o valor
 * dentro de `input` nunca era lido pra autorização aqui, e o fluxo
 * caía silenciosamente em Free Mode. `companyId` deste tipo é o único
 * que importa pra resolveCompanyContext() nesta rota.
 */
export type StudioGenerationMode = "company" | "free";

export interface StudioImageAssetInputBody {
  label?: string;
  url: string;
}

export interface StudioImageGenerateRequestBody {
  skillId: string;
  mode: StudioGenerationMode;
  /** Nível SUPERIOR do body, nunca dentro de `input`. Obrigatório em espírito quando mode==="company" -- validado em runtime pela rota (400 explícito se ausente/inválido), nunca um fallback silencioso pra Free Mode. */
  companyId?: string;
  input: StudioBriefInput;
  assets: { references: StudioImageAssetInputBody[]; protectedAssets: StudioImageAssetInputBody[] };
  qaMode?: "dry_run";
  qaImageModel?: "gpt-image-2.5-sunburst";
  qaImageQuality?: "high";
}
