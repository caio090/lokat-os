/**
 * Executar com:
 * node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/meta/campaigns/__tests__/route.behavioral.test.ts
 *
 * PROMPT LKT 16: nenhuma rota lia campanha nenhuma antes desta (listAdAccounts
 * só dava nome de conta). Este arquivo prova o handler GET real de
 * src/app/api/meta/campaigns/route.ts, sem nenhuma chamada real à Meta nem
 * ao Supabase:
 *  - autenticação e parâmetros obrigatórios;
 *  - isolamento por cliente: can_access_client=false -> forbidden, e conta
 *    de anúncio não vinculada a ESTE client_id -> ad_account_not_linked
 *    (nunca aceita "qualquer conta que a conexão acessa");
 *  - escopo ads_read ausente -> ads_scope_not_granted, nunca chama a Graph API;
 *  - token vencido -> token_expired;
 *  - campanha sem dado no período (hasData:false, nunca zero) vs campanha
 *    com dado real vs lista de campanhas legitimamente vazia -- três estados
 *    distintos, nunca confundidos.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { makeMockSupabaseClient, OK } from "../../../../../lib/supabase/__tests__/test-helpers/mock-supabase.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(params: Record<string, string>): any {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://x/api/meta/campaigns?${qs}`, { method: "GET" });
}

const BASE_PARAMS = { client_id: "client-1", ad_account_id: "123", since: "2026-11-01", until: "2026-11-07" };

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

function mockGraphFetch() {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string) => {
    calls.push(url);
    if (url.includes("/campaigns?")) {
      return {
        status: 200,
        json: async () => ({
          data: [
            { id: "c1", name: "Campanha com dado", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_LEADS" },
            { id: "c2", name: "Campanha sem dado no período", status: "PAUSED", effective_status: "PAUSED", objective: "OUTCOME_TRAFFIC" },
          ],
        }),
      };
    }
    if (url.includes("/insights?")) {
      return {
        status: 200,
        json: async () => ({
          data: [
            {
              campaign_id: "c1", spend: "100.5", impressions: "1000", reach: "800", clicks: "50",
              inline_link_clicks: "40", ctr: "5.0",
              actions: [{ action_type: "lead", value: "3" }],
              action_values: [],
              cost_per_action_type: [{ action_type: "lead", value: "33.5" }],
              account_currency: "BRL", date_start: "2026-11-01", date_stop: "2026-11-07",
            },
          ],
        }),
      };
    }
    // getAdAccountMeta: GET act_123?fields=...
    return { status: 200, json: async () => ({ account_id: "123", name: "Conta Teste", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 }) };
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("campaigns: sem sessão -- 401, nenhuma query tentada", async (t) => {
  const { GET, admin } = await loadRouteWith(t, { user: null });
  const res = await GET(req(BASE_PARAMS));
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.reason, "unauthenticated");
  assert.equal(admin.fromCalls.length, 0);
});

test("campaigns: parâmetro obrigatório ausente -- missing_params", async (t) => {
  const { GET } = await loadRouteWith(t, { user: ADMIN, profileRole: "super_admin" });
  const res = await GET(req({ client_id: "client-1", ad_account_id: "123", since: "2026-11-01" }));
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.reason, "missing_params");
});

test("campaigns: período inválido (since > until) -- invalid_period", async (t) => {
  const { GET } = await loadRouteWith(t, { user: ADMIN, profileRole: "super_admin" });
  const res = await GET(req({ ...BASE_PARAMS, since: "2026-11-10", until: "2026-11-01" }));
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.reason, "invalid_period");
});

test("campaigns: can_access_client nega -- forbidden, nunca lê client_meta_assets", async (t) => {
  const { GET, admin } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    rpcResults: { can_access_client: OK(false) },
  });
  const res = await GET(req(BASE_PARAMS));
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.reason, "forbidden");
  assert.equal(admin.fromCalls.filter((c) => c.table === "client_meta_assets").length, 0);
});

test("campaigns: conta de anúncio não vinculada a este cliente -- ad_account_not_linked (isolamento, nunca aceita qualquer conta da conexão)", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    rpcResults: { can_access_client: OK(true) },
    fromResults: { client_meta_assets: { select: OK(null) } },
  });
  const res = await GET(req(BASE_PARAMS));
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.reason, "ad_account_not_linked");
});

test("campaigns: escopo ads_read ausente -- ads_scope_not_granted, NUNCA chama a Graph API", async (t) => {
  const { calls, restore } = mockGraphFetch();
  t.after(restore);

  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    rpcResults: { can_access_client: OK(true) },
    fromResults: {
      client_meta_assets: { select: OK({ meta_connection_id: "conn-1", asset_id: "123", asset_name: "Conta Teste" }) },
      meta_connections: { select: OK({ access_token: "tok-1", status: "active", token_expires_at: null, scopes: "pages_show_list,instagram_basic" }) },
    },
  });
  const res = await GET(req(BASE_PARAMS));
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "ads_scope_not_granted");
  assert.equal(calls.length, 0, "nunca deve chamar a Graph API sem o escopo concedido");
});

test("campaigns: token vencido -- token_expired, nunca chama a Graph API", async (t) => {
  const { calls, restore } = mockGraphFetch();
  t.after(restore);

  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    rpcResults: { can_access_client: OK(true) },
    fromResults: {
      client_meta_assets: { select: OK({ meta_connection_id: "conn-1", asset_id: "123", asset_name: "Conta Teste" }) },
      meta_connections: { select: OK({ access_token: "tok-1", status: "active", token_expires_at: "2020-01-01T00:00:00Z", scopes: "ads_read" }) },
    },
  });
  const res = await GET(req(BASE_PARAMS));
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "token_expired");
  assert.equal(calls.length, 0);
});

test("campaigns: leitura real -- campanha com dado, campanha sem dado no período e metadados do período/conta", async (t) => {
  const { restore } = mockGraphFetch();
  t.after(restore);

  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    rpcResults: { can_access_client: OK(true) },
    fromResults: {
      client_meta_assets: { select: OK({ meta_connection_id: "conn-1", asset_id: "123", asset_name: "Conta Teste" }) },
      meta_connections: { select: OK({ access_token: "tok-1", status: "active", token_expires_at: null, scopes: "ads_read" }) },
    },
  });
  const res = await GET(req(BASE_PARAMS));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.total, 2);
  assert.equal(body.account.currency, "BRL");
  assert.deepEqual(body.period, { since: "2026-11-01", until: "2026-11-07" });

  const c1 = body.campaigns.find((c: { id: string }) => c.id === "c1");
  assert.equal(c1.hasData, true);
  assert.equal(c1.metrics.spend, 100.5);
  assert.equal(c1.metrics.actions[0].action_type, "lead");

  const c2 = body.campaigns.find((c: { id: string }) => c.id === "c2");
  assert.equal(c2.hasData, false);
  assert.equal(c2.metrics, null, "campanha sem dado no período nunca deve vir com métricas zeradas");
});

test("campaigns: lista de campanhas legitimamente vazia -- ok:true, campaigns:[] (nunca erro)", async (t) => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string) => {
    if (url.includes("/campaigns?")) return { status: 200, json: async () => ({ data: [] }) };
    if (url.includes("/insights?")) return { status: 200, json: async () => ({ data: [] }) };
    return { status: 200, json: async () => ({ account_id: "123", name: "Conta Teste", currency: "BRL", timezone_name: "America/Sao_Paulo" }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    rpcResults: { can_access_client: OK(true) },
    fromResults: {
      client_meta_assets: { select: OK({ meta_connection_id: "conn-1", asset_id: "123", asset_name: "Conta Teste" }) },
      meta_connections: { select: OK({ access_token: "tok-1", status: "active", token_expires_at: null, scopes: "ads_read" }) },
    },
  });
  const res = await GET(req(BASE_PARAMS));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.campaigns, []);
  assert.equal(body.total, 0);
});
