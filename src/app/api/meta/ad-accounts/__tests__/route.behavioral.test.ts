/**
 * Executar com:
 * node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/meta/ad-accounts/__tests__/route.behavioral.test.ts
 *
 * Chama o handler GET REAL de src/app/api/meta/ad-accounts/route.ts.
 * Prova, sem nenhuma chamada real à Meta nem ao Supabase:
 *  - sem sessão -> 401, sem tentar ler conexão nenhuma;
 *  - nenhuma conexão ativa -> not_connected;
 *  - mais de uma conexão ativa sem connection_id -> connection_selection_required
 *    (o mesmo achado real de produção em 2026-11-23: 8 conexões ativas simultâneas);
 *  - conexão sem ads_read/ads_management em scopes -> ads_scope_not_granted,
 *    com a instrução exata de como habilitar (nunca um erro genérico de permissão);
 *  - conexão com ads_read concedido -> chama listAdAccounts e devolve a lista real.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { makeMockSupabaseClient, OK } from "../../../../../lib/supabase/__tests__/test-helpers/mock-supabase.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(connectionId?: string): any {
  const url = connectionId ? `http://x/api/meta/ad-accounts?connection_id=${connectionId}` : "http://x/api/meta/ad-accounts";
  return new Request(url, { method: "GET" });
}

async function loadRouteWith(t: TestContext, opts: Parameters<typeof makeMockSupabaseClient>[0]) {
  const mocked = makeMockSupabaseClient(opts);
  const adminMocked = makeMockSupabaseClient(opts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", {
    exports: {
      createServerSupabaseClient: async () => mocked.client,
      createSupabaseAdminClient: () => adminMocked.client,
      hasSupabaseServiceRoleKey: () => true,
    },
  });
  const mod = await import(`../route.ts?t=${Date.now()}-${Math.random()}`);
  return { GET: mod.GET, session: mocked, admin: adminMocked };
}

const ADMIN = { id: "admin-1", email: "admin@example.com" };

test("ad-accounts: sem sessão -- 401, nenhuma leitura de conexão tentada", async (t) => {
  const { GET, admin } = await loadRouteWith(t, { user: null });
  const res = await GET(req());
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.reason, "unauthenticated");
  assert.equal(admin.fromCalls.filter((c) => c.table === "meta_connections").length, 0);
});

test("ad-accounts: nenhuma conexão ativa -- not_connected", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    fromResults: { meta_connections: { select: OK([]) } },
  });
  const res = await GET(req());
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "not_connected");
});

test("ad-accounts: mais de uma conexão ativa sem connection_id -- connection_selection_required (mesmo achado real de produção)", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    fromResults: {
      meta_connections: {
        select: OK([
          { id: "conn-1", access_token: "tok-1", scopes: null },
          { id: "conn-2", access_token: "tok-2", scopes: null },
        ]),
      },
    },
  });
  const res = await GET(req());
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "connection_selection_required");
  assert.equal(body.connection_count, 2);
});

test("ad-accounts: conexão sem ads_read -- ads_scope_not_granted com instrução exata, NUNCA chama a Graph API", async (t) => {
  const originalFetch = globalThis.fetch;
  let graphCalled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => { graphCalled = true; return { status: 200, json: async () => ({ data: [] }) }; };
  t.after(() => { globalThis.fetch = originalFetch; });

  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    fromResults: {
      meta_connections: { select: OK([{ id: "conn-1", access_token: "tok-1", scopes: "pages_show_list,instagram_basic" }]) },
    },
  });
  const res = await GET(req());
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "ads_scope_not_granted");
  assert.ok(Array.isArray(body.howToEnable) && body.howToEnable.length > 0);
  assert.ok(body.howToEnable.some((s: string) => s.includes("META_OAUTH_EXTRA_SCOPES")));
  assert.equal(graphCalled, false, "nunca deve chamar a Graph API sem o escopo concedido");
});

test("ad-accounts: conexão COM ads_read -- lê contas de anúncio reais via Graph API", async (t) => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => ({
    status: 200,
    json: async () => ({ data: [{ account_id: "123", name: "Conta Lokat", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 }] }),
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    fromResults: {
      meta_connections: { select: OK([{ id: "conn-1", access_token: "tok-1", scopes: "pages_show_list,ads_read" }]) },
    },
  });
  const res = await GET(req());
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.total, 1);
  assert.equal(body.accounts[0].name, "Conta Lokat");
});
