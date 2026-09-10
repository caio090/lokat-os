/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/studio/images/generate/__tests__/sunburst-qa-override.behavioral.test.ts
 * FASE 31K (Sunburst Studio QA Readiness) — chama o handler POST REAL
 * de route.ts, mockando resolveRoleForCurrentUser/getCurrentUser/
 * Supabase/createStudioVisual (testado à parte). Prova que
 * `qaImageModel`/`qaImageQuality` só têm efeito com
 * flag+auth+role EXATAMENTE "super_admin" (mais restrito que o
 * admin/super_admin do qaMode=dry_run, FASE 31G.2), passam pelo MESMO
 * fluxo real do Studio (nunca uma rota isolada), e que sua AUSÊNCIA
 * preserva 100% do comportamento normal -- inclusive maxDuration.
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

const FAKE_NORMAL_RESULT = {
  text: { skillId: "vidigal_png", skillVersion: "2.0.0", runtime: "openai_responses_api", status: "completed", output: { briefReading: "x", creativeDirection: "x", conceptualBasis: "x", visualStructure: "x", visualGuidelines: "x", generationPrompt: "x", variations: [], adaptations: [], suggestedHeadline: "x", suggestedCta: null, layoutArchetype: "EDITORIAL_HERO", headlineZone: "BOTTOM", contrastTreatment: "SCRIM", ctaStyle: "PILL" }, warnings: [], generatedAt: new Date().toISOString() },
  image: {
    status: "completed", providerId: "openai-images",
    image: { url: "data:image/png;base64,cmVhbA==", width: 1024, height: 1536, mime: "image/png" },
    warnings: [], generatedAt: new Date().toISOString(),
    diagnostics: {
      model: "gpt-image-2.5-sunburst", quality: "high", size: "1024x1536", durationMs: 77900,
      usage: { input_tokens: 402, input_tokens_details: { text_tokens: 402, image_tokens: 0 }, output_tokens: 1756, total_tokens: 2158 },
    },
  },
};

async function loadRouteWith(t: TestContext, opts: {
  resolution?: { valid: boolean; reason?: string; context: { companyId: string; companyName: string | null; workspaceId: string | null; role: string | null } | null };
  currentUser?: { id: string } | null;
  freeModeRole?: string | null;
  flagEnabled?: boolean;
}) {
  let normalCalls = 0;
  let lastCreateRequest: { imageOverride?: { model?: string; highRes?: boolean } } | null = null;

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
    exports: { createServerSupabaseClient: async () => ({}), createSupabaseAdminClient: () => ({}) },
  });
  // Mesma armadilha de cache transitivo documentada em production-qa-mode.behavioral.test.ts
  // (production-qa-authorization.ts importa @/lib/supabase/server -> next/headers).
  // Aqui só o único ponto assíncrono (resolveRoleForCurrentUser) importa -- isProductionQaFlagEnabled/
  // evaluateProductionQaAccess não são usadas por este gate (qaImageModel/Quality usa canAccessPlatformCentral direto, real, sem mock).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/production-qa-authorization", {
    exports: {
      isProductionQaFlagEnabled: () => false,
      evaluateProductionQaAccess: () => "not_requested",
      resolveRoleForCurrentUser: async () => opts.freeModeRole ?? null,
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/create-studio-visual", {
    exports: {
      createStudioVisual: async (request: { imageOverride?: { model?: string; highRes?: boolean } }) => {
        normalCalls++;
        lastCreateRequest = request;
        return FAKE_NORMAL_RESULT;
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/dry-run", {
    exports: { isDryRunActive: () => false, isFullZeroCostDryRun: () => false, createStudioVisualDryRun: async () => { throw new Error("dry run não deveria ser chamado nestes testes"); } },
  });
  if (opts.flagEnabled !== undefined) {
    if (opts.flagEnabled) process.env.LKT_PRODUCTION_SUNBURST_QA = "1";
    else delete process.env.LKT_PRODUCTION_SUNBURST_QA;
  }

  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return {
    POST: mod.POST,
    maxDuration: mod.maxDuration,
    getNormalCalls: () => normalCalls,
    getLastCreateRequest: () => lastCreateRequest,
  };
}

test("[1] route.ts exporta maxDuration=180 (FASE 31K -- Hobby + Fluid Compute)", async (t) => {
  const { maxDuration } = await loadRouteWith(t, {});
  assert.equal(maxDuration, 180);
});

test("[6/7] Super Admin + flag ligada -- override de model E quality aplicado, mesmo fluxo real (createStudioVisual, nunca dry run)", async (t) => {
  const { POST, getNormalCalls, getLastCreateRequest } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "super_admin" } },
    flagEnabled: true,
  });
  const res = await POST(req({
    skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a",
    qaImageModel: "gpt-image-2.5-sunburst", qaImageQuality: "high",
  }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(getNormalCalls(), 1, "MESMO fluxo real (createStudioVisual), nunca uma rota de benchmark isolada");
  const lastReq = getLastCreateRequest();
  assert.equal(lastReq?.imageOverride?.model, "gpt-image-2.5-sunburst");
  assert.equal(lastReq?.imageOverride?.highRes, true, "quality=high vira highRes:true, mesmo mecanismo já existente");
  // [8/11] usage real chega intacto na resposta final.
  assert.equal(body.image.diagnostics.model, "gpt-image-2.5-sunburst");
  assert.equal(body.image.diagnostics.usage.input_tokens, 402);
  assert.equal(body.image.diagnostics.usage.output_tokens, 1756);
  assert.ok(!JSON.stringify(body).match(/sk-|api[_-]?key/i), "nenhum secret/API key no payload");
});

test("[5] usuário comum (role cliente) + flag ligada -- override REJEITADO, createStudioVisual NUNCA chamado", async (t) => {
  const { POST, getNormalCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "cliente" } },
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaImageModel: "gpt-image-2.5-sunburst", qaImageQuality: "high" }));
  assert.equal(res.status, 403);
  assert.equal(getNormalCalls(), 0, "requisição inteira rejeitada -- nunca cai silenciosamente pro fluxo normal sem o override");
});

test("[5] admin comum (role admin, NÃO super_admin) + flag ligada -- override REJEITADO (mais restrito que qaMode=dry_run de propósito)", async (t) => {
  const { POST, getNormalCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "admin" } },
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaImageModel: "gpt-image-2.5-sunburst", qaImageQuality: "high" }));
  assert.equal(res.status, 403);
  assert.equal(getNormalCalls(), 0);
});

test("[8] Super Admin real, mas flag LKT_PRODUCTION_SUNBURST_QA desligada -- override REJEITADO", async (t) => {
  const { POST, getNormalCalls } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "super_admin" } },
    flagEnabled: false,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaImageModel: "gpt-image-2.5-sunburst", qaImageQuality: "high" }));
  assert.equal(res.status, 403);
  assert.equal(getNormalCalls(), 0);
});

test("[9] request normal (sem qaImageModel/qaImageQuality), mesmo com flag ligada e Super Admin -- comportamento 100% original", async (t) => {
  const { POST, getNormalCalls, getLastCreateRequest } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "super_admin" } },
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a" }));
  assert.equal(res.status, 200);
  assert.equal(getNormalCalls(), 1);
  assert.equal(getLastCreateRequest()?.imageOverride, undefined, "sem os campos no request, imageOverride nem é construído -- fluxo idêntico ao de antes desta fase");
});

test("qaImageModel com valor arbitrário (não 'gpt-image-2.5-sunburst') é tratado como ausente -- nunca um override inventado", async (t) => {
  const { POST, getNormalCalls, getLastCreateRequest } = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "ws-1", role: "super_admin" } },
    flagEnabled: true,
  });
  const res = await POST(req({ skillId: "vidigal_png", input: { freeformBrief: "teste" }, companyId: "company-a", qaImageModel: "gpt-image-2" }));
  assert.equal(res.status, 200);
  assert.equal(getNormalCalls(), 1);
  assert.equal(getLastCreateRequest()?.imageOverride, undefined, "modelo fora da allowlist é descartado silenciosamente na PARSE (nunca vira override, nunca gera 403 -- é tratado como se o campo nunca tivesse vindo)");
});
