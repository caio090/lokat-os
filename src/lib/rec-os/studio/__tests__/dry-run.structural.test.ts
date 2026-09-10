/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/lib/rec-os/studio/__tests__/dry-run.structural.test.ts
 * FASE 31G (LKT Image Dry Run Sem Custo) — prova que createStudioVisualDryRun
 * NUNCA chama um provider de imagem real e que, em modo fullZeroCost,
 * TAMBÉM nunca chama Vidigal (execute.ts) nem análise de referência --
 * render-plan.ts/compositor.ts/dry-run-fixtures.ts rodam DE VERDADE
 * (sharp real), exatamente como numa geração real (FASE 31G §2/8).
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

const FAKE_TEXT_OUTPUT = {
  briefReading: "x", creativeDirection: "x", conceptualBasis: "x", visualStructure: "x",
  visualGuidelines: "x", generationPrompt: "cena real de hamburgueria (mock Vidigal)", variations: [], adaptations: [],
  suggestedHeadline: "Headline real (mock)", suggestedCta: null as string | null,
  layoutArchetype: "EDITORIAL_HERO" as const, headlineZone: "BOTTOM" as const, contrastTreatment: "SCRIM" as const, ctaStyle: "PILL" as const,
};

function throwingProvider(id: "openai-images" | "google-gemini") {
  return {
    id, label: id,
    isAvailable: () => true,
    generate: async () => { throw new Error(`PAID CALL ATTEMPTED on ${id} -- dry run deveria nunca chegar aqui`); },
  };
}

async function loadDryRunWith(t: TestContext, opts: {
  provider?: ReturnType<typeof throwingProvider> | null;
  onExecuteStudioSkill?: () => void;
  onAnalyzeReferences?: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/ai/image-providers", {
    exports: {
      getActiveProvider: () => (opts.provider === undefined ? throwingProvider("openai-images") : opts.provider),
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("../execute.ts", {
    exports: {
      executeStudioSkill: async () => {
        opts.onExecuteStudioSkill?.();
        return { skillId: "vidigal_png", skillVersion: "2.0.0", runtime: "openai_responses_api", status: "completed", output: FAKE_TEXT_OUTPUT, warnings: [], generatedAt: new Date().toISOString() };
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("../render/reference-analysis.ts", {
    exports: {
      analyzeStudioReferences: async () => {
        opts.onAnalyzeReferences?.();
        return { rules: [], warnings: [] };
      },
    },
  });
  return import(`../dry-run.ts?t=${Date.now()}-${Math.random()}`);
}

test("[1/2] fullZeroCost=true: provider de imagem NUNCA é chamado (nem OpenAI nem Google)", async (t) => {
  let executeCalls = 0;
  const mod = await loadDryRunWith(t, { onExecuteStudioSkill: () => { executeCalls++; } });
  const result = await mod.createStudioVisualDryRun({
    skillId: "vidigal_png", input: { freeformBrief: "combo de hambúrguer" }, companyId: null, companyName: null,
    assets: { references: [], protectedAssets: [] }, db: {} as never, fullZeroCost: true,
  });
  assert.equal(result.image?.status, "completed", "nunca lança mesmo que o provider mockado lançasse se fosse chamado");
  assert.equal(executeCalls, 0, "fullZeroCost NUNCA chama execute.ts (Vidigal) -- confirma que a chamada de texto paga também foi pulada");
});

test("[fullZeroCost=true] Vidigal (execute.ts) e reference-analysis NUNCA são chamados quando há referências anexadas", async (t) => {
  let executeCalls = 0;
  let referenceCalls = 0;
  const mod = await loadDryRunWith(t, {
    onExecuteStudioSkill: () => { executeCalls++; },
    onAnalyzeReferences: () => { referenceCalls++; },
  });
  const result = await mod.createStudioVisualDryRun({
    skillId: "vidigal_png", input: { freeformBrief: "combo de hambúrguer" }, companyId: null, companyName: null,
    assets: { references: [{ id: "r1", label: "ref", kind: "reference", url: "https://cdn.example.com/ref.png" }], protectedAssets: [] },
    db: {} as never, fullZeroCost: true,
  });
  assert.equal(executeCalls, 0);
  assert.equal(referenceCalls, 0, "referência anexada + fullZeroCost -- análise é PULADA, nunca chamada de verdade");
  assert.equal(result.packet?.referenceAnalysis.source, "skipped_zero_cost");
  assert.ok(result.packet?.costedStepsSkippedThisRun.some((s: string) => s.includes("reference_analysis")), "relatado explicitamente como etapa pulada (nunca mascarado)");
});

test("[modo básico, fullZeroCost=false] Vidigal roda de verdade (aqui mockada), mas o provider de imagem continua NUNCA chamado", async (t) => {
  let executeCalls = 0;
  const mod = await loadDryRunWith(t, { onExecuteStudioSkill: () => { executeCalls++; } });
  const result = await mod.createStudioVisualDryRun({
    skillId: "vidigal_png", input: { freeformBrief: "combo de hambúrguer" }, companyId: null, companyName: null,
    assets: { references: [], protectedAssets: [] }, db: {} as never, fullZeroCost: false,
  });
  assert.equal(executeCalls, 1, "modo básico chama a Vidigal normalmente (aqui mockada só pra não bater rede no teste)");
  assert.equal(result.packet?.vidigalSource, "real");
  assert.equal(result.image?.status, "completed", "provider de imagem nunca chamado -- se fosse, o mock lançaria e o teste falharia");
});

test("[3/8] compositor REAL processa a fixture (sharp de verdade, decodificável) sem nenhuma chave de API", async (t) => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_GEMINI_API_KEY;
  const mod = await loadDryRunWith(t, {});
  const result = await mod.createStudioVisualDryRun({
    skillId: "vidigal_png", input: { freeformBrief: "combo de hambúrguer", format: "feed_square" }, companyId: null, companyName: null,
    assets: { references: [], protectedAssets: [] }, db: {} as never, fullZeroCost: true,
  });
  assert.equal(result.image?.status, "completed");
  const url = result.image?.image?.url ?? "";
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  assert.ok(match, "resultado final é uma data: URL válida");
  const bytes = Buffer.from(match![2], "base64");
  const meta = await sharp(bytes).metadata();
  assert.ok(meta.width && meta.height, "compositor real produziu uma imagem decodificável de verdade (não um placeholder de texto)");
});

test("[4] protectedAssets (logo) são preservados intactos pelo compositor real", async (t) => {
  const logoPng = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 1 } } }).png().toBuffer();
  const logoDataUrl = `data:image/png;base64,${logoPng.toString("base64")}`;
  const mod = await loadDryRunWith(t, {});
  const result = await mod.createStudioVisualDryRun({
    skillId: "vidigal_png", input: { freeformBrief: "combo de hambúrguer" }, companyId: null, companyName: null,
    assets: { references: [], protectedAssets: [{ id: "logo-1", label: "Logo", kind: "protected", url: logoDataUrl, role: "logo" }] },
    db: {} as never, fullZeroCost: true,
  });
  assert.equal(result.image?.status, "completed");
  const assetEntry = result.packet?.assetMatrix.find((a: { id: string }) => a.id === "logo-1");
  assert.ok(assetEntry, "asset protegido aparece na matriz de assets do diagnostic packet");
  assert.equal(assetEntry.seenBy.compositor, true, "logo chega ao compositor");
  assert.equal(assetEntry.seenBy.imageModel, false, "asset protegido NUNCA é enviado ao provider de imagem (mesma regra do pipeline real)");
  assert.equal(result.image?.renderPlan?.protectedAssets.some((p: { assetId: string }) => p.assetId === "logo-1"), true);
});

test("[5] FINAL IMAGE PROMPT é produzido -- inclui negative space (composition guidance) e Background Guard", async (t) => {
  const mod = await loadDryRunWith(t, {});
  const result = await mod.createStudioVisualDryRun({
    skillId: "vidigal_png", input: { freeformBrief: "combo de hambúrguer" }, companyId: null, companyName: null,
    assets: { references: [], protectedAssets: [] }, db: {} as never, fullZeroCost: true,
  });
  const packet = result.packet!;
  assert.ok(packet.finalImagePrompt.length > 0);
  assert.ok(packet.finalImagePrompt.includes("negative space"), "composition guidance (negative space) presente no prompt final");
  assert.ok(packet.finalImagePrompt.includes("NUNCA inclua texto"), "Background Guard presente no prompt final -- mesma defesa do pipeline real");
  assert.equal(packet.finalImagePrompt, packet.backgroundGuard);
  assert.notEqual(packet.generationPromptBase, packet.finalImagePrompt, "prompt final é o BASE + composition guidance + background guard, nunca só o base");
});

test("[8/9] regenerate (duas execuções seguidas) nunca exige nenhuma chave de API e produz resultado válido nas duas", async (t) => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_GEMINI_API_KEY;
  const mod = await loadDryRunWith(t, {});
  const req = {
    skillId: "vidigal_png", input: { freeformBrief: "combo de hambúrguer" }, companyId: null, companyName: null,
    assets: { references: [], protectedAssets: [] }, db: {} as never, fullZeroCost: true,
  };
  const first = await mod.createStudioVisualDryRun(req);
  const second = await mod.createStudioVisualDryRun(req);
  assert.equal(first.image?.status, "completed");
  assert.equal(second.image?.status, "completed", "regenerate (segunda execução) continua funcionando sem nenhuma API key configurada");
});

test("[6/7] isDryRunActive respeita VERCEL_ENV -- nunca true em production, respeita a flag em preview/dev", async (t) => {
  const mod = await loadDryRunWith(t, {});
  const savedVercelEnv = process.env.VERCEL_ENV;
  const savedFlag = process.env.LKT_IMAGE_DRY_RUN;
  try {
    process.env.VERCEL_ENV = "production";
    process.env.LKT_IMAGE_DRY_RUN = "1";
    assert.equal(mod.isDryRunActive(), false, "Production SEMPRE rejeita o dry run, mesmo com a flag setada por engano");

    process.env.VERCEL_ENV = "preview";
    process.env.LKT_IMAGE_DRY_RUN = "1";
    assert.equal(mod.isDryRunActive(), true, "Preview + flag ligada -- dry run permitido");

    process.env.VERCEL_ENV = "preview";
    process.env.LKT_IMAGE_DRY_RUN = undefined;
    delete process.env.LKT_IMAGE_DRY_RUN;
    assert.equal(mod.isDryRunActive(), false, "sem a flag, mesmo em Preview, comportamento é o de sempre (dry run OFF)");

    delete process.env.VERCEL_ENV;
    process.env.LKT_IMAGE_DRY_RUN = "true";
    assert.equal(mod.isDryRunActive(), true, "Development local (VERCEL_ENV ausente) + flag -- dry run permitido");
  } finally {
    if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedVercelEnv;
    if (savedFlag === undefined) delete process.env.LKT_IMAGE_DRY_RUN; else process.env.LKT_IMAGE_DRY_RUN = savedFlag;
  }
});

test("[10] front recebe resultado válido: mesma forma do StudioVisualResult real (status/image/renderPlan/warnings)", async (t) => {
  const mod = await loadDryRunWith(t, {});
  const result = await mod.createStudioVisualDryRun({
    skillId: "vidigal_png", input: { freeformBrief: "combo de hambúrguer", format: "feed_square" }, companyId: null, companyName: null,
    assets: { references: [], protectedAssets: [] }, db: {} as never, fullZeroCost: true,
  });
  assert.equal(typeof result.image?.status, "string");
  assert.equal(typeof result.image?.image?.url, "string");
  assert.equal(typeof result.image?.image?.width, "number");
  assert.equal(typeof result.image?.image?.height, "number");
  assert.ok(Array.isArray(result.image?.warnings));
  assert.ok(result.image?.warnings.some((w: string) => w.includes("FIXTURE")), "warning explícito avisa que é fixture -- nunca mascarado como geração real");
  assert.ok(result.image?.renderPlan, "renderPlan real presente -- front usa exatamente como numa geração real");
});
