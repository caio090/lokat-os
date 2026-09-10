/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/studio/images/generate/__tests__/production-qa-mode.behavioral.test.ts
 * FASE 31G.2 (Production-Safe QA Mode) — chama o handler POST REAL de
 * route.ts, mockando resolveCompanyContext/getCurrentUser/Supabase/
 * createStudioVisual/createStudioVisualDryRun (cada um testado à
 * parte). Prova que `qaMode:"dry_run"` só tem efeito com
 * flag+auth+role admin REAIS (nunca confiado do cliente), e que sua
 * AUSÊNCIA preserva 100% do comportamento normal.
 */
import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * Reimplementação PURA e mínima das duas funções puras reais de
 * production-qa-authorization.ts, só pra este mock -- a implementação
 * REAL delas é verificada à parte em
 * production-qa-authorization.structural.test.ts (importada fresh lá,
 * sem a armadilha de cache transitivo que existe aqui: route.ts
 * importa production-qa-authorization.ts estaticamente, e um import
 * estático de nível de módulo do arquivo real aqui rodaria ANTES de
 * qualquer t.mock.module, quebrando em "next/headers" fora do runtime
 * do Next). Este arquivo testa a FIAÇÃO da rota, não a lógica pura.
 */
function fakeEvaluate(inputs: { requested: boolean; flagEnabled: boolean; authenticated: boolean; role: string | null }) {
  if (!inputs.requested) return "not_requested";
  if (!inputs.flagEnabled) return "flag_disabled";
  if (!inputs.authenticated) return "unauthenticated";
  if (!inputs.role || (inputs.role !== "admin" && inputs.role !== "super_admin")) return "forbidden";
  return "allowed";
}
function fakeFlagEnabled() {
  const raw = process.env.LKT_PRODUCTION_QA_DRY_RUN?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/workspaces/assert-not-preview", {
  exports: { withMutationProtection: (handler: (...args: unknown[]) => unknown) => handler },
});

function req(body: unknown) {
  return new Request("http://x/api/studio/images/generate", { method: "POST", body: JSON.stringify(body) });
}

const FAKE_NORMAL_RESULT = {
  text: { skillId: "vidigal_png", skillVersion: "2.0.0", runtime: "openai_responses_api", status: "completed", output: { briefReading: "x", creativeDirection: "x", conceptualBasis: "x", visualStructure: "x", visualGuidelines: "x", generationPrompt: "x", variations: [], adaptations: [], suggestedHeadline: "x", suggestedCta: null, layoutArchetype: "EDITORIAL_HERO", headlineZone: "BOTTOM", contrastTreatment: "SCRIM", ctaStyle: "PILL" }, warnings: [], generatedAt: new Date().toISOString() },
  image: { status: "completed", providerId: "openai-images", image: { url: "data:image/png;base64,cmVhbA==", width: 1024, height: 1024 }, warnings: [], generatedAt: new Date().toISOString() },
};

const FAKE_DRY_RUN_RESULT = {
  text: { skillId: "vidigal_png", skillVersion: "dry-run-fixture", runtime: "dry_run_fixture", status: "completed", output: { briefReading: "x", creativeDirection: "x", conceptualBasis: "x", visualStructure: "x", visualGuidelines: "x", generationPrompt: "x", variations: [], adaptations: [], suggestedHeadline: "x", suggestedCta: null, layoutArchetype: "EDITORIAL_HERO", headlineZone: "BOTTOM", contrastTreatment: "SCRIM", ctaStyle: "PILL" }, warnings: [], generatedAt: new Date().toISOString() },
  image: { status: "completed", providerId: "dry-run-mock", image: { url: "data:image/jpeg;base64,ZHJ5cnVu", width: 1080, height: 1080, mime: "image/jpeg" }, warnings: ["FIXTURE"], generatedAt: new Date().toISOString() },
  packet: { dryRun: true, fullZeroCost: true },
};

async function loadRouteWith(t: TestContext, opts: {
  resolution?: { valid: boolean; reason?: string; context: { companyId: string; companyName: string | null; workspaceId: string | null; role: string | null } | null };
  currentUser?: { id: string } | null;
  freeModeRole?: string | null;
  flagEnabled?: boolean;
}) {
  let normalCalls = 0;
  let dryRunCalls = 0;
  let lastDryRunRequest: unknown = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-context/resolve", {
    exports: { resolveCompanyContext: async () => opts.resolution ?? { valid: false, reason: "not_authenticated", context: null } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/auth/get-current-user", {
    exports: { getCurrentUser: async () => (opts.currentUser === undefined ? { id: "user-1" } : opts.currentUser) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", {
    exports: {
      createServerSupabaseClient: async () => ({}),
      createSupabaseAdminClient: () => ({}),
    },
  });
  // production-qa-authorization.ts é uma dependência TRANSITIVA de
  // route.ts (não cache-busted por ?t=), então mockar só
  // @/lib/supabase/server não é suficiente -- o binding interno dela
  // ficaria congelado no primeiro teste que a carregasse. Mockada
  // diretamente aqui (mesmo padrão do resto do arquivo: mockar as
  // dependências DIRETAS do módulo sob teste), reexportando as funções
  // PURAS reais (isProductionQaFlagEnabled/evaluateProductionQaAccess)
  // e só controlando o ÚNICO ponto assíncrono (resolveRoleForCurrentUser).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/production-qa-authorization", {
    exports: {
      isProductionQaFlagEnabled: fakeFlagEnabled,
      evaluateProductionQaAccess: fakeEvaluate,
      resolveRoleForCurrentUser: async () => opts.freeModeRole ?? null,
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/create-studio-visual", {
    exports: { createStudioVisual: async () => { normalCalls++; return FAKE_NORMAL_RESULT; } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/dry-run", {
    exports: {
      isDryRunActive: () => false, // Preview/dev-only gate -- nunca ativo nestes testes (Production simulada).
      isFullZeroCostDryRun: () => false,
      createStudioVisualDryRun: async (request: unknown) => { dryRunCalls++; lastDryRunRequest = request; return FAKE_DRY_RUN_RESULT; },
    },
  });
  if (opts.flagEnabled !== undefined) {
    if (opts.flagEnabled) process.env.LKT_PRODUCTION_QA_DRY_RUN = "1";
    else delete process.env.LKT_PRODUCTION_QA_DRY_RUN;
  }

  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return {
    POST: mod.POST,
    getNormalCalls: () => normalCalls,
    getDryRunCalls: () => dryRunCalls,
    getLastDryRunRequest: () => lastDryRunRequest,
  };
}

test("[1] ADM + flag ligada + qaMode=dry_run -- Dry Run permitido, diagnostic packet presente", async (t) => {
  const { POST, getDryRunCalls, getNormalCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "admin" } },
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaMode: "dry_run" }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(getDryRunCalls(), 1);
  assert.equal(getNormalCalls(), 0, "createStudioVisual (real, pago) NUNCA é chamado quando qaMode foi autorizado");
  assert.equal(body.dryRun, true);
  assert.equal(body.qaMode, "dry_run");
  assert.ok(body.diagnostics, "[9] diagnostic packet presente pro ADM autorizado");
});

test("[2] usuário comum (role cliente) + qaMode=dry_run -- rejeitado, NUNCA gera nem em modo normal nem dry run", async (t) => {
  const { POST, getDryRunCalls, getNormalCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "cliente" } },
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaMode: "dry_run" }));
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, "STUDIO_QA_MODE_UNAUTHORIZED");
  assert.equal(body.reason, "forbidden");
  assert.equal(getDryRunCalls(), 0);
  assert.equal(getNormalCalls(), 0, "requisição inteira é rejeitada -- nunca cai silenciosamente pro modo normal (pago) sem o usuário saber");
});

test("[3] ADM real, mas flag LKT_PRODUCTION_QA_DRY_RUN desligada + qaMode=dry_run -- rejeitado", async (t) => {
  const { POST, getDryRunCalls, getNormalCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "admin" } },
    flagEnabled: false,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaMode: "dry_run" }));
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, "STUDIO_QA_MODE_UNAUTHORIZED");
  assert.equal(body.reason, "flag_disabled");
  assert.equal(getDryRunCalls(), 0);
  assert.equal(getNormalCalls(), 0);
});

test("[4/11] request normal (sem qaMode), mesmo com flag ligada e usuário ADM -- comportamento 100% original, NUNCA recebe fixture", async (t) => {
  const { POST, getDryRunCalls, getNormalCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "admin" } },
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a" }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(getNormalCalls(), 1, "sem qaMode, createStudioVisual (real) roda normalmente, mesmo pra um ADM");
  assert.equal(getDryRunCalls(), 0);
  assert.equal(body.dryRun, undefined, "campo dryRun nem aparece na resposta -- comportamento idêntico ao de antes desta fase");
  assert.equal(body.image.providerId, "openai-images");
});

test("[8] Company real permanece isolada -- companyId/companyName resolvidos chegam intactos ao dry run, nunca trocados por Free Mode", async (t) => {
  const { POST, getLastDryRunRequest } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "admin" } },
    flagEnabled: true,
  });
  await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaMode: "dry_run" }));
  const dryRunReq = getLastDryRunRequest() as { companyId: string; companyName: string; fullZeroCost: boolean };
  assert.equal(dryRunReq.companyId, "company-a");
  assert.equal(dryRunReq.companyName, "Empresa A");
  assert.equal(dryRunReq.fullZeroCost, true, "[5/6] Production QA é SEMPRE fullZeroCost -- nunca uma opção configurável nesse caminho");
});

test("[free mode] ADM autenticado sem companyId + qaMode=dry_run -- role resolvida via profiles (resolveRoleForCurrentUser), permitido", async (t) => {
  const { POST, getDryRunCalls } = await loadRouteWith(t, {
    currentUser: { id: "user-admin" },
    freeModeRole: "super_admin",
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, qaMode: "dry_run" }));
  assert.equal(res.status, 200);
  assert.equal(getDryRunCalls(), 1);
});

test("[free mode] usuário comum sem companyId + qaMode=dry_run -- rejeitado (role real vinda do profiles, nunca do cliente)", async (t) => {
  const { POST, getDryRunCalls, getNormalCalls } = await loadRouteWith(t, {
    currentUser: { id: "user-common" },
    freeModeRole: "cliente",
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, qaMode: "dry_run" }));
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.reason, "forbidden");
  assert.equal(getDryRunCalls(), 0);
  assert.equal(getNormalCalls(), 0);
});

test("[10] duas chamadas seguidas com qaMode=dry_run (regenerate) -- ambas continuam Dry Run, nenhuma chamada normal/paga", async (t) => {
  const { POST, getDryRunCalls, getNormalCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "admin" } },
    flagEnabled: true,
  });
  const body = { skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaMode: "dry_run" };
  const res1 = await POST(req(body));
  const res2 = await POST(req(body));
  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(getDryRunCalls(), 2, "regenerate (mesma chamada de novo) permanece Dry Run nas duas vezes");
  assert.equal(getNormalCalls(), 0, "nunca converte silenciosamente pra chamada paga");
});

test("qaMode com valor arbitrário (não 'dry_run') é tratado como ausente -- comportamento normal, nunca um qaMode inventado", async (t) => {
  const { POST, getNormalCalls, getDryRunCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "admin" } },
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaMode: "full_paid_bypass_admin" }));
  assert.equal(res.status, 200);
  assert.equal(getNormalCalls(), 1);
  assert.equal(getDryRunCalls(), 0);
});
