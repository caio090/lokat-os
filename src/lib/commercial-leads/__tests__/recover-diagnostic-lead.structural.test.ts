/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/commercial-leads/__tests__/recover-diagnostic-lead.structural.test.ts
 * PROMPT 03, seção 5 — prova a recuperação real de um diagnóstico sem
 * lead vinculado: nunca escolhe ambiguidade silenciosamente, nunca
 * mascara erro de busca, idempotente se já vinculado, nunca finge
 * vínculo quando a escrita final falha.
 */
import { recoverDiagnosticLead, type DiagnosticForRecovery } from "../recover-diagnostic-lead";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function diagnostic(partial: Partial<DiagnosticForRecovery> & { id: string }): DiagnosticForRecovery {
  return { company_name: "Empresa Teste", full_name: "Fulano", whatsapp: "85988887777", commercial_lead_id: null, ...partial };
}

function fakeDb(opts: {
  candidates?: string[] | { error: string };
  insertLead?: { id: string } | { error: string };
  updateDiagnostic?: Record<string, unknown> | { error: string };
}) {
  const calls: string[] = [];
  const db = {
    from: (table: string) => {
      if (table === "commercial_leads") {
        return {
          select: () => ({ eq: () => {
            calls.push("lookup");
            if (opts.candidates && !Array.isArray(opts.candidates)) return Promise.resolve({ data: null, error: { message: opts.candidates.error } });
            return Promise.resolve({ data: (opts.candidates ?? []).map((id) => ({ id })), error: null });
          } }),
          insert: () => { calls.push("insert_lead"); return { select: () => ({ single: () => Promise.resolve(opts.insertLead && "error" in opts.insertLead ? { data: null, error: { message: opts.insertLead.error } } : { data: opts.insertLead ?? { id: "lead-novo" }, error: null }) }) }; },
        };
      }
      if (table === "marketing_diagnostics") {
        const single = () => {
          calls.push("link");
          if (opts.updateDiagnostic && "error" in opts.updateDiagnostic) return Promise.resolve({ data: null, error: { message: opts.updateDiagnostic.error } });
          return Promise.resolve({ data: opts.updateDiagnostic ?? { id: "diag-1", commercial_lead_id: "lead-novo" }, error: null });
        };
        return { update: () => ({ eq: () => ({ select: () => ({ single }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    getCalls: () => calls,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db as any;
}

async function main() {
  console.log("[test] já vinculado -- idempotente, nenhuma busca/escrita nova");
  {
    const db = fakeDb({});
    const result = await recoverDiagnosticLead(db, diagnostic({ id: "d1", commercial_lead_id: "lead-existente" }), "user-1");
    assert(result.ok === true && result.leadId === "lead-existente", "retorna o lead já vinculado");
    assert(db.getCalls().length === 0, "nenhuma chamada feita quando já está vinculado");
  }

  console.log("[test] lead existente encontrado por telefone -- vincula, não cria outro");
  {
    const db = fakeDb({ candidates: ["lead-achado"] });
    const result = await recoverDiagnosticLead(db, diagnostic({ id: "d2" }), "user-1");
    assert(result.ok === true && result.leadId === "lead-achado" && result.leadCreated === false, "reaproveita o lead encontrado");
    assert(!db.getCalls().includes("insert_lead"), "nunca cria lead quando um já foi encontrado");
  }

  console.log("[test] nenhum lead encontrado -- cria um novo e vincula");
  {
    const db = fakeDb({ candidates: [], insertLead: { id: "lead-novo-2" } });
    const result = await recoverDiagnosticLead(db, diagnostic({ id: "d3" }), "user-1");
    assert(result.ok === true && result.leadCreated === true && result.leadId === "lead-novo-2", "cria lead novo quando nenhum é encontrado");
  }

  console.log("[test] mais de um lead com o mesmo telefone -- ambíguo, nunca escolhe");
  {
    const db = fakeDb({ candidates: ["lead-X", "lead-Y"] });
    const result = await recoverDiagnosticLead(db, diagnostic({ id: "d4" }), "user-1");
    assert(result.ok === false && result.reason === "ambiguous_match", "ambiguidade detectada, não resolvida silenciosamente");
    assert(!db.getCalls().includes("insert_lead"), "nenhum lead novo criado em caso de ambiguidade");
  }

  console.log("[test] erro na busca -- NUNCA tratado como 'não encontrado' (não cria lead cegamente)");
  {
    const db = fakeDb({ candidates: { error: "timeout" } });
    const result = await recoverDiagnosticLead(db, diagnostic({ id: "d5" }), "user-1");
    assert(result.ok === false && result.reason === "lookup_failed", "erro de busca reportado explicitamente");
    assert(!db.getCalls().includes("insert_lead"), "erro de busca nunca cai no caminho de criar lead novo");
  }

  console.log("[test] falha ao criar o lead -- nunca finge vínculo");
  {
    const db = fakeDb({ candidates: [], insertLead: { error: "RLS violation" } });
    const result = await recoverDiagnosticLead(db, diagnostic({ id: "d6" }), "user-1");
    assert(result.ok === false && result.reason === "insert_lead_failed", "falha de criação de lead reportada explicitamente");
  }

  console.log("[test] falha ao vincular o diagnóstico (lead já existe) -- reporta o estado real");
  {
    const db = fakeDb({ candidates: [], insertLead: { id: "lead-orfao" }, updateDiagnostic: { error: "network" } });
    const result = await recoverDiagnosticLead(db, diagnostic({ id: "d7" }), "user-1");
    assert(result.ok === false && result.reason === "link_diagnostic_failed", "falha de vínculo distinta da falha de criação do lead");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
