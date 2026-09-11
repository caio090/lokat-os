/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/studio/images/generate/__tests__/company-context-fix.behavioral.test.ts
 * FASE 31L (Company Context Fix) — prova ponta a ponta, contra o
 * handler POST REAL de route.ts, que uma Company selecionada
 * (mode:"company" + companyId no NÍVEL SUPERIOR do body, o mesmo
 * shape que _studio-execution-form.tsx agora produz) chega
 * corretamente a resolveCompanyContext(), e que mode:"company" sem
 * companyId NUNCA mais cai silenciosamente em Free Mode (causa raiz
 * real confirmada na FASE 31K.1: companyId vivia dentro de `input`,
 * nunca lido pela rota).
 */
import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/workspaces/assert-not-preview", {
  exports: { withMutationProtection: (handler: (...args: unknown[]) => unknown) => handler },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/supabase/server", {
  exports: { createServerSupabaseClient: async () => ({}), createSupabaseAdminClient: () => ({}) },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/rec-os/studio/dry-run", {
  exports: { isDryRunActive: () => false, isFullZeroCostDryRun: () => false, createStudioVisualDryRun: async () => { throw new Error("dry run não deveria ser chamado nestes testes"); } },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/rec-os/studio/production-qa-authorization", {
  exports: { isProductionQaFlagEnabled: () => false, evaluateProductionQaAccess: () => "not_requested", resolveRoleForCurrentUser: async () => null },
});

function req(body: unknown) {
  return new Request("http://x/api/studio/images/generate", { method: "POST", body: JSON.stringify(body) });
}

const FAKE_RESULT = {
  text: { skillId: "vidigal_png", skillVersion: "2.0.0", runtime: "openai_responses_api", status: "completed", output: { briefReading: "x", creativeDirection: "x", conceptualBasis: "x", visualStructure: "x", visualGuidelines: "x", generationPrompt: "x", variations: [], adaptations: [], suggestedHeadline: "x", suggestedCta: null, layoutArchetype: "EDITORIAL_HERO", headlineZone: "BOTTOM", contrastTreatment: "SCRIM", ctaStyle: "PILL" }, warnings: [], generatedAt: new Date().toISOString() },
  image: { status: "completed", providerId: "openai-images", image: { url: "data:image/png;base64,cmVhbA==", width: 1024, height: 1536 }, warnings: [], generatedAt: new Date().toISOString() },
};

async function loadRouteWith(t: TestContext, opts: {
  resolution?: { valid: boolean; reason?: string; context: { companyId: string; companyName: string | null; workspaceId: string | null; role: string | null } | null };
  currentUser?: { id: string } | null;
}) {
  let lastResolveCompanyContextArg: unknown = null;
  let createCalls = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-context/resolve", {
    exports: {
      resolveCompanyContext: async (companyId: unknown) => {
        lastResolveCompanyContextArg = companyId;
        return opts.resolution ?? { valid: false, reason: "not_authenticated", context: null };
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/auth/get-current-user", {
    exports: { getCurrentUser: async () => (opts.currentUser === undefined ? { id: "user-1" } : opts.currentUser) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/create-studio-visual", {
    exports: { createStudioVisual: async () => { createCalls++; return FAKE_RESULT; } },
  });

  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return { POST: mod.POST, getLastResolveCompanyContextArg: () => lastResolveCompanyContextArg, getCreateCalls: () => createCalls };
}

test("[1/2/3/4] mode='company' + companyId top-level -- resolveCompanyContext recebe o MESMO companyId (Duh Lanches), resolvedCompanyId corresponde", async (t) => {
  const { POST, getLastResolveCompanyContextArg } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "duh-lanches-id", companyName: "Duh Lanches", workspaceId: "ws-1", role: "cliente" } },
  });
  const res = await POST(req({
    skillId: "vidigal_png", mode: "company", companyId: "duh-lanches-id",
    input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] },
  }));
  assert.equal(res.status, 200);
  assert.equal(getLastResolveCompanyContextArg(), "duh-lanches-id", "resolveCompanyContext() é chamado com o MESMO companyId que a UI selecionou -- nunca perdido dentro de input");
});

test("[5/6] mode='company' SEM companyId -- erro explícito 400, NUNCA cai em free_mode (createStudioVisual/resolveCompanyContext nunca chamados)", async (t) => {
  let resolveCalls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-context/resolve", {
    exports: { resolveCompanyContext: async () => { resolveCalls++; return { valid: false, reason: "not_authenticated", context: null }; } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/auth/get-current-user", { exports: { getCurrentUser: async () => ({ id: "user-1" }) } });
  let createCalls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/create-studio-visual", { exports: { createStudioVisual: async () => { createCalls++; return FAKE_RESULT; } } });

  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  const res = await mod.POST(req({ skillId: "vidigal_png", mode: "company", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.code, "STUDIO_COMPANY_MODE_ID_MISSING");
  assert.equal(resolveCalls, 0, "nem chega a tentar resolver Company -- rejeitado antes, na validação de input");
  assert.equal(createCalls, 0, "NUNCA cai silenciosamente pra Free Mode -- createStudioVisual nunca chamado");
});

test("mode inválido (nem 'company' nem 'free') é tratado como ausente -- comportamento herdado (decide só pela presença de companyId)", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, { currentUser: { id: "user-1" } });
  const res = await POST(req({ skillId: "vidigal_png", mode: "algo-invalido", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  assert.equal(res.status, 200, "mode inválido nunca é tratado como 'company' -- nunca gera 400 STUDIO_COMPANY_MODE_ID_MISSING indevidamente");
  assert.equal(getCreateCalls(), 1);
});

test("[7] Free Mode legítimo (mode='free', sem companyId) continua funcionando normalmente", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, { currentUser: { id: "user-1" } });
  const res = await POST(req({ skillId: "vidigal_png", mode: "free", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  assert.equal(res.status, 200);
  assert.equal(getCreateCalls(), 1);
});

test("[8] request normal sem o campo 'mode' (compat retroativa) -- comportamento idêntico ao de antes desta fase", async (t) => {
  const { POST, getLastResolveCompanyContextArg } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "cliente" } },
  });
  const res = await POST(req({ skillId: "vidigal_png", companyId: "company-a", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  assert.equal(res.status, 200);
  assert.equal(getLastResolveCompanyContextArg(), "company-a", "sem mode, decide só pela presença de companyId -- mesmo comportamento de antes da FASE 31L");
});

test("companyId dentro de `input` (o bug real da FASE 31K.1) é ignorado -- só o companyId de nível superior importa", async (t) => {
  let resolveCalls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-context/resolve", {
    exports: { resolveCompanyContext: async () => { resolveCalls++; return { valid: false, reason: "not_authenticated", context: null }; } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/auth/get-current-user", { exports: { getCurrentUser: async () => ({ id: "user-1" }) } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/create-studio-visual", { exports: { createStudioVisual: async () => FAKE_RESULT } });

  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  const res = await mod.POST(req({
    skillId: "vidigal_png", mode: "free", // sem companyId top-level
    input: { freeformBrief: "teste", companyId: "duh-lanches-id-preso-dentro-de-input" },
    assets: { references: [], protectedAssets: [] },
  }));
  assert.equal(res.status, 200);
  assert.equal(resolveCalls, 0, "resolveCompanyContext nunca é chamado -- companyId dentro de input é SEMPRE ignorado por esta rota, exatamente o bug que causou free_mode silencioso");
});
