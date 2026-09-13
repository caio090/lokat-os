/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/studio/images/generate/__tests__/company-branding-gate.behavioral.test.ts
 * FASE 31P (Company Branding Gate) — chama o handler POST REAL de
 * route.ts, provando o backstop autoritativo server-side: geração REAL
 * (nunca dry_run) em Company Mode exige `identity.logoUrl` presente
 * ANTES de qualquer chamada a createStudioVisual (nunca gasta
 * crédito/chama o provider pra só então falhar). Mocka só
 * resolveCompanyContext/getCurrentUser/Supabase/createStudioVisual
 * (cada um testado à parte) -- nunca a lógica da própria rota.
 */
import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/workspaces/assert-not-preview", {
  exports: { withMutationProtection: (handler: (...args: unknown[]) => unknown) => handler },
});

function req(body: unknown) {
  return new Request("http://x/api/studio/images/generate", { method: "POST", body: JSON.stringify(body) });
}

const FAKE_RESULT = {
  text: { skillId: "vidigal_png", skillVersion: "2.0.0", runtime: "openai_responses_api", status: "completed", output: { briefReading: "x", creativeDirection: "x", conceptualBasis: "x", visualStructure: "x", visualGuidelines: "x", generationPrompt: "x", variations: [], adaptations: [], suggestedHeadline: "x", suggestedCta: null, layoutArchetype: "EDITORIAL_HERO", headlineZone: "BOTTOM", contrastTreatment: "SCRIM", ctaStyle: "PILL" }, warnings: [], generatedAt: new Date().toISOString() },
  image: { status: "completed", providerId: "fake", image: { url: "data:image/png;base64,ZmFrZQ==", width: 1024, height: 1024 }, warnings: [], generatedAt: new Date().toISOString() },
};

const FAKE_DRY_RUN_RESULT = {
  text: FAKE_RESULT.text,
  image: { ...FAKE_RESULT.image, providerId: "dry-run-mock" },
  packet: { dryRun: true, fullZeroCost: true },
};

/** `logoUrl: null` reproduz o fixture real já usado em create-studio-visual.structural.test.ts pro caso "Duh Lanches sem logo". */
function fakeDb(logoUrl: string | null) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { logo_url: logoUrl }, error: null }) }) }) }),
  };
}

async function loadRouteWith(t: TestContext, opts: {
  resolution?: { valid: boolean; reason?: string; context: { companyId: string; companyName: string | null; workspaceId: string | null; role?: string | null } | null };
  currentUser?: { id: string } | null;
  logoUrl?: string | null;
  createResult?: unknown;
  qaFlagEnabled?: boolean;
  qaRole?: string | null;
}) {
  let createCalls = 0;
  let dryRunCalls = 0;
  let lastCreateRequest: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-context/resolve", {
    exports: { resolveCompanyContext: async () => opts.resolution ?? { valid: false, reason: "not_authenticated", context: null } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/auth/get-current-user", {
    exports: { getCurrentUser: async () => (opts.currentUser === undefined ? { id: "user-1" } : opts.currentUser) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/production-qa-authorization", {
    exports: {
      isProductionQaFlagEnabled: () => opts.qaFlagEnabled ?? false,
      evaluateProductionQaAccess: (inputs: { requested: boolean; flagEnabled: boolean; authenticated: boolean; role: string | null }) => {
        if (!inputs.requested) return "not_requested";
        if (!inputs.flagEnabled) return "flag_disabled";
        if (!inputs.authenticated) return "unauthenticated";
        if (!inputs.role || (inputs.role !== "admin" && inputs.role !== "super_admin")) return "forbidden";
        return "allowed";
      },
      resolveRoleForCurrentUser: async () => opts.qaRole ?? null,
    },
  });
  const db = fakeDb(opts.logoUrl === undefined ? null : opts.logoUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", {
    exports: { createServerSupabaseClient: async () => db, createSupabaseAdminClient: () => db },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/create-studio-visual", {
    exports: {
      createStudioVisual: async (request: unknown) => {
        createCalls++;
        lastCreateRequest = request;
        return opts.createResult ?? FAKE_RESULT;
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/dry-run", {
    exports: {
      isDryRunActive: () => false,
      isFullZeroCostDryRun: () => false,
      createStudioVisualDryRun: async (request: unknown) => { dryRunCalls++; lastCreateRequest = request; return FAKE_DRY_RUN_RESULT; },
    },
  });
  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return { POST: mod.POST, getCreateCalls: () => createCalls, getDryRunCalls: () => dryRunCalls, getLastCreateRequest: () => lastCreateRequest };
}

const COMPANY_WITH_LOGO = { valid: true as const, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "cliente" } };
const COMPANY_WITHOUT_LOGO = { valid: true as const, context: { companyId: "duh-lanches-id", companyName: "Duh Lanches", workspaceId: "ws-2", role: "cliente" } };

test("[1] Company com logo -- geração liberada (200), createStudioVisual chamado normalmente", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    resolution: COMPANY_WITH_LOGO, logoUrl: "https://cdn.example.com/logo.png",
  });
  const res = await POST(req({ skillId: "vidigal_png", mode: "company", companyId: "company-a", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(getCreateCalls(), 1);
});

test("[2/9] Company SEM logo -- geração bloqueada (409 STUDIO_COMPANY_LOGO_REQUIRED), createStudioVisual NUNCA chamado (nenhum crédito gasto)", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    resolution: COMPANY_WITHOUT_LOGO, logoUrl: null,
  });
  const res = await POST(req({ skillId: "vidigal_png", mode: "company", companyId: "duh-lanches-id", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.ok, false);
  assert.equal(body.code, "STUDIO_COMPANY_LOGO_REQUIRED");
  assert.equal(getCreateCalls(), 0, "provider de IA NUNCA é chamado quando a logo está ausente -- nenhum crédito gasto");
});

test("[3] Free Mode sem logo -- geração liberada (gate nunca se aplica fora de Company Mode)", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    currentUser: { id: "user-1" }, logoUrl: null,
  });
  const res = await POST(req({ skillId: "vidigal_png", mode: "free", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(getCreateCalls(), 1, "Free Mode nunca exige logo -- createStudioVisual chamado normalmente");
});

test("[13/14] usuário tenta burlar o gate reenviando a mesma requisição sem alterar nada -- API recusa igual (front-end não é a fonte de verdade)", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    resolution: COMPANY_WITHOUT_LOGO, logoUrl: null,
  });
  // Simula alguém reabilitando o botão via DevTools e disparando o POST direto -- sem passar por nenhuma checagem de front.
  const res1 = await POST(req({ skillId: "vidigal_png", mode: "company", companyId: "duh-lanches-id", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  const res2 = await POST(req({ skillId: "vidigal_png", mode: "company", companyId: "duh-lanches-id", input: { freeformBrief: "outra tentativa" }, assets: { references: [], protectedAssets: [] } }));
  assert.equal(res1.status, 409);
  assert.equal(res2.status, 409, "a regra é reavaliada em CADA request -- nenhum estado de sessão permite burlar depois da primeira tentativa");
  assert.equal(getCreateCalls(), 0);
});

test("qaMode=dry_run em Company sem logo -- EXENTO do gate (dry run existe justamente para testar o cenário sem logo, sem custo)", async (t) => {
  const { POST, getDryRunCalls, getCreateCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "duh-lanches-id", companyName: "Duh Lanches", workspaceId: "ws-2", role: "admin" } },
    logoUrl: null,
    qaFlagEnabled: true,
    qaRole: "admin",
  });
  const res = await POST(req({ skillId: "vidigal_png", mode: "company", companyId: "duh-lanches-id", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] }, qaMode: "dry_run" }));
  const body = await res.json();
  assert.equal(res.status, 200, "dry_run nunca é bloqueado pelo gate -- é o caminho legítimo pra QA testar Company sem logo, sem custo");
  assert.equal(body.dryRun, true);
  assert.equal(getCreateCalls(), 0, "geração real nunca acontece nesse caminho de qualquer forma");
  assert.equal(getDryRunCalls(), 1);
});

test("cross-company negado -- gate de logo nunca chega a rodar (autorização de Company já barrou antes)", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    resolution: { valid: false, reason: "role_not_supported", context: null },
  });
  const res = await POST(req({ skillId: "vidigal_png", mode: "company", companyId: "company-b", input: { freeformBrief: "teste" }, assets: { references: [], protectedAssets: [] } }));
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, "STUDIO_COMPANY_CONTEXT_UNAUTHORIZED");
  assert.equal(getCreateCalls(), 0);
});
