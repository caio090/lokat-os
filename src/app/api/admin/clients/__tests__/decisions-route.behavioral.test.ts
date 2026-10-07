/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/admin/clients/__tests__/decisions-route.behavioral.test.ts
 * (arquivo fica FORA de [id]/ de propósito -- mesmo motivo de
 * archive-route.behavioral.test.ts: o runner de teste do Node
 * interpreta colchetes no caminho como glob.)
 *
 * Retomada do produto — chama o handler POST REAL de
 * src/app/api/admin/clients/[id]/decisions/route.ts. Prova: acesso
 * negado nunca chega a chamar o adapter; migration pendente retorna
 * 503 DB_MIGRATION_PENDING honesto, nunca um 200 fingido.
 */
import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/workspaces/assert-not-preview", {
  exports: { withMutationProtection: (handler: (...args: unknown[]) => unknown) => handler },
});

function req(body: unknown) {
  return new Request("http://x/api/admin/clients/company-a/decisions", { method: "POST", body: JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function loadRouteWith(t: TestContext, opts: {
  auth?: { ok: true; companyId: string; userId: string | null } | { ok: false; status: 401 | 403; error: string };
  createResult?: { ok: true; id: string } | { ok: false; reason: "schema_not_applied" | "internal_error" | "validation_error" };
}) {
  let createCalls = 0;
  // client-admin-write/authorize.ts não é importado com cache-busting
  // (fica dentro de route.ts) -- mockar as dependências dele
  // (@/lib/company-context/resolve, @/lib/supabase/server) em vez dele
  // mesmo "congelaria" o primeiro teste que o carregasse, ignorando os
  // mocks dos testes seguintes (mesma armadilha já documentada em
  // onboarding-profile-route.behavioral.test.ts). Mockar o próprio
  // authorize.ts evita o vazamento entre testes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/client-admin-write/authorize", {
    exports: { authorizeClientWrite: async () => opts.auth ?? { ok: false, status: 401, error: "not_authenticated" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", {
    exports: { createServerSupabaseClient: async () => ({}), createSupabaseAdminClient: () => ({}), hasSupabaseServiceRoleKey: () => true },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-decisions/adapters", {
    exports: {
      createCompanyDecision: async () => { createCalls++; return opts.createResult ?? { ok: true, id: "decision-1" }; },
    },
  });
  const mod = await import(`../[id]/decisions/route.ts?t=${Date.now()}-${Math.random()}`);
  return { POST: mod.POST, getCreateCalls: () => createCalls };
}

test("Company autorizada + schema aplicado -- 200, decisão criada", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    auth: { ok: true, companyId: "company-a", userId: "user-1" },
    createResult: { ok: true, id: "decision-1" },
  });
  const res = await POST(req({ title: "Teste", decision: "Decidimos testar" }), ctx("company-a"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(getCreateCalls(), 1);
});

test("Company não autorizada -- 403, adapter NUNCA chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    auth: { ok: false, status: 403, error: "Sem permissão para esta Company." },
  });
  const res = await POST(req({ title: "Teste", decision: "x" }), ctx("company-a"));
  assert.equal(res.status, 403);
  assert.equal(getCreateCalls(), 0, "negação de autorização é FINAL -- nunca tenta salvar mesmo assim");
});

test("usuário não autenticado -- 401, adapter NUNCA chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    auth: { ok: false, status: 401, error: "Sessão/Company necessária." },
  });
  const res = await POST(req({ title: "Teste", decision: "x" }), ctx("company-a"));
  assert.equal(res.status, 401);
  assert.equal(getCreateCalls(), 0);
});

test("migration pendente (SQL 99) -- 503 DB_MIGRATION_PENDING honesto, nunca um 200 fingido", async (t) => {
  const { POST } = await loadRouteWith(t, {
    auth: { ok: true, companyId: "company-a", userId: "user-1" },
    createResult: { ok: false, reason: "schema_not_applied" },
  });
  const res = await POST(req({ title: "Teste", decision: "Decidimos testar" }), ctx("company-a"));
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, "DB_MIGRATION_PENDING");
  assert.equal(body.ok, undefined, "nunca retorna ok:true quando a migration está pendente");
});

test("title/decision ausentes -- 400, adapter NUNCA chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    auth: { ok: true, companyId: "company-a", userId: "user-1" },
  });
  const res = await POST(req({ title: "" }), ctx("company-a"));
  assert.equal(res.status, 400);
  assert.equal(getCreateCalls(), 0);
});
