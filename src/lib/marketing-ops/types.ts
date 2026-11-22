/**
 * Operação de marketing (rec_os_campaign_planner) — contratos que espelham
 * docs/supabase/105-marketing-operations-NOT-APPLIED.sql.
 *
 * Relação com módulos existentes (reaproveitados, não duplicados):
 *  - rec-os-growth: diagnóstico/objetivo estratégico (entrada do funil).
 *  - rec-os-paid-traffic: distribuição de investimento por canal (o plano).
 *    Este módulo é a "missão futura própria" citada lá: organizar funis,
 *    campanhas, criativos, eventos e resultados.
 *  - company_decisions (migração 99): decisões; aqui só há o vínculo.
 *  - commercial_leads: CRM comercial da PRÓPRIA Lokat (não segmentado por
 *    cliente). O CRM de cada cliente é mkt_leads/mkt_opportunities.
 */

export const MARKETING_CHANNELS = ["meta", "google", "site", "whatsapp", "email", "organico", "indicacao", "offline", "outro"] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export const FUNNEL_FRAMEWORKS = ["custom", "brunson_value_ladder", "brunson_funnel", "erico_launch"] as const;
export type FunnelFramework = (typeof FUNNEL_FRAMEWORKS)[number];

export const FUNNEL_STAGE_KINDS = ["trafego", "captura", "nutricao", "conversao", "upsell", "entrega", "retencao"] as const;
export type FunnelStageKind = (typeof FUNNEL_STAGE_KINDS)[number];

export const VALUE_LADDER_POSITIONS = ["isca", "entrada", "principal", "premium", "continuidade"] as const;
export type ValueLadderPosition = (typeof VALUE_LADDER_POSITIONS)[number];

export const LAUNCH_MODELS = ["semente", "interno", "parceria", "perpetuo", "relampago", "outro"] as const;
export type LaunchModel = (typeof LAUNCH_MODELS)[number];

/** Fluxo interno. Separado do status reportado pela plataforma (platform_status). */
export const WORKFLOW_STATUSES = ["rascunho", "em_revisao", "aprovada", "publicada", "pausada", "encerrada", "arquivada"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const CONVERSION_SOURCES = ["meta_pixel", "meta_capi", "google_ads", "site", "whatsapp", "crm", "manual", "importacao"] as const;
export type ConversionSource = (typeof CONVERSION_SOURCES)[number];

export interface Funnel {
  id: string;
  clientId: string;
  projectId: string | null;
  name: string;
  framework: FunnelFramework;
  funnelType: string | null;
  objective: string | null;
  audience: string | null;
  offer: string | null;
  valueLadderPosition: ValueLadderPosition | null;
  diagnosticId: string | null;
  status: "rascunho" | "ativo" | "pausado" | "arquivado";
}

export interface FunnelStage {
  id: string;
  clientId: string;
  funnelId: string;
  position: number;
  stageKey: string;
  name: string;
  kind: FunnelStageKind;
  entryEventKey: string | null;
  channel: MarketingChannel | null;
}

export interface LaunchPhase {
  key: string;
  name: string;
  startsOn?: string;
  endsOn?: string;
  goal?: string;
}

export interface Launch {
  id: string;
  clientId: string;
  funnelId: string | null;
  name: string;
  launchModel: LaunchModel;
  phases: LaunchPhase[];
  cartOpensAt: string | null;
  cartClosesAt: string | null;
  timezoneName: string;
  status: "planejamento" | "pre_lancamento" | "carrinho_aberto" | "encerrado" | "cancelado";
}

export interface Campaign {
  id: string;
  clientId: string;
  adAccountId: string | null;
  funnelId: string | null;
  funnelStageId: string | null;
  launchId: string | null;
  channel: Exclude<MarketingChannel, "indicacao" | "offline">;
  name: string;
  objective: string | null;
  budgetType: "diario" | "vitalicio" | "no_conjunto" | null;
  budgetAmount: number | null;
  currency: string | null;
  externalId: string | null;
  status: WorkflowStatus;
  platformStatus: string | null;
  approvedBy: string | null;
  activationAuthorizedBy: string | null;
  activationAuthorizedAt: string | null;
}

/** Linha diária importada: "date" é o dia no fuso da conta; valores na moeda da conta. */
export interface PerformanceDaily {
  clientId: string;
  platform: "meta" | "google";
  level: "account" | "campaign" | "adset" | "ad";
  externalObjectId: string;
  date: string;
  accountTimezone: string;
  currency: string;
  attributionSetting: string;
  spend: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  linkClicks: number | null;
  actions: Array<{ action_type: string; value: string }>;
  actionValues: Array<{ action_type: string; value: string }>;
}
