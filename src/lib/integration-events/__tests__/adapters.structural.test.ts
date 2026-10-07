/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/integration-events/__tests__/adapters.structural.test.ts
 * FASE 1B — prova que insertIntegrationEvent() nunca gera duas linhas
 * para o mesmo (source_system, event_id), nunca confunde "migration
 * pendente" com "duplicado", e que a chave composta isola por
 * source_system corretamente.
 */
import { insertIntegrationEvent, buildIdempotencyKey } from "../adapters";
import type { IntegrationEventPayload } from "../types";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const BASE_PAYLOAD: IntegrationEventPayload = {
  event_id: "evt_001", event_type: "UPSELL_INTERESTED", occurred_at: "2026-10-07T12:00:00Z",
  source_system: "tayannara-brain", client_external_id: "tayannara-carvalho", title: "Interesse em vídeos extras",
};

function fakeDbSchemaMissing() {
  const err = { code: "42703", message: 'column "project_id" of relation "integration_webhook_events" does not exist' };
  return { from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: err }) }) }) }) } as unknown as Parameters<typeof insertIntegrationEvent>[0];
}

function fakeDbWithUniqueIndex() {
  const seen = new Set<string>();
  return {
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            const key = row.idempotency_key as string;
            if (seen.has(key)) return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
            seen.add(key);
            return Promise.resolve({ data: { id: `row-${key}` }, error: null });
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof insertIntegrationEvent>[0];
}

async function main() {
  console.log("[test] buildIdempotencyKey -- composta, nunca o event_id cru");
  {
    assert(buildIdempotencyKey("tayannara-brain", "evt_001") === "tayannara-brain:evt_001", "formato source_system:event_id");
  }

  console.log("[test] migration pendente -- degrada honestamente, nunca confundido com duplicado");
  {
    const result = await insertIntegrationEvent(fakeDbSchemaMissing(), BASE_PAYLOAD, "company-a", null, {});
    assert(result.outcome === "error", "outcome=error quando a coluna não existe");
    assert(result.outcome === "error" && result.reason === "schema_not_applied", "reason=schema_not_applied, nunca confundido com 'duplicate'");
  }

  console.log("[test] mesmo (source_system, event_id) duas vezes -- segunda é duplicate, nunca insere de novo");
  {
    const db = fakeDbWithUniqueIndex();
    const first = await insertIntegrationEvent(db, BASE_PAYLOAD, "company-a", null, {});
    assert(first.outcome === "inserted", "primeira chamada insere normalmente");
    const second = await insertIntegrationEvent(db, BASE_PAYLOAD, "company-a", null, {});
    assert(second.outcome === "duplicate", "segunda chamada com o MESMO event_id é duplicate, nunca gera uma segunda linha");
    // Reenvio 10x seguidas (retry agressivo do sistema externo) -- nunca cria nada além da primeira.
    for (let i = 0; i < 10; i++) {
      const retry = await insertIntegrationEvent(db, BASE_PAYLOAD, "company-a", null, {});
      assert(retry.outcome === "duplicate", `retry #${i + 1} continua duplicate (idempotência sob reenvio agressivo)`);
    }
  }

  console.log("[test] mesmo event_id, OUTRO source_system -- não colide (chave composta isola por provider)");
  {
    const db = fakeDbWithUniqueIndex();
    const first = await insertIntegrationEvent(db, BASE_PAYLOAD, "company-a", null, {});
    assert(first.outcome === "inserted", "primeiro sistema insere normalmente");
    const other = await insertIntegrationEvent(db, { ...BASE_PAYLOAD, source_system: "outro-sistema" }, "company-a", null, {});
    assert(other.outcome === "inserted", "mesmo event_id de outro source_system é um evento DIFERENTE, nunca tratado como duplicado");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
