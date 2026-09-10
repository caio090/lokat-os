/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/lib/ai/image-providers/__tests__/openai-images.behavioral.test.ts
 * Prompt 09 (Studio Image Provider Compatibility) — exercita
 * OpenAIImagesProvider.generate() ponta a ponta com o pacote "openai"
 * inteiro mockado (nunca rede real), provando o pipeline completo:
 * StudioImageRuntime -> adapter -> request válido -> resposta
 * normalizada. process.env.OPENAI_IMAGE_MODEL é lido em module-load
 * time pelo provider -- por isso cada teste reimporta o módulo depois
 * de ajustar a env var, com um query string único pra forçar reload.
 *
 * Prompt 11 (GPT-Image-2 Production Migration) — segundo incidente
 * real de Production (`dpl_EHFbxtcH6Czf2xFfmmDrb9UzmTtC`): o default
 * sem `OPENAI_IMAGE_MODEL` configurada era `"dall-e-3"`, removido da
 * API real. Os testes que afirmavam esse default e o suporte real a
 * dall-e-2 foram reescritos: o default agora precisa resolver pra
 * gpt-image-2 (nunca dall-e-3, obrigatório -- foi exatamente a causa
 * do incidente), e dall-e-2/dall-e-3 configurados explicitamente agora
 * precisam falhar fechado (SDK nunca chamado), nunca funcionar.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

async function realPngBase64(): Promise<string> {
  const buf = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
  return buf.toString("base64");
}

/** Precisa ser a MESMA classe exposta como `OpenAI.APIError` no mock
 *  (ver FakeOpenAI abaixo) e usada pelos testes que simulam erro do
 *  SDK -- senão `instanceof OpenAI.APIError` dentro de
 *  openai-image-response.ts nunca reconheceria o erro simulado. */
class FakeAPIErrorBase extends Error {
  status?: number; code?: string | null; type?: string; param?: string | null; requestID?: string | null;
  constructor(message: string, fields: { status?: number; code?: string | null; type?: string; param?: string | null; requestID?: string | null } = {}) {
    super(message);
    Object.assign(this, fields);
  }
}

/**
 * FASE 31K -- mesma classe exposta como `OpenAI.APIUserAbortError` no
 * mock (subclasse REAL de APIError no SDK, nunca um Error nativo com
 * `.name==="AbortError"` -- confirmado em node_modules/openai/core/error.js;
 * era exatamente esse descasamento que fazia o Studio real perder a
 * classificação de timeout, FASE 31I §H/30).
 */
class FakeAPIUserAbortError extends FakeAPIErrorBase {
  constructor() { super("Request was aborted."); }
}

async function loadProviderWith(t: TestContext, opts: {
  model?: string;
  apiKey?: string;
  generateImpl?: (params: unknown, options?: unknown) => Promise<unknown>;
}) {
  const originalModel = process.env.OPENAI_IMAGE_MODEL;
  const originalKey = process.env.OPENAI_API_KEY;
  if (opts.model !== undefined) process.env.OPENAI_IMAGE_MODEL = opts.model; else delete process.env.OPENAI_IMAGE_MODEL;
  if (opts.apiKey !== undefined) process.env.OPENAI_API_KEY = opts.apiKey; else delete process.env.OPENAI_API_KEY;

  let capturedParams: unknown = null;
  let capturedOptions: unknown = null;
  class FakeOpenAI {
    images = {
      generate: async (params: unknown, options?: unknown) => {
        capturedParams = params;
        capturedOptions = options;
        if (opts.generateImpl) return opts.generateImpl(params, options);
        const b64 = await realPngBase64();
        return { created: 1, data: [{ b64_json: b64 }] };
      },
    };
    static APIError = FakeAPIErrorBase;
    static APIUserAbortError = FakeAPIUserAbortError;
    constructor(_o: unknown) { void _o; }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("openai", { exports: { default: FakeOpenAI } });

  const mod = await import(`../openai-images.ts?t=${Date.now()}-${Math.random()}`);
  t.after(() => {
    if (originalModel === undefined) delete process.env.OPENAI_IMAGE_MODEL; else process.env.OPENAI_IMAGE_MODEL = originalModel;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  });
  return { provider: mod.OpenAIImagesProvider, getCapturedParams: () => capturedParams, getCapturedOptions: () => capturedOptions };
}

test("[PRODUCTION_INCIDENT_OPENAI_RESPONSE_FORMAT] modelo GPT Image real -- request nunca contém response_format, resposta b64_json normalizada", async (t) => {
  const { provider, getCapturedParams } = await loadProviderWith(t, { model: "gpt-image-1", apiKey: "sk-test-fake-never-real" });
  assert.equal(provider.isAvailable(), true);
  const result = await provider.generate({ prompt: "cenário de teste", aspectRatio: "1:1", outputCount: 1 });
  assert.equal(result.success, true, "geração bem-sucedida");
  const params = getCapturedParams() as Record<string, unknown>;
  assert.equal("response_format" in params, false, "response_format NUNCA está no request enviado ao SDK -- causa raiz do incidente real de Production");
  assert.equal(params.model, "gpt-image-1");
  assert.ok(result.images?.[0]?.url.startsWith("data:image/png;base64,"), "b64_json normalizado corretamente pra data: URL");
});

test("[PRODUCTION_INCIDENT_MODEL_REMOVED] default sem OPENAI_IMAGE_MODEL configurada -- resolve gpt-image-2, NUNCA dall-e-3 (causa raiz exata do incidente real)", async (t) => {
  const { provider, getCapturedParams } = await loadProviderWith(t, { apiKey: "sk-test-fake-never-real" }); // sem model -> usa o novo default
  const result = await provider.generate({ prompt: "x", aspectRatio: "16:9" });
  assert.equal(result.success, true);
  const params = getCapturedParams() as Record<string, unknown>;
  assert.equal(params.model, "gpt-image-2", "o default real (sem env var) precisa ser gpt-image-2 -- dall-e-3 foi removido da API e causou o incidente de Production");
  assert.notEqual(params.model, "dall-e-3", "nunca mais dall-e-3 como default silencioso");
  assert.equal("response_format" in params, false, "gpt-image-2 também nunca recebe response_format");
});

test("[PRODUCTION_INCIDENT_MODEL_REMOVED] modelo dall-e-3 configurado explicitamente -- nunca chama o SDK, erro sanitizado (modelo removido da API real)", async (t) => {
  const { provider, getCapturedParams } = await loadProviderWith(t, { model: "dall-e-3", apiKey: "sk-test-fake-never-real" });
  const result = await provider.generate({ prompt: "x", aspectRatio: "1:1" });
  assert.equal(result.success, false, "falha fechada, nunca um fallback silencioso pra outro modelo");
  assert.equal(getCapturedParams(), null, "SDK nunca é chamado pra um modelo removido da API");
  assert.equal(result.error, "O modelo de geração de imagem configurado não está disponível.", "mensagem sanitizada exata, nunca detalhe técnico");
});

test("[PRODUCTION_INCIDENT_MODEL_REMOVED] modelo dall-e-2 configurado explicitamente -- nunca chama o SDK, erro sanitizado (modelo removido da API real)", async (t) => {
  const { provider, getCapturedParams } = await loadProviderWith(t, { model: "dall-e-2", apiKey: "sk-test-fake-never-real" });
  const result = await provider.generate({ prompt: "x", aspectRatio: "1:1" });
  assert.equal(result.success, false, "falha fechada, nunca um fallback silencioso pra outro modelo");
  assert.equal(getCapturedParams(), null, "SDK nunca é chamado pra um modelo removido da API");
  assert.equal(result.error, "O modelo de geração de imagem configurado não está disponível.", "mensagem sanitizada exata, nunca detalhe técnico");
});

test("modelo gpt-image-2 configurado explicitamente -- request válido, sem response_format, quality/size corretos", async (t) => {
  const { provider, getCapturedParams } = await loadProviderWith(t, { model: "gpt-image-2", apiKey: "sk-test-fake-never-real" });
  const result = await provider.generate({ prompt: "x", aspectRatio: "9:16", highRes: true });
  assert.equal(result.success, true);
  const params = getCapturedParams() as Record<string, unknown>;
  assert.equal(params.model, "gpt-image-2");
  assert.equal(params.size, "1024x1536");
  assert.equal(params.quality, "high");
  assert.equal("response_format" in params, false, "gpt-image-2 nunca recebe response_format");
});

test("modelo gpt-image-2-2026-04-21 configurado explicitamente -- resolve gpt_image, request válido", async (t) => {
  const { provider, getCapturedParams } = await loadProviderWith(t, { model: "gpt-image-2-2026-04-21", apiKey: "sk-test-fake-never-real" });
  const result = await provider.generate({ prompt: "x", aspectRatio: "1:1" });
  assert.equal(result.success, true);
  const params = getCapturedParams() as Record<string, unknown>;
  assert.equal(params.model, "gpt-image-2-2026-04-21");
  assert.equal("response_format" in params, false, "gpt-image-2-2026-04-21 nunca recebe response_format");
});

test("sem OPENAI_API_KEY -- indisponível explicitamente, nunca tenta chamar o SDK", async (t) => {
  const { provider } = await loadProviderWith(t, { apiKey: "" });
  assert.equal(provider.isAvailable(), false);
  const result = await provider.generate({ prompt: "x" });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /não configurada/i);
});

test("timeout do provider -- APIUserAbortError (erro real do SDK, FASE 31K) vira mensagem segura de timeout, nunca lança", async (t) => {
  const { provider } = await loadProviderWith(t, {
    model: "gpt-image-1", apiKey: "sk-test-fake-never-real",
    generateImpl: async () => { throw new FakeAPIUserAbortError(); },
  });
  const result = await provider.generate({ prompt: "x" });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /tempo limite/i);
  assert.equal(result.diagnostics?.errorCategory, "UPSTREAM_TIMEOUT", "categoria segura explícita, nunca mais perdida (FASE 31I §30 -> FASE 31K §4)");
});

test("timeout do provider -- um Error nativo com .name==='AbortError' (nunca lançado pelo SDK real, mas hipotético) NÃO é classificado como timeout -- só APIUserAbortError real conta", async (t) => {
  const { provider } = await loadProviderWith(t, {
    model: "gpt-image-1", apiKey: "sk-test-fake-never-real",
    generateImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
  });
  const result = await provider.generate({ prompt: "x" });
  assert.equal(result.success, false);
  assert.notEqual(result.diagnostics?.errorCategory, "UPSTREAM_TIMEOUT", "só instanceof OpenAI.APIUserAbortError classifica como timeout, nunca .name");
});

test("erro do provider (SDK APIError simulado) -- mensagem segura, nunca o texto bruto", async (t) => {
  const { provider } = await loadProviderWith(t, {
    model: "gpt-image-1", apiKey: "sk-test-fake-never-real",
    generateImpl: async () => {
      throw new FakeAPIErrorBase("segredo interno do provider, nunca deve vazar", { status: 400, code: "invalid_parameter", type: "invalid_request_error", param: "size", requestID: "req_123" });
    },
  });
  const result = await provider.generate({ prompt: "x" });
  assert.equal(result.success, false);
  assert.equal((result.error ?? "").includes("segredo interno"), false, "mensagem bruta do provider nunca vaza pro chamador");
  assert.match(result.error ?? "", /parâmetros inválidos/i, "erro 400 classificado corretamente via instanceof OpenAI.APIError (não caiu no fallback genérico)");
});

test("modelo desconhecido configurado -- falha explícita antes mesmo de chamar o SDK", async (t) => {
  const { provider, getCapturedParams } = await loadProviderWith(t, { model: "modelo-que-nao-existe", apiKey: "sk-test-fake-never-real" });
  const result = await provider.generate({ prompt: "x" });
  assert.equal(result.success, false);
  assert.equal(getCapturedParams(), null, "SDK nunca é chamado quando a família do modelo é desconhecida");
});

test("providerRaw carrega metadata não sensível (model/family/size/quality), nunca secret", async (t) => {
  const { provider } = await loadProviderWith(t, { model: "gpt-image-1", apiKey: "sk-test-fake-never-real" });
  const result = await provider.generate({ prompt: "x", aspectRatio: "1:1" });
  const raw = result.providerRaw as Record<string, unknown>;
  assert.equal(raw.model, "gpt-image-1");
  assert.equal(raw.family, "gpt_image");
  assert.equal(JSON.stringify(raw).includes("sk-test-fake-never-real"), false, "providerRaw nunca contém a API key");
});
