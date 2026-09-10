/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/diag-openai-image-benchmark/__tests__/generate-step-error-handling.behavioral.test.ts
 * FASE 31H.2 — prova que ?step=generate NUNCA deixa um erro/timeout
 * virar um 504 opaco: mocka o pacote "openai" (única dependência
 * externa real desta etapa) pra simular exatamente os dois casos
 * observados em Production (timeout controlado via AbortController, e
 * qualquer outro erro do SDK) -- sempre JSON seguro, status 200,
 * nunca lança, nunca vaza a key.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

function req(url: string) {
  return new NextRequest(url);
}

class FakeAbortError extends Error {
  constructor() {
    super("This operation was aborted");
    this.name = "AbortError";
  }
}

async function loadRouteWith(t: TestContext, opts: { imagesGenerate: (params: unknown, options: unknown) => Promise<unknown> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("openai", {
    exports: {
      default: class FakeOpenAI {
        // logOpenAIImageError() checa `error instanceof OpenAI.APIError` --
        // precisa existir como propriedade estática mesmo no mock, senão
        // `instanceof undefined` lança antes de chegar no código sob teste.
        static APIError = class FakeAPIError extends Error {};
        images = { generate: opts.imagesGenerate };
      },
    },
  });
  // route.ts importa production-qa-authorization.ts estaticamente (pro
  // gate de Production) mesmo quando o teste roda em "preview" -- essa
  // dependência transitiva puxa @/lib/supabase/server -> next/headers,
  // que não resolve fora do runtime real do Next. Mockada aqui só pra
  // permitir o import do módulo; nunca chamada de verdade nestes testes
  // (VERCEL_ENV="preview" nunca entra no branch de Production).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/production-qa-authorization", {
    exports: { resolveRoleForCurrentUser: async () => null },
  });
  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return mod.GET as (request: NextRequest) => Promise<Response>;
}

test("[timeout controlado] AbortError do SDK -- JSON seguro category=UPSTREAM_TIMEOUT, status 200, nunca 504/lança", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.VERCEL_ENV = "preview";
  process.env.OPENAI_API_KEY = "test-key-never-real";
  try {
    const GET = await loadRouteWith(t, { imagesGenerate: async () => { throw new FakeAbortError(); } });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark?step=generate&model=gpt-image-2&prompt=teste"));
    assert.equal(res.status, 200, "nunca um 504 -- sempre uma resposta JSON controlada, mesmo em timeout");
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.category, "UPSTREAM_TIMEOUT");
    assert.equal(body.model, "gpt-image-2");
    assert.equal(typeof body.durationMs, "number");
    assert.ok(!JSON.stringify(body).includes("test-key-never-real"), "a API key nunca aparece na resposta");
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
  }
});

test("[erro JSON seguro] erro genérico do SDK (não timeout) -- JSON seguro, status 200, nunca lança", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.VERCEL_ENV = "preview";
  process.env.OPENAI_API_KEY = "test-key-never-real";
  try {
    const GET = await loadRouteWith(t, { imagesGenerate: async () => { throw new Error("some upstream failure"); } });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark?step=generate&model=gpt-image-2.5-sunburst&prompt=teste"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.notEqual(body.category, "UPSTREAM_TIMEOUT", "só classificado como UPSTREAM_TIMEOUT quando é de fato um AbortError");
    assert.equal(typeof body.error, "string");
    assert.equal(typeof body.durationMs, "number");
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
  }
});

test("[sucesso] passa o AbortSignal pro SDK como segundo argumento (mesmo padrão de openai-images.ts)", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.VERCEL_ENV = "preview";
  process.env.OPENAI_API_KEY = "test-key-never-real";
  let receivedOptions: { signal?: AbortSignal } | undefined;
  try {
    const GET = await loadRouteWith(t, {
      imagesGenerate: async (_params, options) => {
        receivedOptions = options as { signal?: AbortSignal };
        return { created: 1, data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }] };
      },
    });
    await GET(req("http://x/api/diag-openai-image-benchmark?step=generate&model=gpt-image-2&prompt=teste"));
    assert.ok(receivedOptions?.signal instanceof AbortSignal, "AbortController.signal explícito é passado -- nunca só o timeout do construtor do client");
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
  }
});
