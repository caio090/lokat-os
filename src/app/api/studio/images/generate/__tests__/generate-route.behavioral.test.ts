/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/studio/images/generate/__tests__/generate-route.behavioral.test.ts
 * Sprint REC OS Studio Image Generation MVP V0.3 (Fase 41, itens
 * 1/2/3/4/5/20) — chama o handler POST REAL de
 * src/app/api/studio/images/generate/route.ts, mockando só
 * resolveCompanyContext(), getCurrentUser(), o client Supabase e
 * createStudioVisual() (testado à parte).
 */
import { test, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/workspaces/assert-not-preview", {
  exports: { withMutationProtection: (handler: (...args: unknown[]) => unknown) => handler },
});
// FASE 31P (Company Branding Gate) -- as fixtures deste arquivo testam
// "Company Mode com sucesso", que agora exige logo_url presente. `db`
// mínimo compatível com buildStudioCreativeBusinessContext() (mesmo
// shape de fakeDb() em business-context.structural.test.ts).
function fakeDbWithLogo() {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { logo_url: "https://cdn.example.com/logo.png" }, error: null }) }) }) }),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mock.module as any)("@/lib/supabase/server", {
  exports: {
    createServerSupabaseClient: async () => fakeDbWithLogo(),
    createSupabaseAdminClient: () => fakeDbWithLogo(),
  },
});

function req(body: unknown) {
  return new Request("http://x/api/studio/images/generate", { method: "POST", body: JSON.stringify(body) });
}

const FAKE_RESULT = {
  text: { skillId: "vidigal_png", skillVersion: "2.0.0", runtime: "openai_responses_api", status: "completed", output: { briefReading: "x", creativeDirection: "x", conceptualBasis: "x", visualStructure: "x", visualGuidelines: "x", generationPrompt: "x", variations: [], adaptations: [], suggestedHeadline: "x", suggestedCta: null, layoutArchetype: "EDITORIAL_HERO", headlineZone: "BOTTOM", contrastTreatment: "SCRIM", ctaStyle: "PILL" }, warnings: [], generatedAt: new Date().toISOString() },
  image: { status: "completed", providerId: "fake", image: { url: "data:image/png;base64,ZmFrZQ==", width: 1024, height: 1024 }, warnings: [], generatedAt: new Date().toISOString() },
};

async function loadRouteWith(t: TestContext, opts: {
  resolution?: { valid: boolean; reason?: string; context: { companyId: string; companyName: string | null; workspaceId: string | null } | null };
  currentUser?: { id: string } | null;
  createResult?: unknown;
}) {
  let createCalls = 0;
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
  (t.mock.module as any)("@/lib/rec-os/studio/create-studio-visual", {
    exports: {
      createStudioVisual: async (request: unknown) => {
        createCalls++;
        lastCreateRequest = request;
        return opts.createResult ?? FAKE_RESULT;
      },
    },
  });
  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return { POST: mod.POST, getCreateCalls: () => createCalls, getLastCreateRequest: () => lastCreateRequest };
}

test("[1] company mode: companyId autorizado -- 200, createStudioVisual chamado com o companyId JÁ RESOLVIDO", async (t) => {
  const { POST, getCreateCalls, getLastCreateRequest } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1" } },
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste", companyId: "company-b-nunca-confiavel" }, companyId: "company-a" }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(getCreateCalls(), 1);
  const createReq = getLastCreateRequest() as { companyId: string };
  assert.equal(createReq.companyId, "company-a", "companyId enviado ao orquestrador é o já autorizado por resolveCompanyContext, nunca o bruto do input");
});

test("[5] company mode: cross-company negado -- createStudioVisual NUNCA chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {
    resolution: { valid: false, reason: "role_not_supported", context: null },
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-b" }));
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, "STUDIO_COMPANY_CONTEXT_UNAUTHORIZED");
  assert.equal(getCreateCalls(), 0, "negação de autorização é FINAL -- createStudioVisual nunca é chamado");
});

test("[2] free mode: usuário autenticado, sem companyId -- 200, companyId enviado ao orquestrador é null", async (t) => {
  const { POST, getCreateCalls, getLastCreateRequest } = await loadRouteWith(t, { currentUser: { id: "user-1" } });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(getCreateCalls(), 1);
  const createReq = getLastCreateRequest() as { companyId: string | null };
  assert.equal(createReq.companyId, null, "Free Mode nunca inventa companyId");
});

test("[4] free mode: sem sessão -- 401, createStudioVisual NUNCA chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, { currentUser: null });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" } }));
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, "STUDIO_COMPANY_CONTEXT_REQUIRED");
  assert.equal(getCreateCalls(), 0, "Free Mode continua exigindo autenticação -- nunca geração anônima");
});

test("skillId ausente -- 400, createStudioVisual nunca chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {});
  const res = await POST(req({ input: { freeformBrief: "teste" } }));
  assert.equal(res.status, 400);
  assert.equal(getCreateCalls(), 0);
});

test("mais de 4 assets do mesmo tipo -- 400, createStudioVisual nunca chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {});
  const tooMany = Array.from({ length: 5 }, (_, i) => ({ label: `ref ${i}`, url: `https://x.com/${i}.png` }));
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, assets: { references: tooMany } }));
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(getCreateCalls(), 0);
  assert.equal(typeof body.error, "string");
});

test("asset com URL inválida (nem data:image nem https) -- 400, createStudioVisual nunca chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {});
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, assets: { protectedAssets: [{ label: "x", url: "javascript:alert(1)" }] } }));
  assert.equal(res.status, 400);
  assert.equal(getCreateCalls(), 0);
});

test("[P1-1/P1-2] headline/cta estruturados chegam intactos ao orquestrador", async (t) => {
  const { POST, getLastCreateRequest } = await loadRouteWith(t, { currentUser: { id: "user-1" } });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste", headline: "HOJE ATÉ MAIS TARDE", cta: "PEÇA AGORA" } }));
  assert.equal(res.status, 200);
  const createReq = getLastCreateRequest() as { input: { headline?: string; cta?: string } };
  assert.equal(createReq.input.headline, "HOJE ATÉ MAIS TARDE");
  assert.equal(createReq.input.cta, "PEÇA AGORA");
});

test("headline acima do limite de caracteres -- 400, createStudioVisual nunca chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {});
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste", headline: "A".repeat(500) } }));
  assert.equal(res.status, 400);
  assert.equal(getCreateCalls(), 0);
});

test("headline com tipo inválido (não-string) -- 400, createStudioVisual nunca chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {});
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste", headline: 12345 } }));
  assert.equal(res.status, 400);
  assert.equal(getCreateCalls(), 0);
});

test("cta acima do limite de caracteres -- 400, createStudioVisual nunca chamado", async (t) => {
  const { POST, getCreateCalls } = await loadRouteWith(t, {});
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste", cta: "B".repeat(200) } }));
  assert.equal(res.status, 400);
  assert.equal(getCreateCalls(), 0);
});

test("[20] erro inesperado do orquestrador é sanitizado -- nunca stack trace ao cliente", async (t) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-context/resolve", {
    exports: { resolveCompanyContext: async () => ({ valid: true, context: { companyId: "c1", companyName: "C1", workspaceId: "ws" } }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/auth/get-current-user", { exports: { getCurrentUser: async () => ({ id: "user-1" }) } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/create-studio-visual", {
    exports: { createStudioVisual: async () => { throw new Error("segredo interno: chave xyz, stack trace sensível"); } },
  });
  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  const res = await mod.POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "c1" }));
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(JSON.stringify(body).includes("segredo interno"), false, "mensagem de erro interna nunca vaza para o cliente");
  assert.equal(JSON.stringify(body).includes("stack"), false, "nenhum stack trace no corpo da resposta");
});
