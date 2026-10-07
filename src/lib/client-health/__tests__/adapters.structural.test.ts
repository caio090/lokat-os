/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/client-health/__tests__/adapters.structural.test.ts
 * FASE 1C, seção 23 — prova que cada métrica do snapshot de saúde
 * degrada de forma INDEPENDENTE: se uma fonte ainda não existir (ex.:
 * commercial_meetings.client_id, SQL 99 pendente), só aquela métrica
 * fica null/0 -- o snapshot inteiro nunca falha por causa de uma única
 * fonte ausente (seção 16: "não precisa construir CS completo agora").
 */
import { getClientHealthSnapshot } from "../adapters";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function fakeDbAllSourcesMissing() {
  const throwing = () => { throw { code: "42703" }; };
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ lt: throwing, gte: throwing, order: throwing, eq: throwing }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakeDbAllSourcesPresent() {
  const nowIso = new Date().toISOString();
  return {
    from: (table: string) => {
      if (table === "commercial_meetings") {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { scheduled_at: "2026-09-01T10:00:00Z" } }) }) }) }),
              gte: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { title: "Revisão mensal", scheduled_at: "2026-11-01T10:00:00Z" } }) }) }) }),
            }),
          }),
        };
      }
      if (table === "activity_logs") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { created_at: nowIso } }) }) }) }) }) };
      }
      if (table === "client_requests") {
        return { select: () => ({ eq: () => ({ eq: () => ({ in: () => Promise.resolve({ count: 2 }) }) }) }) };
      }
      if (table === "approvals") {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0 }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function main() {
  console.log("[test] todas as fontes ausentes (migrations pendentes) -- snapshot continua 'available', tudo null/0 (nunca um erro)");
  {
    const result = await getClientHealthSnapshot(fakeDbAllSourcesMissing(), "company-a");
    assert(result.status === "available", "status=available mesmo com TODAS as fontes falhando -- cada uma é best-effort independente");
    if (result.status !== "available") throw new Error("unreachable");
    assert(result.data.lastMeetingAt === null && result.data.nextMeetingAt === null, "reuniões null quando a fonte falha");
    assert(result.data.openOpportunitiesCount === 0 && result.data.pendingApprovalsCount === 0, "contagens caem para 0, nunca para um erro");
  }

  console.log("[test] todas as fontes presentes -- snapshot real preenchido");
  {
    const result = await getClientHealthSnapshot(fakeDbAllSourcesPresent(), "company-tayannara");
    if (result.status !== "available") throw new Error("unreachable");
    assert(result.data.lastContactAt !== null, "último contato preenchido quando activity_logs existe");
    assert(result.data.nextMeetingTitle === "Revisão mensal", "título da próxima reunião propagado");
    assert(result.data.openOpportunitiesCount === 2, "contagem real de oportunidades abertas propagada");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
