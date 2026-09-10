/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/diag-openai-image-benchmark/__tests__/route-gating.behavioral.test.ts
 * FASE 31H (Production-Safe OpenAI Benchmark) — testa SÓ o gate de
 * acesso do GET real (route.ts), mockando resolveRoleForCurrentUser
 * (única dependência externa do gate). Nunca chama OpenAI de verdade
 * -- usa `?step=` ausente/inválido como sinal de "passou do gate"
 * (400, não 403/404), sem precisar mockar o SDK inteiro só pra isto.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

function req(url: string) {
  return new NextRequest(url);
}

async function loadRouteWith(t: TestContext, opts: { role: string | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/production-qa-authorization", {
    exports: { resolveRoleForCurrentUser: async () => opts.role },
  });
  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return mod.GET as (request: NextRequest) => Promise<Response>;
}

test("[preview] continua liberado sem autenticação, como antes -- passa do gate (400 por step ausente, nunca 403/404 de auth)", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    const GET = await loadRouteWith(t, { role: null });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark"));
    assert.equal(res.status, 400, "chegou até a checagem de step -- gate de Preview não bloqueou");
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
  }
});

test("[production] flag desligada -- 404, mesmo sem tentar autenticação", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedFlag = process.env.LKT_PRODUCTION_OPENAI_BENCHMARK;
  process.env.VERCEL_ENV = "production";
  delete process.env.LKT_PRODUCTION_OPENAI_BENCHMARK;
  try {
    const GET = await loadRouteWith(t, { role: "admin" });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark"));
    assert.equal(res.status, 404);
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedFlag === undefined) delete process.env.LKT_PRODUCTION_OPENAI_BENCHMARK; else process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = savedFlag;
  }
});

test("[production] flag ligada + sem sessão (role null) -- 403", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedFlag = process.env.LKT_PRODUCTION_OPENAI_BENCHMARK;
  process.env.VERCEL_ENV = "production";
  process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = "1";
  try {
    const GET = await loadRouteWith(t, { role: null });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark"));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "forbidden");
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedFlag === undefined) delete process.env.LKT_PRODUCTION_OPENAI_BENCHMARK; else process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = savedFlag;
  }
});

test("[production] flag ligada + usuário comum (role cliente) -- 403", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedFlag = process.env.LKT_PRODUCTION_OPENAI_BENCHMARK;
  process.env.VERCEL_ENV = "production";
  process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = "1";
  try {
    const GET = await loadRouteWith(t, { role: "cliente" });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark"));
    assert.equal(res.status, 403);
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedFlag === undefined) delete process.env.LKT_PRODUCTION_OPENAI_BENCHMARK; else process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = savedFlag;
  }
});

test("[production] flag ligada + role admin real -- passa do gate (400 por step ausente, nunca 403)", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedFlag = process.env.LKT_PRODUCTION_OPENAI_BENCHMARK;
  process.env.VERCEL_ENV = "production";
  process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = "1";
  try {
    const GET = await loadRouteWith(t, { role: "admin" });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark"));
    assert.equal(res.status, 400);
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedFlag === undefined) delete process.env.LKT_PRODUCTION_OPENAI_BENCHMARK; else process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = savedFlag;
  }
});

test("[production] flag ligada + role super_admin -- também passa do gate (canAccessAdmin aceita os dois)", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedFlag = process.env.LKT_PRODUCTION_OPENAI_BENCHMARK;
  process.env.VERCEL_ENV = "production";
  process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = "1";
  try {
    const GET = await loadRouteWith(t, { role: "super_admin" });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark"));
    assert.equal(res.status, 400);
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedFlag === undefined) delete process.env.LKT_PRODUCTION_OPENAI_BENCHMARK; else process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = savedFlag;
  }
});

test("[dev local] VERCEL_ENV ausente -- 404, nunca liberado (mesmo comportamento de antes desta fase)", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  delete process.env.VERCEL_ENV;
  try {
    const GET = await loadRouteWith(t, { role: "admin" });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark"));
    assert.equal(res.status, 404);
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
  }
});

test("[modelos allowlisted] step=generate com modelo fora da allowlist -- 400, nunca chega a construir request pra OpenAI", async (t) => {
  const savedEnv = process.env.VERCEL_ENV;
  const savedFlag = process.env.LKT_PRODUCTION_OPENAI_BENCHMARK;
  process.env.VERCEL_ENV = "production";
  process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = "1";
  try {
    const GET = await loadRouteWith(t, { role: "admin" });
    const res = await GET(req("http://x/api/diag-openai-image-benchmark?step=generate&model=gpt-4&prompt=teste"));
    assert.equal(res.status, 400);
  } finally {
    if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv;
    if (savedFlag === undefined) delete process.env.LKT_PRODUCTION_OPENAI_BENCHMARK; else process.env.LKT_PRODUCTION_OPENAI_BENCHMARK = savedFlag;
  }
});
