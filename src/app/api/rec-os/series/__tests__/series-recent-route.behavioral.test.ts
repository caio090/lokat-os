/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/rec-os/series/__tests__/series-recent-route.behavioral.test.ts
 * Prompt 26 (Dedicated Series Workspace Completion) — GET real de
 * src/app/api/rec-os/series/recent/route.ts. [TEST 09] bounded list +
 * Company scope; [TEST 11] limite aplicado na query, não em memória.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

function getReq(qs: string) {
  return new Request(`http://x/api/rec-os/series/recent${qs}`);
}

async function loadRouteWith(t: TestContext, opts: {
  resolution?: { valid: boolean; reason?: string; context: { companyId: string; companyName: string | null; workspaceId: string | null; readOnly?: boolean } | null };
  currentUser?: { id: string } | null;
  listCalls?: { filter: unknown; limit: number }[];
  listResult?: unknown[];
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/company-context/resolve", {
    exports: { resolveCompanyContext: async () => opts.resolution ?? { valid: false, reason: "not_authenticated", context: null } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/auth/get-current-user", {
    exports: { getCurrentUser: async () => (opts.currentUser === undefined ? { id: "user-1" } : opts.currentUser) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", { exports: { createServerSupabaseClient: async () => ({}) } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/series/repository", {
    exports: {
      listRecentCreativeSeries: async (_db: unknown, filter: unknown, limit: number) => {
        opts.listCalls?.push({ filter, limit });
        return opts.listResult ?? [];
      },
    },
  });
  const mod = await import(`../recent/route.ts?t=${Date.now()}-${Math.random()}`);
  return mod.GET as (req: Request) => Promise<Response>;
}

test("[TEST 09] Company autorizada -- lista devolvida com scope correto", async (t) => {
  const calls: { filter: unknown; limit: number }[] = [];
  const GET = await loadRouteWith(t, {
    resolution: { valid: true, context: { companyId: "company-a", companyName: "Empresa A", workspaceId: "company-a" } },
    listCalls: calls,
    listResult: [{ id: "series-1", clientId: "company-a", count: 6, format: "carousel", status: "generating", createdAt: "x", readyCount: 2, totalCount: 6 }],
  });
  const res = await GET(getReq("?client_id=company-a"));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.series.length, 1);
  assert.deepEqual(calls[0].filter, { clientId: "company-a", contentId: null });
});

test("[TEST 11] limite default (6) e limite explícito respeitado, nunca acima do teto", async (t) => {
  const calls: { filter: unknown; limit: number }[] = [];
  const GET = await loadRouteWith(t, { resolution: { valid: true, context: { companyId: "company-a", companyName: null, workspaceId: "company-a" } }, listCalls: calls });
  await GET(getReq("?client_id=company-a"));
  assert.equal(calls[0].limit, 6, "default é 6 quando nenhum limit é pedido");

  await GET(getReq("?client_id=company-a&limit=3"));
  assert.equal(calls[1].limit, 3, "limit explícito respeitado");

  await GET(getReq("?client_id=company-a&limit=999"));
  assert.equal(calls[2].limit, 6, "nunca ultrapassa o teto de 6 -- nunca vira uma biblioteca completa (FASE 24)");
});

test("Company não autorizada -- 403, nunca lista", async (t) => {
  const calls: { filter: unknown; limit: number }[] = [];
  const GET = await loadRouteWith(t, { resolution: { valid: false, reason: "role_not_supported", context: null }, listCalls: calls });
  const res = await GET(getReq("?client_id=company-b"));
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0, "nunca chama listRecentCreativeSeries sem autorização");
});

test("Free Mode -- sem client_id, sessão presente -- lista owner-scoped", async (t) => {
  const calls: { filter: unknown; limit: number }[] = [];
  const GET = await loadRouteWith(t, { currentUser: { id: "user-1" }, listCalls: calls });
  const res = await GET(getReq(""));
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0].filter, { clientId: null, contentId: null });
});

test("Free Mode -- sem sessão -- 401, nunca lista", async (t) => {
  const calls: { filter: unknown; limit: number }[] = [];
  const GET = await loadRouteWith(t, { currentUser: null, listCalls: calls });
  const res = await GET(getReq(""));
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});
