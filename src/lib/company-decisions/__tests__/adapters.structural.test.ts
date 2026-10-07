/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/company-decisions/__tests__/adapters.structural.test.ts
 * Retomada do produto — prova que o Decision Ledger da Company degrada
 * honestamente para "schema_not_applied" enquanto SQL 99 (DB MIGRATION
 * PENDING) não for aplicado em Production, e funciona normalmente
 * quando o schema existe. Mesmo padrão de company-diagnostic.
 */
import { getCompanyDecisions, createCompanyDecision, supersedeCompanyDecision } from "../adapters";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function fakeDbMissingTable() {
  const err = { code: "42P01", message: 'relation "public.company_decisions" does not exist' };
  return {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: null, error: err }) }) }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: err }) }) }),
    }),
    rpc: () => Promise.resolve({ data: null, error: err }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakeDbWorking(rows: unknown[]) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "new-decision-id" }, error: null }) }) }),
    }),
    rpc: () => Promise.resolve({ data: "new-decision-id", error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function main() {
  console.log("[test] migration pendente -- leitura degrada honestamente, nunca lança, nunca finge dado");
  {
    const result = await getCompanyDecisions(fakeDbMissingTable(), "company-a");
    assert(result.status === "unavailable", "status=unavailable quando a tabela não existe");
    assert(result.status === "unavailable" && result.reason === "schema_not_applied", "reason=schema_not_applied (42P01 reconhecido), nunca internal_error genérico");
  }

  console.log("[test] migration pendente -- criação degrada honestamente, nunca finge sucesso");
  {
    const result = await createCompanyDecision(fakeDbMissingTable(), "company-a", "user-1", { title: "x", decision: "y" });
    assert(result.ok === false, "ok=false quando a tabela não existe");
    assert(!result.ok && result.reason === "schema_not_applied", "reason=schema_not_applied");
  }

  console.log("[test] migration pendente -- supersede degrada honestamente");
  {
    const result = await supersedeCompanyDecision(fakeDbMissingTable(), "old-id", "company-a", { title: "x", decision: "y" });
    assert(result.ok === false, "ok=false quando a função RPC não existe");
    assert(!result.ok && result.reason === "schema_not_applied", "reason=schema_not_applied");
  }

  console.log("[test] schema aplicado -- leitura/escrita funcionam normalmente");
  {
    const row = {
      id: "d1", client_id: "company-a", title: "Teste", decision: "Decidimos testar", context: null,
      origin: "manual", impact: null, client_validation: "internal", belongs_to_scope: null,
      generates_task: false, generates_project: false, generates_budget: false, status: "active",
      supersedes_decision_id: null, decided_on: "2026-10-01", review_at: null, last_reviewed_at: null,
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    };
    const readResult = await getCompanyDecisions(fakeDbWorking([row]), "company-a");
    assert(readResult.status === "available", "status=available quando o schema existe");
    assert(readResult.status === "available" && readResult.data[0]?.title === "Teste", "dado real mapeado corretamente (snake_case -> camelCase)");

    const writeResult = await createCompanyDecision(fakeDbWorking([]), "company-a", "user-1", { title: "Nova decisão", decision: "Conteúdo" });
    assert(writeResult.ok === true, "criação funciona quando o schema existe");
  }

  console.log("[test] validação -- título/decisão vazios nunca chegam ao banco");
  {
    let dbCalled = false;
    const db = { from: () => { dbCalled = true; return fakeDbWorking([]).from(); } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await createCompanyDecision(db as any, "company-a", "user-1", { title: "", decision: "" });
    assert(result.ok === false, "validação rejeita título/decisão vazios");
    assert(!dbCalled, "nunca chega a consultar o banco com dados inválidos");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
