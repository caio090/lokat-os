/**
 * Executar com:
 * node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/meta/connections/__tests__/route.behavioral.test.ts
 *
 * PROMPT LKT 14: /api/meta/connections nunca tinha teste -- o painel
 * (src/app/admin/conexoes/page.tsx) tratava QUALQUER resposta sem
 * d.connections (inclusive ok:false por permissão/banco) como lista vazia,
 * sempre mostrando "Nenhuma conexão retornada". Este arquivo prova o lado
 * do handler real: cada causa (sem sessão, sem permissão, tabela ausente,
 * erro de banco, lista vazia de verdade, múltiplas conexões) chega como um
 * `reason` distinto -- nunca como "ok:true, connections:[]" disfarçado.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { makeMockSupabaseClient, OK } from "../../../../../lib/supabase/__tests__/test-helpers/mock-supabase.ts";

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
const AGENCY = { id: "agency-1", email: "agency@example.com" };

test("connections: sem sessão -- 401 unauthenticated, nenhuma query de conexões tentada", async (t) => {
  const { GET, admin } = await loadRouteWith(t, { user: null });
  const res = await GET();
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "unauthenticated");
  assert.equal(admin.fromCalls.filter((c) => c.table === "meta_connections").length, 0);
});

test("connections: role sem permissão -- 403 forbidden", async (t) => {
  const { GET } = await loadRouteWith(t, { user: AGENCY, profileRole: "cliente" });
  const res = await GET();
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "forbidden");
});

test("connections: tabela meta_connections ainda não existe -- sql_pending, nunca 'lista vazia'", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    fromResults: { meta_connections: { select: { data: null, error: { code: "42P01", message: "relation does not exist" } } } },
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "sql_pending");
  assert.equal(body.connections, undefined, "sql_pending nunca deve vir acompanhado de connections:[] (isso é o bug do PROMPT LKT 14)");
});

test("connections: erro de banco real (não 42P01) -- db_error com status 500, nunca 'lista vazia'", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    fromResults: { meta_connections: { select: { data: null, error: { code: "XX000", message: "connection reset by peer" } } } },
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "db_error");
  assert.equal(body.connections, undefined);
});

test("connections: lista legitimamente vazia -- ok:true, connections:[] (nenhuma conexão ativa de verdade)", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    fromResults: {
      meta_connections: { select: OK([]) },
      client_meta_assets: { select: OK([]) },
    },
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.connections, []);
});

test("connections: múltiplas conexões ativas -- ok:true com cada uma + contagem de clientes vinculados", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: ADMIN, profileRole: "super_admin",
    fromResults: {
      meta_connections: {
        select: OK([
          { id: "conn-1", status: "active", is_active: true, created_at: "2026-06-26T05:04:47Z", connected_by: "admin-1", meta_user_id: "mid-1", profiles: { full_name: "Caio", email: "admin@example.com" } },
          { id: "conn-2", status: "active", is_active: true, created_at: "2026-08-19T17:09:01Z", connected_by: "admin-1", meta_user_id: "mid-1", profiles: { full_name: "Caio", email: "admin@example.com" } },
        ]),
      },
      client_meta_assets: { select: OK([{ meta_connection_id: "conn-1", client_id: "client-duh" }]) },
    },
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.connections.length, 2);
  assert.equal(body.connections.find((c: { id: string }) => c.id === "conn-1")?.linked_clients_count, 1);
  assert.equal(body.connections.find((c: { id: string }) => c.id === "conn-2")?.linked_clients_count, 0);
});

test("connections: agency vê só as próprias conexões (não todas da plataforma)", async (t) => {
  const { GET, admin } = await loadRouteWith(t, {
    user: AGENCY, profileRole: "agency",
    fromResults: {
      meta_connections: { select: OK([{ id: "conn-own", status: "active", is_active: true, created_at: "2026-01-01T00:00:00Z", connected_by: "agency-1", meta_user_id: "mid-2", profiles: null }]) },
      client_meta_assets: { select: OK([]) },
    },
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.connections.length, 1);
  // Lê via admin client (service role bypassa RLS) -- a rota ainda aplica
  // .eq("connected_by", userId) na query para papéis não-admin.
  assert.equal(admin.fromCalls.filter((c) => c.table === "meta_connections").length, 1);
});
