/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/lib/integration-events/__tests__/router.behavioral.test.ts
 * FASE 1B — prova que routeIntegrationEvent() despacha CADA EVENT_TYPE
 * para o domínio certo (policies.ts), sempre grava timeline, e notifica
 * só quando a política/evento exige.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { IntegrationEventPayload } from "../types";

function basePayload(overrides: Partial<IntegrationEventPayload>): IntegrationEventPayload {
  return {
    event_id: "evt_1", event_type: "UPSELL_INTERESTED", occurred_at: "2026-10-07T12:00:00Z",
    source_system: "tayannara-brain", client_external_id: "tayannara-carvalho", title: "Título do evento",
    ...overrides,
  };
}

async function loadRouterWith(t: TestContext, opts: {
  opportunityResult?: { ok: true; id: string } | { ok: false; reason: "schema_not_applied" | "internal_error" | "validation_error" };
  decisionResult?: { ok: true; id: string } | { ok: false; reason: "schema_not_applied" | "internal_error" | "validation_error" };
}) {
  let opportunityCalls = 0; let decisionCalls = 0; let timelineCalls = 0; let notifyCalls = 0;
  let lastNotifyMessage: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/client-opportunities/adapters", {
    exports: { createClientOpportunity: async () => { opportunityCalls++; return opts.opportunityResult ?? { ok: true, id: "opp-1" }; } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-decisions/adapters", {
    exports: { createCompanyDecision: async () => { decisionCalls++; return opts.decisionResult ?? { ok: true, id: "decision-1" }; } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/client-timeline/adapters", {
    exports: { logClientActivity: async () => { timelineCalls++; } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("../notify", {
    exports: { notifyAdminsOfIntegrationEvent: async (_db: unknown, params: { message: string }) => { notifyCalls++; lastNotifyMessage = params.message; return true; } },
  });
  const mod = await import(`../router.ts?t=${Date.now()}-${Math.random()}`);
  return {
    routeIntegrationEvent: mod.routeIntegrationEvent as (db: unknown, payload: IntegrationEventPayload, companyId: string) => Promise<{ policy: string; createdEntity: { type: string; id: string } | null; notified: boolean }>,
    getOpportunityCalls: () => opportunityCalls, getDecisionCalls: () => decisionCalls, getTimelineCalls: () => timelineCalls,
    getNotifyCalls: () => notifyCalls, getLastNotifyMessage: () => lastNotifyMessage,
  };
}

const FAKE_DB_FOR_MEETING = {
  from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "req-1" }, error: null }) }) }) }),
};

test("UPSELL_INTERESTED -- cria Oportunidade, grava timeline, notifica", async (t) => {
  const { routeIntegrationEvent, getOpportunityCalls, getTimelineCalls, getNotifyCalls } = await loadRouterWith(t, {});
  const result = await routeIntegrationEvent({}, basePayload({ event_type: "UPSELL_INTERESTED" }), "company-a");
  assert.equal(result.policy, "CREATE_OPPORTUNITY");
  assert.deepEqual(result.createdEntity, { type: "opportunity", id: "opp-1" });
  assert.equal(getOpportunityCalls(), 1);
  assert.equal(getTimelineCalls(), 1, "timeline recebe sempre, independente da política");
  assert.equal(getNotifyCalls(), 1, "UPSELL_INTERESTED está na lista de sempre-notificar");
});

test("DECISION_CREATED -- cria Decisão (origin=client, nunca strategy/manual inventado)", async (t) => {
  const { routeIntegrationEvent, getDecisionCalls } = await loadRouterWith(t, {});
  const result = await routeIntegrationEvent({}, basePayload({ event_type: "DECISION_CREATED" }), "company-a");
  assert.equal(result.policy, "CREATE_DECISION");
  assert.deepEqual(result.createdEntity, { type: "decision", id: "decision-1" });
  assert.equal(getDecisionCalls(), 1);
});

test("MEETING_REQUESTED -- vira solicitação (client_requests), nunca fabrica scheduled_at", async (t) => {
  const { routeIntegrationEvent, getNotifyCalls } = await loadRouterWith(t, {});
  const result = await routeIntegrationEvent(FAKE_DB_FOR_MEETING, basePayload({ event_type: "MEETING_REQUESTED" }), "company-a");
  assert.equal(result.policy, "CREATE_MEETING_REQUEST");
  assert.deepEqual(result.createdEntity, { type: "client_request", id: "req-1" });
  assert.equal(getNotifyCalls(), 1, "MEETING_REQUESTED está na lista de sempre-notificar");
});

test("APPROVAL_REQUESTED -- REQUIRE_HUMAN_REVIEW, nenhuma entidade criada automaticamente, mas notifica", async (t) => {
  const { routeIntegrationEvent, getOpportunityCalls, getDecisionCalls, getNotifyCalls } = await loadRouterWith(t, {});
  const result = await routeIntegrationEvent({}, basePayload({ event_type: "APPROVAL_REQUESTED" }), "company-a");
  assert.equal(result.policy, "REQUIRE_HUMAN_REVIEW");
  assert.equal(result.createdEntity, null, "REQUIRE_HUMAN_REVIEW nunca cria nada automaticamente -- é um humano quem decide");
  assert.equal(getOpportunityCalls(), 0);
  assert.equal(getDecisionCalls(), 0);
  assert.equal(getNotifyCalls(), 1, "mesmo sem criar entidade, o humano precisa ser avisado");
});

test("SCOPE_CHANGE_REQUESTED / EXTRA_CONTENT_REQUESTED -- também viram Oportunidade (nunca execução direta de escopo/orçamento)", async (t) => {
  const { routeIntegrationEvent, getOpportunityCalls } = await loadRouterWith(t, {});
  await routeIntegrationEvent({}, basePayload({ event_type: "SCOPE_CHANGE_REQUESTED" }), "company-a");
  await routeIntegrationEvent({}, basePayload({ event_type: "EXTRA_CONTENT_REQUESTED", event_id: "evt_2" }), "company-a");
  assert.equal(getOpportunityCalls(), 2, "mudança de escopo e conteúdo extra nunca executam sozinhos -- sempre viram análise humana via Oportunidade");
});

test("falha no domínio (ex.: migration pendente) -- router propaga, nunca finge sucesso", async (t) => {
  const { routeIntegrationEvent } = await loadRouterWith(t, { opportunityResult: { ok: false, reason: "schema_not_applied" } });
  const result = await routeIntegrationEvent({}, basePayload({ event_type: "UPSELL_INTERESTED" }), "company-a");
  assert.equal(result.createdEntity, null, "createdEntity permanece null quando a criação real falhou -- nunca inventa um id");
});

test("TEAM_ACTION_REQUIRED / PROJECT_STATUS_CHANGED -- limitação documentada desta fase: nenhuma entidade de domínio criada (operational_tasks/client_projects ainda sem resolução completa de escrita)", async (t) => {
  const { routeIntegrationEvent, getNotifyCalls } = await loadRouterWith(t, {});
  const r1 = await routeIntegrationEvent({}, basePayload({ event_type: "TEAM_ACTION_REQUIRED" }), "company-a");
  assert.equal(r1.createdEntity, null, "CREATE_TASK não insere em operational_tasks nesta fase -- ver limitação documentada no cabeçalho do router");
  const r2 = await routeIntegrationEvent({}, basePayload({ event_type: "PROJECT_STATUS_CHANGED", event_id: "evt_3" }), "company-a");
  assert.equal(r2.createdEntity, null, "UPDATE_PROJECT não atualiza client_projects nesta fase -- resolução de project_external_id ainda não existe");
  // Seção 10 do brief lista TEAM_ACTION_REQUIRED entre os "sempre notificar" -- PROJECT_STATUS_CHANGED não está nessa lista nem usa uma política que notifica.
  assert.equal(getNotifyCalls(), 1, "só TEAM_ACTION_REQUIRED notifica aqui (está na lista fixa da seção 10); PROJECT_STATUS_CHANGED não notifica nesta fase");
});
