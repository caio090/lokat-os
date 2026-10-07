/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/client-projects-admin/__tests__/adapters.structural.test.ts
 * Retomada do produto — prova o comportamento mais arriscado deste
 * domínio: scope_category (SQL 99, DB MIGRATION PENDING) é tentado
 * primeiro; se a coluna ainda não existir (42703), a função refaz a
 * mesma operação SEM o campo aditivo, nunca falhando a operação
 * principal (criar/listar o projeto) por causa de um campo opcional
 * que ainda não existe.
 */
import { getClientProjects, createClientProject } from "../adapters";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const UNDEFINED_COLUMN_ERR = { code: "42703", message: 'column "scope_category" does not exist' };

/** Simula: SELECT/INSERT com scope_category falha (coluna não existe), SEM ele funciona. */
function fakeDbScopeColumnMissing() {
  let insertCallCount = 0;
  const rowNoScope = { id: "p1", client_id: "company-a", title: "Outlet", description: null, status: "active", progress: 0, start_date: null, due_date: null, visible_to_client: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
  return {
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          order: () => {
            if (cols.includes("scope_category")) return Promise.resolve({ data: null, error: UNDEFINED_COLUMN_ERR });
            return Promise.resolve({ data: [rowNoScope], error: null });
          },
        }),
      }),
      insert: (payload: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            insertCallCount++;
            if ("scope_category" in payload) return Promise.resolve({ data: null, error: UNDEFINED_COLUMN_ERR });
            return Promise.resolve({ data: { id: "p2" }, error: null });
          },
        }),
      }),
    }),
    getInsertCallCount: () => insertCallCount,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakeDbScopeColumnPresent() {
  const row = { id: "p1", client_id: "company-a", title: "Outlet", description: null, status: "active", progress: 0, start_date: null, due_date: null, visible_to_client: true, scope_category: "contratado", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
  return {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [row], error: null }) }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "p2" }, error: null }) }) }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function main() {
  console.log("[test] scope_category pendente (SQL 99) -- list funciona mesmo sem a coluna, scopeCategory=null");
  {
    const result = await getClientProjects(fakeDbScopeColumnMissing(), "company-a");
    assert(result.status === "available", "lista continua funcionando -- nunca bloqueia a operação principal por causa do campo aditivo");
    assert(result.status === "available" && result.data[0]?.scopeCategory === null, "scopeCategory=null quando a coluna ainda não existe (nunca inventado)");
  }

  console.log("[test] scope_category pendente -- create funciona (retry automático sem o campo), scopeCategoryApplied=false");
  {
    const db = fakeDbScopeColumnMissing();
    const result = await createClientProject(db, "company-a", "user-1", { title: "Outlet Mulheres Empreendedoras", scopeCategory: "contratado" });
    assert(result.ok === true, "criação do projeto NUNCA falha por causa de um campo aditivo pendente");
    assert(result.ok === true && result.scopeCategoryApplied === false, "scopeCategoryApplied=false avisa a UI que o campo não foi de fato salvo ainda");
    assert(db.getInsertCallCount() === 2, "exatamente 2 tentativas de insert: com scope_category (falha), sem ele (sucesso) -- nunca mais que isso");
  }

  console.log("[test] schema completo (SQL 99 aplicado) -- scope_category funciona de primeira");
  {
    const result = await getClientProjects(fakeDbScopeColumnPresent(), "company-a");
    assert(result.status === "available" && result.data[0]?.scopeCategory === "contratado", "scopeCategory real retornado quando a coluna existe");

    const writeResult = await createClientProject(fakeDbScopeColumnPresent(), "company-a", "user-1", { title: "Projeto", scopeCategory: "bonus" });
    assert(writeResult.ok === true && writeResult.scopeCategoryApplied === true, "scopeCategoryApplied=true quando a migration já foi aplicada");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
