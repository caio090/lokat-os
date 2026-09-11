/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/lib/rec-os/studio/__tests__/create-studio-visual.structural.test.ts
 * Sprint REC OS Studio Image Generation MVP V0.3 / Prompt 01 (Studio
 * Visual Engine) — mocka ./execute, ./business-context,
 * ./image/image-runtime, ./render/reference-analysis,
 * ./render/asset-fetch e ./render/compositor para provar a
 * orquestração completa (texto -> referências -> background ->
 * render plan -> composição) sem tocar Supabase/OpenAI/Sharp de
 * verdade. render-plan.ts e data-url.ts (puros, sem I/O) rodam de
 * verdade.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

const FAKE_TEXT_OUTPUT = {
  briefReading: "x", creativeDirection: "x", conceptualBasis: "x", visualStructure: "x",
  visualGuidelines: "x", generationPrompt: "cenário gerado a partir do briefing", variations: [], adaptations: [],
  suggestedHeadline: "Headline sugerida", suggestedCta: null as string | null,
  // Prompt 20 -- campos novos do VisualCompositionPlan.
  layoutArchetype: "EDITORIAL_HERO" as const, headlineZone: "BOTTOM" as const, contrastTreatment: "SCRIM" as const, ctaStyle: "PILL" as const,
};

const FAKE_COMPOSE_RESULT = { ok: true as const, buffer: Buffer.from("fake-final-jpeg"), width: 1080, height: 1080, mime: "image/jpeg" };

async function loadOrchestratorWith(t: TestContext, opts: {
  textStatus?: string;
  businessContext?: unknown;
  imageResult?: unknown;
  composeResult?: unknown;
  fetchAssetResult?: unknown;
  onBuildBusinessContext?: (companyId: unknown) => void;
  onCompose?: (input: unknown) => void;
  /** FASE 31O -- quando true, NÃO mocka business-context.ts: deixa a função real rodar contra o `db` fixture passado em createStudioVisual({db}), provando a cadeia completa onboarding_profiles -> business-context.ts -> createStudioVisual, não só um businessContext já pronto à mão. */
  useRealBusinessContext?: boolean;
}) {
  let executeCalls = 0;
  let lastExecuteRequest: unknown = null;
  let imageCalls = 0;
  let lastImageRequest: unknown = null;

  const context = opts.businessContext ?? { company: null, identity: null, brand: null, market: null, products: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("../execute.ts", {
    exports: {
      executeStudioSkill: async (request: unknown) => {
        executeCalls++;
        lastExecuteRequest = request;
        if (opts.textStatus && opts.textStatus !== "completed") {
          return { skillId: "vidigal_png", skillVersion: "2.0.0", runtime: "openai_responses_api", status: opts.textStatus, output: null, warnings: [], error: { code: "STUDIO_AI_PROVIDER_UNAVAILABLE", message: "x" }, generatedAt: new Date().toISOString() };
        }
        return { skillId: "vidigal_png", skillVersion: "2.0.0", runtime: "openai_responses_api", status: "completed", output: FAKE_TEXT_OUTPUT, warnings: [], generatedAt: new Date().toISOString() };
      },
    },
  });
  if (!opts.useRealBusinessContext) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t.mock.module as any)("../business-context.ts", {
      exports: {
        buildStudioCreativeBusinessContext: async (_db: unknown, companyId: unknown) => {
          opts.onBuildBusinessContext?.(companyId);
          return context;
        },
      },
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("../image/image-runtime.ts", {
    exports: {
      generateStudioImage: async (request: unknown) => {
        imageCalls++;
        lastImageRequest = request;
        return opts.imageResult ?? { status: "completed", providerId: "fake", image: { url: "data:image/png;base64,ZmFrZQ==", width: 1024, height: 1024 }, warnings: [], generatedAt: new Date().toISOString() };
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("../render/reference-analysis.ts", {
    exports: { analyzeStudioReferences: async () => ({ rules: [], warnings: [] }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("../render/asset-fetch.ts", {
    exports: { fetchAssetSafely: async () => opts.fetchAssetResult ?? { ok: true, bytes: Buffer.from("fake-logo-bytes"), contentType: "image/png" } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("../render/compositor.ts", {
    exports: {
      composeStudioVisual: async (input: unknown) => {
        opts.onCompose?.(input);
        return opts.composeResult ?? FAKE_COMPOSE_RESULT;
      },
    },
  });

  const mod = await import(`../create-studio-visual.ts?t=${Date.now()}-${Math.random()}`);
  return {
    createStudioVisual: mod.createStudioVisual,
    getExecuteCalls: () => executeCalls, getLastExecuteRequest: () => lastExecuteRequest,
    getImageCalls: () => imageCalls, getLastImageRequest: () => lastImageRequest,
  };
}

test("[11/12] pipeline completo: texto alimenta o generationPrompt do image runtime, resultado final é a peça composta", async (t) => {
  const { createStudioVisual, getImageCalls, getLastImageRequest } = await loadOrchestratorWith(t, {});
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste", format: "feed_square" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  assert.equal(result.text.status, "completed");
  assert.equal(getImageCalls(), 1, "image runtime (background) é chamado exatamente uma vez após o texto completar");
  const imgReq = getLastImageRequest() as { generationPrompt: string };
  assert.equal(imgReq.generationPrompt, FAKE_TEXT_OUTPUT.generationPrompt, "generationPrompt do texto chega intacto ao image runtime");
  assert.equal(result.image?.status, "completed");
  assert.equal(result.image?.image?.url, `data:${FAKE_COMPOSE_RESULT.mime};base64,${FAKE_COMPOSE_RESULT.buffer.toString("base64")}`, "a URL final devolvida é a peça COMPOSTA, nunca o background cru do provider");
  assert.equal(result.image?.renderPlan?.format, "feed_square");
});

test("texto não completou -- background e composição NUNCA são tentados", async (t) => {
  const { createStudioVisual, getImageCalls } = await loadOrchestratorWith(t, { textStatus: "failed" });
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  assert.equal(result.text.status, "failed");
  assert.equal(result.image, null, "image é null -- nunca tenta gerar/compor sobre uma direção que falhou");
  assert.equal(getImageCalls(), 0);
});

test("[16] logo oficial da Company é automaticamente adicionado como protected asset (role logo) e chega ao compositor", async (t) => {
  const businessContext = { company: { id: "c1", name: "Empresa A" }, identity: { brandName: "A", logoUrl: "https://cdn.example.com/logo.png", brandColors: null, visualStyle: null, visualReferences: null }, brand: null, market: null, products: null };
  let composeInput: unknown = null;
  const { createStudioVisual, getLastImageRequest } = await loadOrchestratorWith(t, { businessContext, onCompose: (input) => { composeInput = input; } });
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: "c1", companyName: "Empresa A", assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const imgReq = getLastImageRequest() as { protectedAssets: { url: string; kind: string; role?: string }[] };
  assert.equal(imgReq.protectedAssets.some((a) => a.url === "https://cdn.example.com/logo.png" && a.kind === "protected" && a.role === "logo"), true, "logo oficial entra automaticamente como protected/role logo, sem o usuário precisar marcar");
  const compose = composeInput as { protectedAssetBytes: { assetId: string }[] };
  assert.equal(compose.protectedAssetBytes.some((a) => a.assetId === "company-logo"), true, "bytes do logo oficial (buscados via fetch SSRF-safe) chegam ao compositor");
  assert.equal(result.image?.status, "completed");
});

test("[FASE 31O] Company DNA salvo pelo novo editor administrativo (onboarding_profiles real) -- business-context.ts REAL lê o logo, createStudioVisual auto-adiciona como protected asset e o compositor recebe os bytes", async (t) => {
  // Linha exatamente no formato que a rota PUT /api/admin/clients/[id]/onboarding-profile
  // grava (ONBOARDING_PROFILE_FIELDS + convenção brand_colors [{label,hex}]) --
  // prova o round-trip completo sem hand-construir um businessContext pronto.
  const row = {
    brand_name: "Empresa A", logo_url: "https://cdn.example.com/logo-fase31o.png",
    brand_colors: [{ label: "Primária", hex: "#ff0000" }],
    visual_style: null, visual_references: null, tone_of_voice: null, words_use: null, words_avoid: null,
    segment: null, ideal_customer: null, age_range: null, audience_location: null, pains: null, desires: null, objections: null,
    products_services: null,
  };
  const fakeDb = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  let composeInput: unknown = null;
  const { createStudioVisual, getLastImageRequest } = await loadOrchestratorWith(t, {
    useRealBusinessContext: true,
    onCompose: (input) => { composeInput = input; },
  });
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: "c1", companyName: "Empresa A", assets: { references: [], protectedAssets: [] },
    db: fakeDb,
  });

  const imgReq = getLastImageRequest() as { protectedAssets: { url: string; kind: string; role?: string }[] };
  assert.equal(
    imgReq.protectedAssets.some((a) => a.url === row.logo_url && a.kind === "protected" && a.role === "logo"),
    true,
    "business-context.ts REAL leu logo_url da linha e createStudioVisual auto-adicionou como protected/role logo",
  );
  const compose = composeInput as { protectedAssetBytes: { assetId: string }[] };
  assert.equal(compose.protectedAssetBytes.some((a) => a.assetId === "company-logo"), true, "bytes do logo (fetch SSRF-safe) chegam ao compositor");
  assert.equal(result.image?.status, "completed");
});

test("[14] referências e protected assets enviados pelo usuário chegam intactos ao image runtime", async (t) => {
  const { createStudioVisual, getLastImageRequest } = await loadOrchestratorWith(t, {});
  const references = [{ id: "r1", label: "Ref 1", kind: "reference" as const, url: "data:image/png;base64,cmVm" }];
  const protectedAssets = [{ id: "p1", label: "Produto", kind: "protected" as const, url: "data:image/png;base64,cHJvZA==" }];
  await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: null, companyName: null, assets: { references, protectedAssets },
    db: {} as never,
  });
  const imgReq = getLastImageRequest() as { references: unknown[]; protectedAssets: { id: string; role?: string }[] };
  assert.equal(imgReq.references.length, 1);
  assert.equal(imgReq.protectedAssets.some((a) => a.id === "p1" && a.role === "product"), true, "protected asset enviado pelo usuário recebe role \"product\" por padrão");
});

test("[3] free mode -- companyId null nunca vira Company fictícia no business context", async (t) => {
  let capturedCompanyId: unknown = "not-called";
  const { createStudioVisual } = await loadOrchestratorWith(t, { onBuildBusinessContext: (companyId) => { capturedCompanyId = companyId; } });
  await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  assert.equal(capturedCompanyId, null, "companyId null é repassado como null -- nunca substituído por um valor inventado");
});

test("headline/cta explícitos do usuário são preservados exatamente -- nunca reescritos pela sugestão da Vidigal", async (t) => {
  let composeInput: unknown = null;
  const { createStudioVisual } = await loadOrchestratorWith(t, { onCompose: (input) => { composeInput = input; } });
  await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste", headline: "Aberto até 4h", cta: "Peça já" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const compose = composeInput as { renderPlan: { textLayers: { role: string; text: string }[] } };
  const headlineLayer = compose.renderPlan.textLayers.find((l) => l.role === "headline");
  const ctaLayer = compose.renderPlan.textLayers.find((l) => l.role === "cta");
  assert.equal(headlineLayer?.text, "Aberto até 4h", "headline do usuário é usado ao pé da letra, nunca o suggestedHeadline da Vidigal");
  assert.equal(ctaLayer?.text, "Peça já", "cta do usuário é usado ao pé da letra");
});

test("sem headline/cta explícitos -- usa suggestedHeadline/suggestedCta da Vidigal", async (t) => {
  let composeInput: unknown = null;
  const { createStudioVisual } = await loadOrchestratorWith(t, { onCompose: (input) => { composeInput = input; } });
  await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const compose = composeInput as { renderPlan: { textLayers: { role: string; text: string }[] } };
  const headlineLayer = compose.renderPlan.textLayers.find((l) => l.role === "headline");
  assert.equal(headlineLayer?.text, FAKE_TEXT_OUTPUT.suggestedHeadline);
  assert.equal(compose.renderPlan.textLayers.some((l) => l.role === "cta"), false, "suggestedCta null -- nenhuma layer de CTA é criada");
});

test("composição falhou -- resultado final é failed com STUDIO_RENDER_FAILED, nunca uma imagem quebrada", async (t) => {
  const { createStudioVisual } = await loadOrchestratorWith(t, { composeResult: { ok: false, error: "falha de teste" } });
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  assert.equal(result.image?.status, "failed");
  assert.equal(result.image?.error?.code, "STUDIO_RENDER_FAILED");
  assert.equal(result.image?.image, null);
});

test("logo_url malicioso/bloqueado pelo fetch seguro -- geração continua sem o logo, com warning, provider/compositor nunca recebe o conteúdo", async (t) => {
  const businessContext = {
    company: { id: "c1", name: "Empresa A" },
    identity: { brandName: "A", logoUrl: "https://attacker.example/ssrf-payload.png", brandColors: null, visualStyle: null, visualReferences: null },
    brand: null, market: null, products: null,
  };
  let composeInput: unknown = null;
  const { createStudioVisual } = await loadOrchestratorWith(t, {
    businessContext,
    fetchAssetResult: { ok: false, error: "Host resolve para um endereço não permitido." },
    onCompose: (input) => { composeInput = input; },
  });
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: "c1", companyName: "Empresa A", assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  assert.equal(result.image?.status, "completed", "logo bloqueado nunca derruba a geração inteira");
  const compose = composeInput as { protectedAssetBytes: { assetId: string }[] };
  assert.equal(compose.protectedAssetBytes.some((a) => a.assetId === "company-logo"), false, "bytes do logo NUNCA chegam ao compositor quando o fetch seguro bloqueia a URL");
  assert.equal(result.image?.warnings.some((w: string) => w.includes("Ativo protegido") && w.includes("Logo")), true, "warning explícito e seguro sobre o logo indisponível, nunca conteúdo bruto da URL/erro interno");
});

test("[P1-3] directive 'Headline: TESTE' no freeform é extraída e usada no compositor, e removida do brief enviado à Vidigal", async (t) => {
  let composeInput: unknown = null;
  const { createStudioVisual, getLastExecuteRequest } = await loadOrchestratorWith(t, { onCompose: (input) => { composeInput = input; } });
  await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "Divulgue o combo.\nHeadline: TESTE" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const compose = composeInput as { renderPlan: { textLayers: { role: string; text: string }[] } };
  const headlineLayer = compose.renderPlan.textLayers.find((l) => l.role === "headline");
  assert.equal(headlineLayer?.text, "TESTE", "directive extraída do freeform chega ao compositor");
  const executeReq = getLastExecuteRequest() as { input: { freeformBrief?: string } };
  assert.ok(!executeReq.input.freeformBrief?.includes("Headline:"), "a linha de directive é removida do brief enviado à Vidigal");
  assert.ok(executeReq.input.freeformBrief?.includes("Divulgue o combo."), "o resto do briefing continua sendo enviado à Vidigal");
});

test("[P1-4] directive 'CTA: COMPRAR' no freeform é extraída e usada", async (t) => {
  let composeInput: unknown = null;
  const { createStudioVisual } = await loadOrchestratorWith(t, { onCompose: (input) => { composeInput = input; } });
  await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "Divulgue o combo.\nCTA: COMPRAR" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const compose = composeInput as { renderPlan: { textLayers: { role: string; text: string }[] } };
  assert.equal(compose.renderPlan.textLayers.find((l) => l.role === "cta")?.text, "COMPRAR");
});

test("[P1-5] campo estruturado + directive no mesmo freeform -- campo estruturado vence", async (t) => {
  let composeInput: unknown = null;
  const { createStudioVisual } = await loadOrchestratorWith(t, { onCompose: (input) => { composeInput = input; } });
  await createStudioVisual({
    skillId: "vidigal_png",
    input: { freeformBrief: "Headline: DA DIRECTIVE", headline: "DO CAMPO ESTRUTURADO" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const compose = composeInput as { renderPlan: { textLayers: { role: string; text: string }[] } };
  assert.equal(compose.renderPlan.textLayers.find((l) => l.role === "headline")?.text, "DO CAMPO ESTRUTURADO", "campo estruturado sempre vence sobre a directive do freeform");
});

test("[P1-9] regenerate (mesma chamada com o mesmo input) preserva a headline extraída de forma idêntica", async (t) => {
  const calls: unknown[] = [];
  const { createStudioVisual } = await loadOrchestratorWith(t, { onCompose: (input) => { calls.push(input); } });
  const input = { freeformBrief: "Divulgue o combo.\nHeadline: HOJE ATÉ MAIS TARDE" };
  await createStudioVisual({ skillId: "vidigal_png", input, companyId: null, companyName: null, assets: { references: [], protectedAssets: [] }, db: {} as never });
  await createStudioVisual({ skillId: "vidigal_png", input, companyId: null, companyName: null, assets: { references: [], protectedAssets: [] }, db: {} as never });
  const texts = calls.map((c) => (c as { renderPlan: { textLayers: { role: string; text: string }[] } }).renderPlan.textLayers.find((l) => l.role === "headline")?.text);
  assert.equal(texts[0], "HOJE ATÉ MAIS TARDE");
  assert.equal(texts[1], "HOJE ATÉ MAIS TARDE", "regenerar com o mesmo input produz a mesma headline, nunca reinterpretada");
});

test("[FASE 31M] logoDiagnostics -- Company com logoUrl: presente/auto-add/fetch/render plan/compositor, tudo true", async (t) => {
  const businessContext = { company: { id: "c1", name: "Empresa A" }, identity: { brandName: "A", logoUrl: "https://cdn.example.com/logo.png", brandColors: null, visualStyle: null, visualReferences: null }, brand: null, market: null, products: null };
  const { createStudioVisual } = await loadOrchestratorWith(t, { businessContext, fetchAssetResult: { ok: true, bytes: Buffer.from("fake-logo-bytes"), contentType: "image/png" } });
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: "c1", companyName: "Empresa A", assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const diag = result.image?.logoDiagnostics;
  assert.ok(diag, "[3] diagnóstico presente em Company Mode");
  assert.equal(diag?.companyIdentityPresent, true);
  assert.equal(diag?.logoUrlPresent, true);
  assert.equal(diag?.logoAssetAutoAdded, true);
  assert.equal(diag?.protectedAssetsInputCount, 0);
  assert.equal(diag?.protectedAssetsAfterAutoAddCount, 1, "[3] contagem sobe de 0 pra 1 com o auto-add");
  assert.equal(diag?.logoFetchAttempted, true);
  assert.equal(diag?.logoFetchSucceeded, true);
  assert.equal(diag?.logoBytesPresent, true);
  assert.equal(diag?.logoMimeType, "image/png");
  assert.equal(diag?.renderPlanLogoPresent, true, "[7] render plan contém a logo");
  assert.equal(diag?.compositorLogoOverlayPresent, true, "[8] compositor recebe a logo");
  assert.equal(diag?.logoRendered, true);
  assert.equal(diag?.logoFailureReason, undefined, "nenhuma falha -- nenhum motivo registrado");
});

test("[FASE 31M] logoDiagnostics -- Company SEM logoUrl (caso real Duh Lanches): tudo false/null, sem tentar fetch", async (t) => {
  const businessContext = { company: { id: "c1", name: "Duh Lanches" }, identity: { brandName: "Duh Lanches", logoUrl: null, brandColors: null, visualStyle: null, visualReferences: null }, brand: null, market: null, products: null };
  const { createStudioVisual } = await loadOrchestratorWith(t, { businessContext });
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: "c1", companyName: "Duh Lanches", assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const diag = result.image?.logoDiagnostics;
  assert.equal(diag?.companyIdentityPresent, true, "identity existe (onboarding parcial), só a logo está ausente");
  assert.equal(diag?.logoUrlPresent, false, "exatamente o caso real: identity presente, logoUrl ausente");
  assert.equal(diag?.logoAssetAutoAdded, false);
  assert.equal(diag?.logoFetchAttempted, false, "nunca tenta buscar uma URL que não existe");
  assert.equal(diag?.renderPlanLogoPresent, false);
  assert.equal(diag?.compositorLogoOverlayPresent, false);
  assert.equal(diag?.logoRendered, false);
});

test("[FASE 31M] logoDiagnostics -- ausente em Free Mode (companyId null), nunca um objeto vazio/enganoso", async (t) => {
  const { createStudioVisual } = await loadOrchestratorWith(t, {});
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: null, companyName: null, assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  assert.equal(result.image?.logoDiagnostics, undefined, "Free Mode nunca finge ter um contexto de Company/logo");
});

test("[FASE 31M/11] logoDiagnostics -- fetch da logo falha: LOGO_ASSET_FAILED equivalente (logoFailureReason seguro), geração continua", async (t) => {
  const businessContext = {
    company: { id: "c1", name: "Empresa A" },
    identity: { brandName: "A", logoUrl: "https://attacker.example/ssrf-payload.png", brandColors: null, visualStyle: null, visualReferences: null },
    brand: null, market: null, products: null,
  };
  const { createStudioVisual } = await loadOrchestratorWith(t, {
    businessContext,
    fetchAssetResult: { ok: false, error: "Host resolve para um endereço não permitido." },
  });
  const result = await createStudioVisual({
    skillId: "vidigal_png", input: { freeformBrief: "teste" },
    companyId: "c1", companyName: "Empresa A", assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const diag = result.image?.logoDiagnostics;
  assert.equal(diag?.logoUrlPresent, true);
  assert.equal(diag?.logoAssetAutoAdded, true);
  assert.equal(diag?.logoFetchAttempted, true);
  assert.equal(diag?.logoFetchSucceeded, false, "[10] fail loud -- nunca fica indistinguível de 'nunca tentou'");
  assert.equal(diag?.logoBytesPresent, false);
  assert.equal(diag?.compositorLogoOverlayPresent, false);
  assert.equal(diag?.logoRendered, false);
  assert.ok(diag?.logoFailureReason?.includes("Logo"), "[10] motivo seguro e específico (nunca a URL do atacante nem detalhe interno)");
  assert.equal(result.image?.status, "completed", "logo indisponível nunca derruba a geração inteira");
});

test("[P1-10] Company DNA não sobrescreve headline explícita mesmo quando o tom de marca diverge", async (t) => {
  const businessContext = {
    company: { id: "c1", name: "Empresa Informal" },
    identity: { brandName: "Empresa Informal", logoUrl: null, brandColors: null, visualStyle: null, visualReferences: null },
    brand: { toneOfVoice: ["informal", "descontraído"], wordsToUse: null, wordsToAvoid: null },
    market: null, products: null,
  };
  let composeInput: unknown = null;
  const { createStudioVisual } = await loadOrchestratorWith(t, { businessContext, onCompose: (input) => { composeInput = input; } });
  await createStudioVisual({
    skillId: "vidigal_png",
    input: { freeformBrief: "teste", headline: "Comunicado Oficial de Alteração de Horário de Funcionamento" },
    companyId: "c1", companyName: "Empresa Informal", assets: { references: [], protectedAssets: [] },
    db: {} as never,
  });
  const compose = composeInput as { renderPlan: { textLayers: { role: string; text: string }[] } };
  assert.equal(
    compose.renderPlan.textLayers.find((l) => l.role === "headline")?.text,
    "Comunicado Oficial de Alteração de Horário de Funcionamento",
    "headline explícita do usuário vence mesmo quando o tom de marca do DNA é claramente diferente (informal)",
  );
});
