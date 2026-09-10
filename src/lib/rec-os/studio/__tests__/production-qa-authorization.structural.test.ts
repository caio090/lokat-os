/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/lib/rec-os/studio/__tests__/production-qa-authorization.structural.test.ts
 * FASE 31G.2 (Production-Safe QA Mode) — exercita a implementação REAL
 * de production-qa-authorization.ts (nunca uma reimplementação),
 * mockando só @/lib/supabase/server (única dependência externa). Cada
 * teste importa o módulo fresh (?t=) para nunca reaproveitar um
 * binding congelado de um teste anterior.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

async function loadWith(t: TestContext, opts: { user?: { id: string } | null; profileRole?: string | null; userMetadataRole?: string | null; appMetadataRole?: string | null; throwOnGetUser?: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", {
    exports: {
      createServerSupabaseClient: async () => {
        if (opts.throwOnGetUser) throw new Error("boom");
        const user = opts.user === undefined ? { id: "u1", user_metadata: { role: opts.userMetadataRole }, app_metadata: { role: opts.appMetadataRole } } : opts.user;
        return {
          auth: { getUser: async () => ({ data: { user } }) },
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profileRole !== undefined ? { role: opts.profileRole } : null }) }) }) }),
        };
      },
    },
  });
  return import(`../production-qa-authorization.ts?t=${Date.now()}-${Math.random()}`);
}

test("[flag] isProductionQaFlagEnabled lê LKT_PRODUCTION_QA_DRY_RUN -- '1'/'true' ligam, ausente/outro valor não", async (t) => {
  const mod = await loadWith(t, {});
  const saved = process.env.LKT_PRODUCTION_QA_DRY_RUN;
  try {
    delete process.env.LKT_PRODUCTION_QA_DRY_RUN;
    assert.equal(mod.isProductionQaFlagEnabled(), false);
    process.env.LKT_PRODUCTION_QA_DRY_RUN = "1";
    assert.equal(mod.isProductionQaFlagEnabled(), true);
    process.env.LKT_PRODUCTION_QA_DRY_RUN = "true";
    assert.equal(mod.isProductionQaFlagEnabled(), true);
    process.env.LKT_PRODUCTION_QA_DRY_RUN = "yes";
    assert.equal(mod.isProductionQaFlagEnabled(), false, "só '1'/'true' ligam -- nunca um valor 'truthy' arbitrário");
  } finally {
    if (saved === undefined) delete process.env.LKT_PRODUCTION_QA_DRY_RUN; else process.env.LKT_PRODUCTION_QA_DRY_RUN = saved;
  }
});

test("[decisão pura] evaluateProductionQaAccess -- matriz completa de decisão", async (t) => {
  const mod = await loadWith(t, {});
  assert.equal(mod.evaluateProductionQaAccess({ requested: false, flagEnabled: true, authenticated: true, role: "admin" }), "not_requested");
  assert.equal(mod.evaluateProductionQaAccess({ requested: true, flagEnabled: false, authenticated: true, role: "admin" }), "flag_disabled");
  assert.equal(mod.evaluateProductionQaAccess({ requested: true, flagEnabled: true, authenticated: false, role: null }), "unauthenticated");
  assert.equal(mod.evaluateProductionQaAccess({ requested: true, flagEnabled: true, authenticated: true, role: "cliente" }), "forbidden");
  assert.equal(mod.evaluateProductionQaAccess({ requested: true, flagEnabled: true, authenticated: true, role: null }), "forbidden");
  assert.equal(mod.evaluateProductionQaAccess({ requested: true, flagEnabled: true, authenticated: true, role: "admin" }), "allowed");
  assert.equal(mod.evaluateProductionQaAccess({ requested: true, flagEnabled: true, authenticated: true, role: "super_admin" }), "allowed");
});

test("[resolveRoleForCurrentUser] sem sessão -- null", async (t) => {
  const mod = await loadWith(t, { user: null });
  assert.equal(await mod.resolveRoleForCurrentUser(), null);
});

test("[resolveRoleForCurrentUser] profiles.role tem precedência sobre metadata", async (t) => {
  const mod = await loadWith(t, { profileRole: "admin", userMetadataRole: "cliente", appMetadataRole: "cliente" });
  assert.equal(await mod.resolveRoleForCurrentUser(), "admin");
});

test("[resolveRoleForCurrentUser] sem profiles.role -- cai pro user_metadata", async (t) => {
  const mod = await loadWith(t, { profileRole: null, userMetadataRole: "operacional", appMetadataRole: "cliente" });
  assert.equal(await mod.resolveRoleForCurrentUser(), "operacional");
});

test("[resolveRoleForCurrentUser] sem profiles.role nem user_metadata -- cai pro app_metadata", async (t) => {
  const mod = await loadWith(t, { profileRole: null, userMetadataRole: undefined, appMetadataRole: "financeiro" });
  assert.equal(await mod.resolveRoleForCurrentUser(), "financeiro");
});

test("[resolveRoleForCurrentUser] erro/exceção -- nunca lança, devolve null (forbidden por padrão)", async (t) => {
  const mod = await loadWith(t, { throwOnGetUser: true });
  assert.equal(await mod.resolveRoleForCurrentUser(), null);
});
