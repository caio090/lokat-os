/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/admin/clients/__tests__/onboarding-profile-route.behavioral.test.ts
 * (arquivo fica FORA de [id]/ de propósito -- mesmo motivo de
 * archive-route.behavioral.test.ts/restore-route.behavioral.test.ts: o
 * runner de teste do Node interpreta colchetes no caminho como glob.)
 *
 * FASE 31O (Admin Company DNA Editor) — chama os handlers GET/PUT REAIS
 * de src/app/api/admin/clients/[id]/onboarding-profile/route.ts, mocka
 * só as dependências externas (Supabase session/admin client, proteção
 * de preview) -- nunca a lógica da própria rota. Prova, com o payload
 * capturado pelo mock, que: nunca cria uma Company nova, nunca lê
 * client_id do body, e nunca toca a Company errada.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { makeMockSupabaseClient, OK } from "../../../../../lib/supabase/__tests__/test-helpers/mock-supabase.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReq(url: string): any {
  return new Request(url, { method: "GET" });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function putReq(url: string, body: unknown): any {
  return new Request(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/workspaces/assert-not-preview", {
    exports: {
      withMutationProtection: (handler: (...args: unknown[]) => unknown) => handler,
      assertWorkspaceMutationAllowed: async () => null,
    },
  });
  // production-qa-authorization.ts não é importado com cache-busting (fica
  // dentro de route.ts) -- sem mockar seu export diretamente, o módulo real
  // fica em cache entre testes e "congela" o mock de @/lib/supabase/server
  // do PRIMEIRO teste que o carregou, ignorando o profileRole dos testes
  // seguintes. Mockar aqui evita esse vazamento entre testes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/production-qa-authorization", {
    exports: {
      resolveRoleForCurrentUser: async () => (opts?.user ? (opts.profileRole ?? null) : null),
    },
  });
  const mod = await import(`../[id]/onboarding-profile/route.ts?t=${Date.now()}-${Math.random()}`);
  return { GET: mod.GET, PUT: mod.PUT, session: mocked, admin: adminMocked };
}

const SUPER_ADMIN = { id: "super-admin-1", email: "super@example.com" };
const ADMIN = { id: "admin-1", email: "admin@example.com" };
const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

// ── 1. Super Admin access ────────────────────────────────────────────

test("GET: super_admin autorizado, Company existe -- 200 com o profile", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: {
      clients: { select: OK({ id: COMPANY_A, company_name: "Empresa A" }) },
      onboarding_profiles: { select: OK({ brand_name: "Empresa A" }) },
    },
  });
  const res = await GET(getReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`), ctx(COMPANY_A));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.companyName, "Empresa A");
  assert.equal(body.profile.brand_name, "Empresa A");
});

// ── 2. Unauthorized user blocked ─────────────────────────────────────

test("GET: role sem permissão (operacional) -- 403, nunca consulta clients/onboarding_profiles", async (t) => {
  const { GET, session } = await loadRouteWith(t, { user: ADMIN, profileRole: "operacional" });
  const res = await GET(getReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`), ctx(COMPANY_A));
  assert.equal(res.status, 403);
  assert.equal(session.fromCalls.some((c) => c.table === "clients" || c.table === "onboarding_profiles"), false);
});

test("PUT: role sem permissão (operacional) -- 403, nenhum upsert é sequer tentado", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, { user: ADMIN, profileRole: "operacional" });
  const res = await PUT(putReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`, { brand_name: "X" }), ctx(COMPANY_A));
  assert.equal(res.status, 403);
  assert.equal(admin.fromCalls.filter((c) => c.op === "upsert").length, 0);
});

test("PUT: usuário não autenticado -- 401, nenhum upsert é tentado", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, { user: null });
  const res = await PUT(putReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`, { brand_name: "X" }), ctx(COMPANY_A));
  assert.equal(res.status, 401);
  assert.equal(admin.fromCalls.filter((c) => c.op === "upsert").length, 0);
});

// ── 3/4. Company existente explícita define a Company certa; Company inexistente nunca é criada ──

test("PUT: Company inexistente -- 404, NUNCA cria uma Company nova (upsert jamais chamado)", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: { clients: { select: OK(null) } },
  });
  const res = await PUT(putReq(`http://x/api/admin/clients/does-not-exist/onboarding-profile`, { brand_name: "X" }), ctx("does-not-exist"));
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.error, "not_found");
  assert.equal(admin.fromCalls.filter((c) => c.op === "upsert").length, 0, "linha em onboarding_profiles nunca é criada para um client_id que não existe em clients");
});

test("GET: Company inexistente -- 404", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: { clients: { select: OK(null) } },
  });
  const res = await GET(getReq(`http://x/api/admin/clients/does-not-exist/onboarding-profile`), ctx("does-not-exist"));
  assert.equal(res.status, 404);
});

// ── 5/6. Insert quando ausente / update quando presente (upsert cobre os dois; DB decide via onConflict) ──

test("PUT: profile ainda não existe para a Company -- upsert com onConflict client_id (caminho de insert)", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: {
      clients: { select: OK({ id: COMPANY_A }) },
      onboarding_profiles: { upsert: OK() },
    },
  });
  const res = await PUT(putReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`, { brand_name: "Nova Empresa" }), ctx(COMPANY_A));
  assert.equal(res.status, 200);
  const upserts = admin.fromCalls.filter((c) => c.table === "onboarding_profiles" && c.op === "upsert");
  assert.equal(upserts.length, 1);
  const payload = upserts[0]?.payload as Record<string, unknown>;
  assert.equal(payload.client_id, COMPANY_A);
  assert.equal(payload.brand_name, "Nova Empresa");
});

test("PUT: profile já existe para a Company -- mesmo caminho de upsert (onConflict client_id cobre o update)", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: {
      clients: { select: OK({ id: COMPANY_A }) },
      onboarding_profiles: { upsert: OK() },
    },
  });
  const res = await PUT(putReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`, { brand_name: "Empresa Atualizada" }), ctx(COMPANY_A));
  assert.equal(res.status, 200);
  const upserts = admin.fromCalls.filter((c) => c.table === "onboarding_profiles" && c.op === "upsert");
  assert.equal(upserts.length, 1);
  const payload = upserts[0]?.payload as Record<string, unknown>;
  assert.equal(payload.client_id, COMPANY_A);
  assert.equal(payload.brand_name, "Empresa Atualizada");
});

// ── 7. Outros client_ids nunca são alterados (client_id vem SEMPRE do path, nunca do body) ──

test("PUT: body tenta enviar client_id de OUTRA Company -- ignorado; o upsert grava sempre o client_id do path", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: {
      clients: { select: OK({ id: COMPANY_A }) },
      onboarding_profiles: { upsert: OK() },
    },
  });
  const res = await PUT(
    putReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`, { client_id: COMPANY_B, id: COMPANY_B, brand_name: "Tentativa de cross-write" }),
    ctx(COMPANY_A),
  );
  assert.equal(res.status, 200);
  const payload = admin.fromCalls.find((c) => c.op === "upsert")?.payload as Record<string, unknown>;
  assert.equal(payload.client_id, COMPANY_A, "client_id do body é ignorado -- sempre o do path param, nunca escreve na Company B");
});

// ── 8. logo_url persiste (com validação server-side de extensão) ────

test("PUT: logo_url com extensão de imagem válida -- persiste", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: { clients: { select: OK({ id: COMPANY_A }) }, onboarding_profiles: { upsert: OK() } },
  });
  const res = await PUT(putReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`, { logo_url: "https://cdn.example.com/logo.png" }), ctx(COMPANY_A));
  assert.equal(res.status, 200);
  const payload = admin.fromCalls.find((c) => c.op === "upsert")?.payload as Record<string, unknown>;
  assert.equal(payload.logo_url, "https://cdn.example.com/logo.png");
});

test("PUT: logo_url com extensão não permitida (vídeo) -- campo ignorado, resto do payload ainda salva", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: { clients: { select: OK({ id: COMPANY_A }) }, onboarding_profiles: { upsert: OK() } },
  });
  const res = await PUT(
    putReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`, { logo_url: "https://cdn.example.com/video.mp4", brand_name: "Empresa A" }),
    ctx(COMPANY_A),
  );
  assert.equal(res.status, 200);
  const payload = admin.fromCalls.find((c) => c.op === "upsert")?.payload as Record<string, unknown>;
  assert.equal("logo_url" in payload, false, "extensão não é de imagem -- logo_url nunca chega a gravar");
  assert.equal(payload.brand_name, "Empresa A", "demais campos do mesmo request continuam salvando normalmente");
});

// ── brand_colors / tone_of_voice sanitizados ─────────────────────────

test("PUT: brand_colors e tone_of_voice são sanitizados para os formatos esperados", async (t) => {
  const { PUT, admin } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: { clients: { select: OK({ id: COMPANY_A }) }, onboarding_profiles: { upsert: OK() } },
  });
  const res = await PUT(
    putReq(`http://x/api/admin/clients/${COMPANY_A}/onboarding-profile`, {
      brand_colors: [{ label: "Primária", hex: "#FF0000" }, { label: "", hex: "não é hex" }, "lixo"],
      tone_of_voice: ["  direto  ", "", "descontraído"],
    }),
    ctx(COMPANY_A),
  );
  assert.equal(res.status, 200);
  const payload = admin.fromCalls.find((c) => c.op === "upsert")?.payload as Record<string, unknown>;
  const colors = payload.brand_colors as { label: string; hex: string }[];
  assert.equal(colors.length, 1, "entrada totalmente inválida (sem label nem hex válido) é descartada");
  assert.equal(colors[0]?.hex, "#FF0000");
  assert.deepEqual(payload.tone_of_voice, ["direto", "descontraído"], "itens vazios descartados, espaços aparados");
});

// ── 9. Company selecionada explicitamente é a Company certa (GET/PUT nunca vazam outra Company) ──

test("GET: client_id do path define exatamente qual Company é lida", async (t) => {
  const { GET } = await loadRouteWith(t, {
    user: SUPER_ADMIN,
    profileRole: "super_admin",
    fromResults: {
      clients: { select: OK({ id: COMPANY_B, company_name: "Empresa B" }) },
      onboarding_profiles: { select: OK({ brand_name: "Empresa B" }) },
    },
  });
  const res = await GET(getReq(`http://x/api/admin/clients/${COMPANY_B}/onboarding-profile`), ctx(COMPANY_B));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.clientId, COMPANY_B);
  assert.equal(body.companyName, "Empresa B");
});
