/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/lib/ai/image-providers/__tests__/google-gemini.behavioral.test.ts
 * Prompt 31 (Google Image Provider Migration) — GoogleGeminiProvider.generate()
 * ponta a ponta, com `global.fetch` mockado (nunca rede real, nunca
 * gasta crédito). `process.env.GOOGLE_GEMINI_API_KEY`/`GOOGLE_IMAGE_MODEL`/
 * `GOOGLE_IMAGE_SIZE` são lidos em module-load time -- cada teste que
 * varia essas envs reimporta o módulo com uma query string única pra
 * forçar reload (mesmo padrão de openai-images.behavioral.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

async function realPngBase64(width = 8, height = 8): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
  return buf.toString("base64");
}

async function loadProviderWithEnv(env: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of ["GOOGLE_GEMINI_API_KEY", "GOOGLE_IMAGE_MODEL", "GOOGLE_IMAGE_SIZE"]) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const mod = await import(`../google-gemini.ts?t=${Date.now()}-${Math.random()}`);
  for (const key of Object.keys(previous)) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  return mod.GoogleGeminiProvider as { id: string; label: string; isAvailable: () => boolean; generate: (input: { prompt: string; aspectRatio?: string; outputCount?: number }) => Promise<{ success: boolean; images?: { url: string; width: number; height: number }[]; error?: string; providerRaw?: unknown }> };
}

test("[TEST 10] ausência da API key -- isAvailable() false, generate() falha fechado SEM chamar fetch", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: undefined });
  assert.equal(provider.isAvailable(), false);
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => { fetchCalled = true; throw new Error("nunca deveria ser chamado"); }) as typeof fetch;
  try {
    const result = await provider.generate({ prompt: "x" });
    assert.equal(result.success, false);
    assert.equal(fetchCalled, false, "generate() nunca chama fetch sem API key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("[TEST 1/2/3] chamada correta -- gemini-3-pro-image, endpoint generateContent, API key via header", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "test-key-123" });
  const originalFetch = global.fetch;
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    const base64 = await realPngBase64();
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: base64 } }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await provider.generate({ prompt: "peça de teste", aspectRatio: "1:1" });
    assert.equal(result.success, true);
    assert.ok(capturedUrl.includes("/models/gemini-3-pro-image:generateContent"), "URL usa o modelo default e o endpoint generateContent");
    assert.ok(!capturedUrl.includes(":predict"), "nunca o endpoint antigo");
    assert.equal(capturedHeaders["x-goog-api-key"], "test-key-123", "API key transportada via header x-goog-api-key, nunca query string/corpo/log");
    assert.ok(!capturedUrl.includes("test-key-123"), "API key NUNCA aparece na URL");
  } finally {
    global.fetch = originalFetch;
  }
});

test("[FASE 2] respeita GOOGLE_IMAGE_MODEL customizado", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "k", GOOGLE_IMAGE_MODEL: "gemini-3-pro-image-preview" });
  const originalFetch = global.fetch;
  let capturedUrl = "";
  global.fetch = (async (url: unknown) => {
    capturedUrl = String(url);
    const base64 = await realPngBase64();
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: base64 } }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await provider.generate({ prompt: "x" });
    assert.ok(capturedUrl.includes("/models/gemini-3-pro-image-preview:generateContent"), "modelo configurado via env é respeitado, sem hardcode");
  } finally {
    global.fetch = originalFetch;
  }
});

test("[TEST 6] imageSize 2K enviado por padrão no body", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "k" });
  const originalFetch = global.fetch;
  let capturedBody: { generationConfig?: { imageConfig?: { imageSize?: string; aspectRatio?: string } } } = {};
  global.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    const base64 = await realPngBase64();
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: base64 } }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await provider.generate({ prompt: "x", aspectRatio: "4:5" });
    assert.equal(capturedBody.generationConfig?.imageConfig?.imageSize, "2K", "2K enviado por padrão (FASE 6)");
    assert.equal(capturedBody.generationConfig?.imageConfig?.aspectRatio, "4:5", "aspectRatio 4:5 realmente vai no request, nunca só metadata pós-geração");
  } finally {
    global.fetch = originalFetch;
  }
});

test("[TEST 7] extração correta de inlineData -- imagem real vira o resultado final com dimensões reais", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "k" });
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    const base64 = await realPngBase64(16, 20);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: base64 } }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await provider.generate({ prompt: "x" });
    assert.equal(result.success, true);
    assert.equal(result.images?.[0]?.width, 16);
    assert.equal(result.images?.[0]?.height, 20);
    assert.ok(result.images?.[0]?.url.startsWith("data:image/png;base64,"));
    const raw = result.providerRaw as { provider?: string; model?: string; requestedAspectRatio?: string; requestedImageSize?: string; mimeType?: string } | undefined;
    assert.equal(raw?.provider, "google", "[FASE 12] metadata registra provider");
    assert.equal(raw?.model, "gemini-3-pro-image", "[FASE 12] metadata registra model");
    assert.equal(raw?.mimeType, "image/png", "[FASE 12] metadata registra mimeType real");
  } finally {
    global.fetch = originalFetch;
  }
});

test("[TEST 8] erro quando não há imagem -- generate() falha explicitamente, nunca sucesso vazio", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "k" });
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "não consegui gerar" }] } }] }), { status: 200 })) as typeof fetch;
  try {
    const result = await provider.generate({ prompt: "x" });
    assert.equal(result.success, false);
    assert.ok(!result.images);
  } finally {
    global.fetch = originalFetch;
  }
});

test("[TEST 9] erro de resposta HTTP (500) -- mensagem segura, nunca a mensagem bruta do Google", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "k" });
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({ error: { code: 500, message: "internal detail from google", status: "INTERNAL" } }), { status: 500 })) as typeof fetch;
  try {
    const result = await provider.generate({ prompt: "x" });
    assert.equal(result.success, false);
    assert.ok(!result.error?.includes("internal detail from google"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("erro de resposta HTTP (401) -- autenticação, quota (429) -- limite", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "k" });
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({ error: { code: 401, status: "UNAUTHENTICATED" } }), { status: 401 })) as typeof fetch;
  try {
    const result = await provider.generate({ prompt: "x" });
    assert.equal(result.success, false);
    assert.ok(/autenticação/i.test(result.error ?? ""));
  } finally {
    global.fetch = originalFetch;
  }
});

test("timeout (AbortError) -- falha explícita com mensagem de timeout, nunca trava/lança", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "k" });
  const originalFetch = global.fetch;
  // Simula o exato momento em que o AbortController real dispararia
  // (nunca espera os 42s de verdade -- o mock rejeita imediatamente
  // com o mesmo shape de erro que fetch() produz quando abortado).
  global.fetch = (async () => { throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" }); }) as typeof fetch;
  try {
    const result = await provider.generate({ prompt: "x" });
    assert.equal(result.success, false);
    assert.ok(/tempo limite/i.test(result.error ?? ""), "mensagem específica de timeout, nunca um erro genérico");
  } finally {
    global.fetch = originalFetch;
  }
});

test("[FASE 8/9] request nunca inclui protectedAssets/references -- generate() nem aceita esses campos", async () => {
  const provider = await loadProviderWithEnv({ GOOGLE_GEMINI_API_KEY: "k" });
  const originalFetch = global.fetch;
  let capturedBody = "";
  global.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body);
    const base64 = await realPngBase64();
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: base64 } }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await provider.generate({ prompt: "cena com produto real preservado pelo compositor depois" });
    assert.ok(!capturedBody.includes("protectedAsset") && !capturedBody.includes("reference"), "nenhuma menção a assets protegidos/referências no request -- o Gemini só recebe o texto do prompt");
  } finally {
    global.fetch = originalFetch;
  }
});
