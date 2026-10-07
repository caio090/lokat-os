/**
 * FASE 1C — Jornada Macro do Cliente. Seção 1/2 do brief: "não criar
 * estados redundantes se já existir estrutura equivalente." Esta
 * camada NUNCA persiste um novo status -- é uma PROJEÇÃO computada em
 * cima de três eixos já reais e já separados:
 *   - commercial_leads.pipeline_stage (SQL 15, pré-fechamento)
 *   - clients.status (baseline, pós-conversão)
 *   - client_onboardings.status (SQL 101, DB MIGRATION PENDING)
 * Projeto/Tarefa (client_projects.status / operational_tasks.status)
 * são eixos SEPARADOS, nunca misturados aqui (seção 1).
 */
export const CLIENT_JOURNEY_STAGES = [
  "LEAD", "QUALIFICACAO", "DIAGNOSTICO_COMERCIAL", "PROPOSTA", "NEGOCIACAO",
  "CLIENTE_GANHO", "ONBOARDING", "ATIVO", "PAUSADO", "INADIMPLENTE", "ENCERRADO",
] as const;
export type ClientJourneyStage = (typeof CLIENT_JOURNEY_STAGES)[number];

/**
 * Deliberadamente SEM "ACOMPANHAMENTO"/"RENOVACAO" (mencionados no
 * brief original da retomada) -- nenhum campo real hoje distingue
 * "ativo em acompanhamento" de "ativo recém-onboardado" ou sinaliza
 * proximidade de renovação. Inventar esses dois estados sem um sinal
 * real por trás violaria o princípio "no hallucination" já aplicado
 * em todo o resto do projeto (ex.: company-diagnostic/adapters.ts).
 * Quando existir um sinal real (ex.: data de renovação do contrato),
 * adicionar então -- não antes.
 */
export interface ClientJourneySnapshot {
  stage: ClientJourneyStage;
  clientStatus: string;
  pipelineStage: string | null;
  onboardingStatus: string | null;
  onboardingId: string | null;
  onboardingProgress: number | null;
}

export type ClientJourneyFetchReason = "schema_not_applied" | "internal_error";
export type ClientJourneyFetchResult =
  | { status: "unavailable"; reason: ClientJourneyFetchReason }
  | { status: "available"; data: ClientJourneySnapshot };
