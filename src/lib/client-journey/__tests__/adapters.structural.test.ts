/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/client-journey/__tests__/adapters.structural.test.ts
 * FASE 1C / FASE 1C.1 — prova que a jornada macro é uma PROJEÇÃO sobre
 * três eixos já reais (clients.status, commercial_leads.pipeline_stage,
 * client_onboardings.status), nunca um 4º status inventado. FASE 1C.1
 * corrige uma regressão: só o onboarding INICIAL (antes da conta ter
 * sido ativada) pode empurrar a jornada pra ONBOARDING. Uma vez que a
 * conta já está ATIVA (ou pausada/inadimplente/encerrada), um
 * onboarding ADICIONAL (expansão, novo serviço) nunca regride a
 * jornada geral -- a conta continua no status dela, e o onboarding
 * adicional aparece como um eixo separado (onboardingStatus na
 * snapshot, consumido pela UI), nunca escondido.
 */
import { getClientJourney } from "../adapters";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function fakeDb({ clientStatus, pipelineStage, onboarding, onboardingThrows }: { clientStatus: string; pipelineStage?: string | null; onboarding?: { status: string; id: string; progress: number } | null; onboardingThrows?: boolean }) {
  return {
    from: (table: string) => {
      if (table === "clients") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: clientStatus }, error: null }) }) }) };
      if (table === "commercial_leads") return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: pipelineStage ? { pipeline_stage: pipelineStage } : null, error: null }) }) }) }) }) };
      if (table === "client_onboardings") {
        if (onboardingThrows) return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => { throw { code: "42P01" }; } }) }) }) }) };
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: onboarding ? { id: onboarding.id, status: onboarding.status, progress: onboarding.progress } : null, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function main() {
  console.log("[test] lead pré-fechamento -- status aguardando_validacao + pipeline_stage mapeado");
  {
    const result = await getClientJourney(fakeDb({ clientStatus: "aguardando_validacao", pipelineStage: "proposta_enviada" }), "company-a");
    assert(result.status === "available" && result.data.stage === "PROPOSTA", "pipeline_stage=proposta_enviada mapeia pra PROPOSTA");
  }

  console.log("[test] cliente ganho + onboarding inicial -- conta ainda não ativada (clientStatus=onboarding), onboarding ativo decide a jornada (ONBOARDING)");
  {
    const result = await getClientJourney(fakeDb({ clientStatus: "onboarding", onboarding: { id: "onb-1", status: "IN_PROGRESS", progress: 40 } }), "company-tayannara");
    assert(result.status === "available" && result.data.stage === "ONBOARDING", "onboarding INICIAL (conta ainda não ativada) vence o status bruto do cliente -- jornada real é ONBOARDING");
    assert(result.status === "available" && result.data.onboardingProgress === 40, "progresso do onboarding propagado para a snapshot");
  }

  console.log("[test] onboarding inicial concluído -- conta passa a ATIVA, status do cliente volta a decidir a jornada");
  {
    const result = await getClientJourney(fakeDb({ clientStatus: "ativo", onboarding: { id: "onb-1", status: "COMPLETED", progress: 100 } }), "company-a");
    assert(result.status === "available" && result.data.stage === "ATIVO", "onboarding COMPLETED não trava mais a jornada em ONBOARDING");
  }

  console.log("[test] cliente ativo sem nenhum onboarding -- jornada ATIVO, onboardingId/Status null (nunca inventado)");
  {
    const result = await getClientJourney(fakeDb({ clientStatus: "ativo" }), "company-sem-onboarding");
    assert(result.status === "available" && result.data.stage === "ATIVO", "ATIVO quando clients.status=ativo");
    assert(result.status === "available" && result.data.onboardingId === null && result.data.onboardingStatus === null, "nenhum dado de onboarding fabricado quando não existe nenhum");
  }

  console.log("[test] FASE 1C.1 -- cliente ATIVO + onboarding adicional (expansão/novo serviço) NUNCA regride a jornada geral para ONBOARDING");
  {
    const result = await getClientJourney(fakeDb({ clientStatus: "ativo", onboarding: { id: "onb-2", status: "IN_PROGRESS", progress: 10 } }), "company-expansao");
    assert(result.status === "available" && result.data.stage === "ATIVO", "conta já ativada -- onboarding novo não derruba a jornada geral de volta pra ONBOARDING (regressão corrigida)");
    assert(result.status === "available" && result.data.onboardingStatus === "IN_PROGRESS" && result.data.onboardingId === "onb-2", "o eixo de onboarding continua visível separadamente (snapshot.onboardingStatus) -- nunca escondido, só não decide mais o stage");
  }

  console.log("[test] FASE 1C.1 -- cliente ativo + dois onboardings (inicial concluído + novo em andamento) -- getClientJourney usa o mais recente, jornada continua ATIVO");
  {
    // getClientJourney só busca o onboarding mais recente (order by created_at desc limit 1) -- aqui ele é o
    // segundo onboarding (o de expansão, IN_PROGRESS); o primeiro (COMPLETED) é irrelevante pra esta consulta.
    const result = await getClientJourney(fakeDb({ clientStatus: "ativo", onboarding: { id: "onb-expansao-2", status: "IN_PROGRESS", progress: 5 } }), "company-dois-onboardings");
    assert(result.status === "available" && result.data.stage === "ATIVO", "com dois onboardings (um concluído, um novo em andamento), a jornada geral continua ATIVO");
  }

  console.log("[test] FASE 1C.1 -- onboarding cancelado em cliente ativo -- jornada continua ATIVO (CANCELLED já era excluído, agora reforçado pela regra de conta assentada)");
  {
    const result = await getClientJourney(fakeDb({ clientStatus: "ativo", onboarding: { id: "onb-3", status: "CANCELLED", progress: 20 } }), "company-cancelado");
    assert(result.status === "available" && result.data.stage === "ATIVO", "onboarding CANCELLED nunca decide a jornada, com ou sem a conta já ativada");
  }

  console.log("[test] migration 101 pendente (tabela client_onboardings ausente) -- jornada continua disponível, só onboarding fica ausente (best-effort)");
  {
    const result = await getClientJourney(fakeDb({ clientStatus: "ativo", onboardingThrows: true }), "company-a");
    assert(result.status === "available", "jornada NUNCA cai inteira por causa de uma tabela opcional (SQL 101) ainda não aplicada");
    assert(result.status === "available" && result.data.stage === "ATIVO", "stage calculado normalmente a partir dos eixos que já existem");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
