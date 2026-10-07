/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/integrations/events/__tests__/route.behavioral.test.ts
 * FASE 1B — chama o handler POST REAL de route.ts. A VERIFICAÇÃO DE
 * ASSINATURA RODA DE VERDADE (signature.ts NUNCA é mockado) -- prova
 * autenticação real ponta a ponta, não só a fiação. Mocka só as
 * dependências de I/O (sources/client-resolution/adapters/router).
 */
import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const SECRET = "test-secret-fase-1b";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/workspaces/assert-not-preview", {
  exports: { withMutationProtection: (handler: (...args: unknown[]) => unknown) => handler },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/supabase/server", {
  exports: { createSupabaseAdminClient: () => ({}), hasSupabaseServiceRoleKey: () => true },
});

function sign(timestamp: string, rawBody: string): string {
  return createHmac("sha256", SECRET).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

function req(body: unknown, opts: { source?: string | null; timestamp?: string; signature?: string | null; badSignature?: boolean } = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = opts.signature === null ? undefined : opts.signature ?? (opts.badSignature ? "0".repeat(64) : sign(timestamp, rawBody));
  const headers: Record<string, string> = {};
  if (opts.source !== null) headers["x-lokat-source"] = opts.source ?? "tayannara-brain";
  headers["x-lokat-timestamp"] = timestamp;
  if (signature !== undefined) headers["x-lokat-signature"] = signature;
  return new Request("http://x/api/integrations/events", { method: "POST", headers, body: rawBody });
}

const VALID_PAYLOAD = {
  event_id: "evt_001", event_type: "UPSELL_INTERESTED", occurred_at: "2026-10-07T12:00:00Z",
  source_system: "tayannara-brain", client_external_id: "tayannara-carvalho", title: "Interesse em vídeos extras",
};

async function loadRouteWith(t: TestContext, opts: {
  sourceConfigured?: boolean;
  clientResolution?: { status: "available"; data: { clientId: string } | null } | { status: "unavailable"; reason: "schema_not_applied" | "internal_error" };
  insertResult?: { outcome: "inserted"; id: string } | { outcome: "duplicate" } | { outcome: "error"; reason: "schema_not_applied" | "internal_error" };
  routeThrows?: boolean;
}) {
  const markStatusCalls: string[] = [];
  let routeCalls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/integration-events/sources", {
    exports: {
      getIntegrationSource: (s: string) => (s === "tayannara-brain" ? { sourceSystem: s, label: "Cérebro Tayannara", secretEnvVar: "X", status: opts.sourceConfigured === false ? "pending" : "configured" } : null),
      getIntegrationSourceSecret: (s: string) => (s === "tayannara-brain" && opts.sourceConfigured !== false ? SECRET : null),
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/integration-events/client-resolution", {
    exports: { resolveClientExternalId: async () => opts.clientResolution ?? { status: "available", data: { clientId: "company-a" } } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/integration-events/adapters", {
    exports: {
      insertIntegrationEvent: async () => opts.insertResult ?? { outcome: "inserted", id: "row-1" },
      markEventStatus: async (_db: unknown, _id: string, status: string) => { markStatusCalls.push(status); },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/integration-events/router", {
    exports: {
      routeIntegrationEvent: async () => {
        routeCalls++;
        if (opts.routeThrows) throw new Error("falha simulada no roteamento");
        return { policy: "CREATE_OPPORTUNITY", createdEntity: { type: "opportunity", id: "opp-1" }, notified: true };
      },
    },
  });
  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return { POST: mod.POST, getMarkStatusCalls: () => markStatusCalls, getRouteCalls: () => routeCalls };
}

test("payload válido + assinatura correta -- 202, processado", async (t) => {
  const { POST, getRouteCalls, getMarkStatusCalls } = await loadRouteWith(t, {});
  const res = await POST(req(VALID_PAYLOAD));
  const body = await res.json();
  assert.equal(res.status, 202);
  assert.equal(body.accepted, true);
  assert.equal(body.status, "processed");
  assert.equal(getRouteCalls(), 1);
  assert.deepEqual(getMarkStatusCalls(), ["processing", "processed"]);
});

test("assinatura incorreta -- 401, nunca chega a registrar/rotear o evento", async (t) => {
  const { POST, getRouteCalls } = await loadRouteWith(t, {});
  const res = await POST(req(VALID_PAYLOAD, { badSignature: true }));
  assert.equal(res.status, 401);
  assert.equal(getRouteCalls(), 0, "assinatura inválida é FINAL -- nunca processa mesmo assim");
});

test("timestamp vencido -- 401 (proteção contra replay), nunca processa", async (t) => {
  const { POST, getRouteCalls } = await loadRouteWith(t, {});
  const oldTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);
  const rawBody = JSON.stringify(VALID_PAYLOAD);
  const res = await POST(req(VALID_PAYLOAD, { timestamp: oldTimestamp, signature: sign(oldTimestamp, rawBody) }));
  assert.equal(res.status, 401);
  assert.equal(getRouteCalls(), 0);
});

test("source_system desconhecido -- 403, nunca verifica assinatura contra nenhum segredo real", async (t) => {
  const { POST, getRouteCalls } = await loadRouteWith(t, {});
  const res = await POST(req(VALID_PAYLOAD, { source: "sistema-nunca-registrado", signature: "qualquercoisa" }));
  assert.equal(res.status, 403);
  assert.equal(getRouteCalls(), 0);
});

test("source_system registrado mas sem segredo configurado (pendente) -- 403, nunca processa sem poder verificar", async (t) => {
  const { POST, getRouteCalls } = await loadRouteWith(t, { sourceConfigured: false });
  const res = await POST(req(VALID_PAYLOAD, { signature: "qualquercoisa" }));
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, "SOURCE_NOT_CONFIGURED");
  assert.equal(getRouteCalls(), 0);
});

test("payload inválido (event_type fora do enum) -- 400, nunca chega a identificar cliente", async (t) => {
  const { POST, getRouteCalls } = await loadRouteWith(t, {});
  const badPayload = { ...VALID_PAYLOAD, event_type: "TIPO_INVENTADO" };
  const res = await POST(req(badPayload));
  assert.equal(res.status, 400);
  assert.equal(getRouteCalls(), 0);
});

test("payload inválido (title ausente) -- 400", async (t) => {
  const { POST } = await loadRouteWith(t, {});
  const payloadWithoutTitle: Record<string, unknown> = { ...VALID_PAYLOAD };
  delete payloadWithoutTitle.title;
  const res = await POST(req(payloadWithoutTitle));
  assert.equal(res.status, 400);
});

test("cliente desconhecido (client_external_id não vinculado) -- evento registrado mas ignorado, nunca roteado", async (t) => {
  const { POST, getRouteCalls, getMarkStatusCalls } = await loadRouteWith(t, {
    clientResolution: { status: "available", data: null },
  });
  const res = await POST(req(VALID_PAYLOAD));
  const body = await res.json();
  assert.equal(res.status, 422);
  assert.equal(body.reason, "client_external_id_not_linked");
  assert.equal(getRouteCalls(), 0, "sem Company resolvida, nenhuma ação de domínio é tentada");
  assert.deepEqual(getMarkStatusCalls(), ["ignored"]);
});

test("event_id duplicado -- 200 (não 202), nunca roteia de novo", async (t) => {
  const { POST, getRouteCalls } = await loadRouteWith(t, { insertResult: { outcome: "duplicate" } });
  const res = await POST(req(VALID_PAYLOAD));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(getRouteCalls(), 0, "duplicado nunca gera uma segunda oportunidade/tarefa/reunião");
});

test("migration pendente (SQL 100) na identificação do cliente -- 503 DB_MIGRATION_PENDING, nunca finge sucesso", async (t) => {
  const { POST } = await loadRouteWith(t, { clientResolution: { status: "unavailable", reason: "schema_not_applied" } });
  const res = await POST(req(VALID_PAYLOAD));
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, "DB_MIGRATION_PENDING");
});

test("migration pendente (SQL 100) no registro do evento -- 503 DB_MIGRATION_PENDING", async (t) => {
  const { POST } = await loadRouteWith(t, { insertResult: { outcome: "error", reason: "schema_not_applied" } });
  const res = await POST(req(VALID_PAYLOAD));
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, "DB_MIGRATION_PENDING");
});

test("falha durante o roteamento -- marca failed, 500 sem vazar detalhe interno, nunca finge que processou", async (t) => {
  const { POST, getMarkStatusCalls } = await loadRouteWith(t, { routeThrows: true });
  const res = await POST(req(VALID_PAYLOAD));
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(JSON.stringify(body).includes("falha simulada"), false, "mensagem de erro interna nunca vaza para o cliente externo");
  assert.deepEqual(getMarkStatusCalls(), ["processing", "failed"]);
});
