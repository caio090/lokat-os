/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/marketing-diagnostics/__tests__/route.behavioral.test.ts
 * PROMPT 02 (seção 27) — chama o handler POST real. Prova que cada
 * etapa (salvar diagnóstico / criar-ou-atualizar lead / vincular) é
 * verificada por `error` explícito, nunca só por try/catch -- uma
 * falha de lookup/insert/update nunca gera um lead duplicado nem
 * finge que o vínculo aconteceu quando não aconteceu.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

interface Scenario {
  insertDiag?: { id: string } | { error: string };
  leadLookup?: { id: string } | null | { error: string };
  updateExistingLead?: { error: string } | null;
  insertNewLead?: { id: string } | { error: string };
  linkDiagToLead?: { error: string } | null;
}

function fakeSupabase(scenario: Scenario, calls: { table: string; op: string }[]) {
  return {
    from: (table: string) => {
      if (table === "marketing_diagnostics") {
        return {
          insert: () => { calls.push({ table, op: "insert" }); return { select: () => ({ single: () => Promise.resolve(scenario.insertDiag && "error" in scenario.insertDiag ? { data: null, error: { message: scenario.insertDiag.error } } : { data: scenario.insertDiag ?? { id: "diag-1" }, error: null }) }) }; },
          update: () => { calls.push({ table, op: "update_link" }); return { eq: () => Promise.resolve(scenario.linkDiagToLead && "error" in scenario.linkDiagToLead ? { error: { message: scenario.linkDiagToLead.error } } : { error: null }) }; },
        };
      }
      if (table === "commercial_leads") {
        return {
          select: () => ({ eq: () => ({ order: () => ({ limit: () => ({
            maybeSingle: () => {
              calls.push({ table, op: "lookup" });
              if (scenario.leadLookup && "error" in scenario.leadLookup) return Promise.resolve({ data: null, error: { message: scenario.leadLookup.error } });
              return Promise.resolve({ data: scenario.leadLookup ?? null, error: null });
            },
          }) }) }) }),
          update: () => { calls.push({ table, op: "update_existing" }); return { eq: () => Promise.resolve(scenario.updateExistingLead && "error" in scenario.updateExistingLead ? { error: { message: scenario.updateExistingLead.error } } : { error: null }) }; },
          insert: () => { calls.push({ table, op: "insert_new" }); return { select: () => ({ single: () => Promise.resolve(scenario.insertNewLead && "error" in scenario.insertNewLead ? { data: null, error: { message: scenario.insertNewLead.error } } : { data: scenario.insertNewLead ?? { id: "lead-novo" }, error: null }) }) }; },
        };
      }
      if (table === "notifications") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function loadRouteWith(t: TestContext, scenario: Scenario) {
  const calls: { table: string; op: string }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@supabase/supabase-js", {
    exports: { createClient: () => fakeSupabase(scenario, calls) },
  });
  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return { POST: mod.POST as (req: Request) => Promise<Response>, calls };
}

function postReq(body: Record<string, unknown>) {
  return new Request("http://x/api/marketing-diagnostics", { method: "POST", body: JSON.stringify(body) });
}

const VALID_BODY = {
  full_name: "Fulano", company_name: "Empresa X", whatsapp: "85988887777",
  business_type: "restaurante", main_problem: "poucos pedidos",
};

test("diagnóstico salvo com sucesso + lead novo criado (nenhum lead existente encontrado)", async (t) => {
  const { POST, calls } = await loadRouteWith(t, { leadLookup: null, insertNewLead: { id: "lead-novo" } });
  const res = await POST(postReq(VALID_BODY));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.ok(calls.some((c) => c.op === "insert_new"), "chamou insert de lead novo");
  assert.ok(!calls.some((c) => c.op === "update_existing"), "nunca tentou update de lead existente quando não havia nenhum");
  assert.ok(calls.some((c) => c.op === "update_link"), "vinculou o diagnóstico ao lead criado");
});

test("lead existente (mesmo telefone) é ATUALIZADO, nunca duplicado", async (t) => {
  const { POST, calls } = await loadRouteWith(t, { leadLookup: { id: "lead-existente" } });
  const res = await POST(postReq(VALID_BODY));
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.op === "update_existing"), "atualizou o lead existente");
  assert.ok(!calls.some((c) => c.op === "insert_new"), "NUNCA insere um novo lead quando um já foi encontrado pelo telefone");
});

test("falha ao salvar o diagnóstico -- 500, nenhuma tentativa de lead é feita", async (t) => {
  const { POST, calls } = await loadRouteWith(t, { insertDiag: { error: "db down" } });
  const res = await POST(postReq(VALID_BODY));
  assert.equal(res.status, 500);
  assert.equal(calls.some((c) => c.table === "commercial_leads"), false, "nenhuma operação de lead é tentada se o diagnóstico nem foi salvo");
});

test("falha no LOOKUP do lead existente -- NUNCA cai no 'senão' e cria um lead novo (evita duplicar exatamente quando o dedup falhou)", async (t) => {
  const { POST, calls } = await loadRouteWith(t, { leadLookup: { error: "timeout" } });
  const res = await POST(postReq(VALID_BODY));
  const json = await res.json();
  assert.equal(res.status, 200, "a resposta ao cliente do formulário continua 200 -- a resposta dele foi salva de verdade");
  assert.equal(json.success, true);
  assert.ok(!calls.some((c) => c.op === "insert_new"), "falha no lookup NUNCA deve cair no caminho de criar lead novo");
  assert.ok(!calls.some((c) => c.op === "update_existing"), "e também não tenta atualizar, já que não sabe se existe");
  assert.ok(!calls.some((c) => c.op === "update_link"), "sem leadId, nunca tenta vincular o diagnóstico a nada");
});

test("falha ao CRIAR o lead novo -- diagnóstico continua salvo, sem lead vinculado (nunca finge sucesso de lead)", async (t) => {
  const { POST, calls } = await loadRouteWith(t, { leadLookup: null, insertNewLead: { error: "RLS violation" } });
  const res = await POST(postReq(VALID_BODY));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.success, true, "resposta do diagnóstico continua honesta (foi salva de verdade)");
  assert.ok(!calls.some((c) => c.op === "update_link"), "sem lead criado, nunca tenta vincular um id inexistente");
});

test("falha ao ATUALIZAR lead existente -- não impede o vínculo nem derruba a resposta", async (t) => {
  const { POST, calls } = await loadRouteWith(t, { leadLookup: { id: "lead-existente" }, updateExistingLead: { error: "constraint violation" } });
  const res = await POST(postReq(VALID_BODY));
  assert.equal(res.status, 200);
  // leadId já foi atribuído antes do update de notas/estágio -- o vínculo ao diagnóstico ainda deve ocorrer.
  assert.ok(calls.some((c) => c.op === "update_link"), "o vínculo ao diagnóstico ocorre mesmo que a atualização de notas/estágio do lead tenha falhado");
});

test("falha ao VINCULAR o diagnóstico ao lead -- diagnóstico fica 'sem lead' (visível em /admin/diagnosticos), nunca mascarado", async (t) => {
  const { POST, calls } = await loadRouteWith(t, { leadLookup: null, insertNewLead: { id: "lead-novo-2" }, linkDiagToLead: { error: "network" } });
  const res = await POST(postReq(VALID_BODY));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.ok(calls.some((c) => c.op === "update_link"), "a tentativa de vínculo aconteceu (e falhou) -- erro foi logado, não escondido");
});

test("payload inválido (sem nome) -- 422, nenhuma operação de banco é tentada", async (t) => {
  const { POST, calls } = await loadRouteWith(t, { leadLookup: null });
  const res = await POST(postReq({ ...VALID_BODY, full_name: "" }));
  assert.equal(res.status, 422);
  assert.equal(calls.length, 0, "validação falha antes de qualquer chamada ao banco");
});
