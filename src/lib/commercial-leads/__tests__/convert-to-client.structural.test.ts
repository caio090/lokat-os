/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/commercial-leads/__tests__/convert-to-client.structural.test.ts
 * LKT (clientes/Supabase) — PROMPT 02: prova o gap original ("Converter
 * em cliente" sem criar/vincular nada) e os reforços pedidos na revisão:
 * nunca escolhe silenciosamente entre candidatos ambíguos, nunca
 * mascara erro de busca como "não encontrado", e uma tentativa repetida
 * após falha parcial reaproveita o cliente já criado (nunca duplica).
 */
import { convertLeadToClient, type LeadForConversion } from "../convert-to-client";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function lead(partial: Partial<LeadForConversion> & { id: string }): LeadForConversion {
  return { company_name: "Empresa Teste", contact_name: "Fulano", contact_email: "fulano@teste.com", contact_phone: "85999999999", client_id: null, ...partial };
}

/** Fake db genérico: `clientsByColumn` mapeia coluna -> valor -> lista de ids encontrados (simula múltiplos matches reais). */
function fakeDb(opts: {
  clientsByColumn?: Record<string, Record<string, string[]>>;
  insertClient?: { id: string } | { error: string };
  updateLead?: Record<string, unknown> | { error: string };
}) {
  const insertCalls: Record<string, unknown>[] = [];
  const db = {
    // PROMPT 04 -- convertLeadToClient tenta a RPC atômica primeiro; nos
    // testes do fallback em JS, a RPC "não existe" (migration 102 pendente).
    rpc: () => Promise.resolve({ data: null, error: { code: "42883", message: 'function "convert_lead_to_client" does not exist' } }),
    from: (table: string) => {
      if (table === "clients") {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              const ids = opts.clientsByColumn?.[col]?.[val] ?? [];
              return Promise.resolve({ data: ids.map((id) => ({ id })), error: null });
            },
          }),
          insert: (payload: Record<string, unknown>) => {
            insertCalls.push(payload);
            if (opts.insertClient && "error" in opts.insertClient) return { select: () => ({ single: () => Promise.resolve({ data: null, error: { message: opts.insertClient && "error" in opts.insertClient ? opts.insertClient.error : "" } }) }) };
            return { select: () => ({ single: () => Promise.resolve({ data: opts.insertClient ?? { id: "client-novo" }, error: null }) }) };
          },
        };
      }
      if (table === "commercial_leads") {
        return {
          update: () => ({
            eq: () => ({
              select: () => ({
                single: () => {
                  if (opts.updateLead && "error" in opts.updateLead) return Promise.resolve({ data: null, error: { message: opts.updateLead && "error" in opts.updateLead ? opts.updateLead.error : "" } });
                  return Promise.resolve({ data: opts.updateLead ?? { id: "l", client_id: "client-novo", pipeline_stage: "fechado" }, error: null });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    getInsertCalls: () => insertCalls,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db as any;
}

async function main() {
  console.log("[test] CENÁRIO 02 -- lead já convertido: idempotente, nunca cria/duplica nada novo");
  {
    const db = fakeDb({});
    const result = await convertLeadToClient(db, lead({ id: "l1", client_id: "client-existente" }), "user-1");
    assert(result.ok === true && result.clientId === "client-existente", "retorna o client_id já vinculado, sem tentar nada novo");
    assert(db.getInsertCalls().length === 0, "nenhuma tentativa de insert quando já está convertido");
  }

  console.log("[test] CENÁRIO 03 -- cliente existente identificado por e-mail válido, nunca duplica");
  {
    const db = fakeDb({ clientsByColumn: { email: { "fulano@teste.com": ["client-por-email"] } }, updateLead: { id: "l1", client_id: "client-por-email", pipeline_stage: "fechado" } });
    const result = await convertLeadToClient(db, lead({ id: "l1" }), "user-1");
    assert(result.ok === true && result.clientId === "client-por-email" && result.clientCreated === false, "reaproveita o cliente encontrado por e-mail, clientCreated=false");
    assert(db.getInsertCalls().length === 0, "nunca chama insert quando o dedup por e-mail já encontrou um cliente");
  }

  console.log("[test] CENÁRIO 04 -- cliente existente identificado por telefone válido (sem e-mail)");
  {
    const db = fakeDb({ clientsByColumn: { phone: { "85988887777": ["client-por-telefone"] } }, updateLead: { id: "l2", client_id: "client-por-telefone" } });
    const result = await convertLeadToClient(db, lead({ id: "l2", contact_email: null, contact_phone: "85988887777" }), "user-1");
    assert(result.ok === true && result.clientId === "client-por-telefone", "dedup por telefone funciona quando não há e-mail");
  }

  console.log("[test] CENÁRIO 05 -- mais de um candidato possível (e-mail e telefone apontam pra clientes DIFERENTES) -- nunca escolhe silenciosamente");
  {
    const db = fakeDb({ clientsByColumn: { email: { "fulano@teste.com": ["client-A"] }, phone: { "85999999999": ["client-B"] } } });
    const result = await convertLeadToClient(db, lead({ id: "l3" }), "user-1");
    assert(result.ok === false && result.reason === "ambiguous_match", "ambiguidade detectada -- nunca resolve por conta própria");
    assert(!result.ok && (result.candidateClientIds?.includes("client-A") ?? false) && (result.candidateClientIds?.includes("client-B") ?? false), "os dois candidatos aparecem pra revisão humana");
    assert(db.getInsertCalls().length === 0, "nenhum cliente novo criado em caso de ambiguidade");
  }

  console.log("[test] CENÁRIO 05b -- mesma coluna com dois registros (telefone duplicado entre clientes) -- também ambíguo, nunca escolhe o primeiro");
  {
    const db = fakeDb({ clientsByColumn: { email: { "fulano@teste.com": ["client-X", "client-Y"] } } });
    const result = await convertLeadToClient(db, lead({ id: "l3b" }), "user-1");
    assert(result.ok === false && result.reason === "ambiguous_match", "dois clientes com o mesmo e-mail -- ambíguo, não escolhe o primeiro da lista");
  }

  console.log("[test] CENÁRIO 06 -- lead sem telefone (só e-mail) -- dedup funciona normalmente");
  {
    const db = fakeDb({ clientsByColumn: {}, insertClient: { id: "client-so-email" }, updateLead: { id: "l4", client_id: "client-so-email" } });
    const result = await convertLeadToClient(db, lead({ id: "l4", contact_phone: null }), "user-1");
    assert(result.ok === true && result.clientCreated === true, "cria cliente normalmente quando só há e-mail e nenhum dedup encontra correspondência");
  }

  console.log("[test] CENÁRIO 07 -- lead sem e-mail (só telefone) -- dedup funciona normalmente");
  {
    const db = fakeDb({ clientsByColumn: {}, insertClient: { id: "client-so-telefone" }, updateLead: { id: "l5", client_id: "client-so-telefone" } });
    const result = await convertLeadToClient(db, lead({ id: "l5", contact_email: null }), "user-1");
    assert(result.ok === true && result.clientCreated === true, "cria cliente normalmente quando só há telefone");
  }

  console.log("[test] lead sem e-mail E sem telefone -- rejeitado antes de qualquer busca/escrita (nenhum identificador seguro)");
  {
    const db = fakeDb({});
    const result = await convertLeadToClient(db, lead({ id: "l6", contact_email: null, contact_phone: null }), "user-1");
    assert(result.ok === false && result.reason === "no_identifier", "sem e-mail nem telefone, a conversão é rejeitada explicitamente -- nunca cria um cliente sem como evitar duplicar depois");
    assert(db.getInsertCalls().length === 0, "nenhum insert tentado");
  }

  console.log("[test] CENÁRIO 08 -- falha ao criar o cliente -- NUNCA finge sucesso, nunca vincula um client_id inexistente");
  {
    const db = fakeDb({ clientsByColumn: {}, insertClient: { error: "RLS violation" } });
    const result = await convertLeadToClient(db, lead({ id: "l7" }), "user-1");
    assert(result.ok === false && result.reason === "insert_client_failed", "falha de insert reportada explicitamente, nunca mascarada");
  }

  console.log("[test] CENÁRIO 09 -- falha ao vincular cliente e lead (cliente já existe, vínculo não)");
  {
    const db = fakeDb({ clientsByColumn: {}, insertClient: { id: "client-orfao" }, updateLead: { error: "timeout" } });
    const result = await convertLeadToClient(db, lead({ id: "l8" }), "user-1");
    assert(result.ok === false && result.reason === "link_lead_failed", "reporta falha de vínculo distinta da falha de criação -- nunca finge que o lead foi atualizado");
  }

  console.log("[test] CENÁRIO 10 -- tentativa repetida após falha parcial: a 2ª chamada encontra o cliente 'órfão' (mesmo e-mail) e vincula, nunca cria um segundo");
  {
    // 1ª tentativa: cliente criado, vínculo falha (client_id continua null no lead).
    const db1 = fakeDb({ clientsByColumn: {}, insertClient: { id: "client-orfao-2" }, updateLead: { error: "timeout" } });
    const first = await convertLeadToClient(db1, lead({ id: "l9" }), "user-1");
    assert(first.ok === false && first.reason === "link_lead_failed", "1ª tentativa: cliente criado, vínculo falhou");

    // 2ª tentativa (retry): agora o dedup por e-mail ENCONTRA o cliente órfão criado na 1ª tentativa.
    const db2 = fakeDb({ clientsByColumn: { email: { "fulano@teste.com": ["client-orfao-2"] } }, updateLead: { id: "l9", client_id: "client-orfao-2" } });
    const second = await convertLeadToClient(db2, lead({ id: "l9" }), "user-1");
    assert(second.ok === true && second.clientId === "client-orfao-2" && second.clientCreated === false, "retry reaproveita o MESMO cliente órfão -- nunca cria um segundo");
    assert(db2.getInsertCalls().length === 0, "nenhum novo insert na tentativa de recuperação");
  }

  console.log("[test] CENÁRIO 15 -- origem/histórico do lead são preservados (a função nunca sobrescreve company_name/contact_* do lead, só adiciona client_id/converted_at/pipeline_stage)");
  {
    const db = fakeDb({ clientsByColumn: {}, insertClient: { id: "client-novo-2" }, updateLead: { id: "l10", client_id: "client-novo-2", company_name: "Empresa Teste", origin: "diagnostico-marketing" } });
    const result = await convertLeadToClient(db, lead({ id: "l10" }), "user-1");
    assert(result.ok === true && (result.lead as unknown as { origin: string }).origin === "diagnostico-marketing", "campos de origem do lead (ex.: origin) continuam no retorno -- a função nunca os apaga, só faz update parcial dos 4 campos de conversão");
  }

  console.log("[test] PROMPT 03, seção 4.9 -- RISCO RESIDUAL REAL de concorrência: duas chamadas verdadeiramente simultâneas AINDA criam 2 clientes, sem UNIQUE no banco (documentado, não corrigido nesta função -- depende de migration 102, não aplicada)");
  {
    // Fake-db com barreira: as DUAS chamadas fazem o lookup (encontram 0 candidatos)
    // ANTES de qualquer uma seguir pro insert -- reproduz exatamente a janela de
    // corrida (check-then-act) que a função tem hoje, sem lock/constraint real.
    let lookupsStarted = 0;
    let releaseLookups: () => void;
    const bothLookedUp = new Promise<void>((resolve) => { releaseLookups = resolve; });
    const createdClientIds: string[] = [];

    const db = {
      rpc: () => Promise.resolve({ data: null, error: { code: "42883", message: 'function "convert_lead_to_client" does not exist' } }),
      from: (table: string) => {
        if (table === "clients") {
          return {
            select: () => ({
              eq: async () => {
                lookupsStarted++;
                if (lookupsStarted === 2) releaseLookups();
                await bothLookedUp; // as duas só continuam depois que AMBAS já pesquisaram -- a corrida real.
                return { data: [], error: null }; // as duas veem "não existe ninguém"
              },
            }),
            insert: () => {
              const newId = `client-concorrente-${createdClientIds.length + 1}`;
              createdClientIds.push(newId);
              return { select: () => ({ single: () => Promise.resolve({ data: { id: newId }, error: null }) }) };
            },
          };
        }
        if (table === "commercial_leads") {
          return { update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "l-concorrente", client_id: "qualquer" }, error: null }) }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const leadA = lead({ id: "lA" });
    const leadB = lead({ id: "lB", contact_email: "fulano@teste.com", contact_phone: "85999999999" }); // mesmo e-mail/telefone -- deveria ser o MESMO cliente
    const [resultA, resultB] = await Promise.all([
      convertLeadToClient(db, leadA, "user-1"),
      convertLeadToClient(db, leadB, "user-2"),
    ]);

    assert(resultA.ok === true && resultB.ok === true, "ambas as chamadas 'sucedem' individualmente -- nenhuma delas sabe da outra");
    assert(createdClientIds.length === 2 && createdClientIds[0] !== createdClientIds[1], "RISCO CONFIRMADO: 2 clientes diferentes foram criados pro mesmo e-mail/telefone -- a proteção de aplicação não é atômica");
    console.log("  → risco residual real, documentado em docs/supabase/102-clients-email-phone-uniqueness-NOT-APPLIED.sql (não aplicada nesta missão)");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
