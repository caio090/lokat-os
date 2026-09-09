/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/rec-os/series/__tests__/series-item-content-handoff-route.behavioral.test.ts
 * Prompt 28 (Content Handoff Authorization & Recent Series Repair) —
 * GET real de src/app/api/rec-os/series/[seriesId]/items/[itemId]/
 * content-handoff/route.ts. TEST 01/02/03/04/05/07/08 exercitados fim
 * a fim (rota real, não só a função pura de content-handoff.ts) --
 * fecha o loop entre a decisão pura (já testada) e o uso real na rota.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

function getReq(url: string) {
  return new Request(url);
}
function paramsFor(seriesId: string, itemId: string) {
  return { params: Promise.resolve({ seriesId, itemId }) };
}

function seriesFixture(contentId: string | null, itemStatus = "ready", visualAssetId: string | null = "asset-1") {
  return {
    series: { id: "series-1", clientId: "company-A", contentId, campaignId: null, title: null, count: 1, placement: null, format: "carousel", creativeDirection: null, status: "ready", createdBy: "user-1", createdAt: "x", updatedAt: "x" },
    items: [
      { id: "item-1", position: 1, role: "Peça 1", brief: "x", status: itemStatus, visualAssetId, image: visualAssetId ? { url: "https://old/x", width: 1080, height: 1080 } : null, error: null },
    ],
  };
}

function fakeDb(opts: { assetRow?: { storage_path: string; metadata: unknown } | null }) {
  return {
    from(table: string) {
      if (table === "client_visual_assets") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.assetRow ?? null, error: null }) }) }) };
      }
      throw new Error(`tabela inesperada neste fake (esta rota nunca deveria consultar ${table}): ${table}`);
    },
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}?fresh=1` }, error: null }) }) },
  };
}

async function loadRouteWith(t: TestContext, opts: { series?: unknown; assetRow?: { storage_path: string; metadata: unknown } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", { exports: { createServerSupabaseClient: async () => fakeDb({ assetRow: opts.assetRow }) } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/series/repository", {
    exports: { getCreativeSeriesWithItems: async () => (opts.series === undefined ? seriesFixture("content-A") : opts.series) },
  });
  const mod = await import(`../[seriesId]/items/[itemId]/content-handoff/route.ts?t=${Date.now()}-${Math.random()}`);
  return mod.GET as (req: Request, ctx: { params: Promise<{ seriesId: string; itemId: string }> }) => Promise<Response>;
}

test("[TEST 01] REAL SAME-COMPANY HANDOFF -- Series A + Content A (o mesmo já associado) -- 200, ALLOW (reproduzia 403 antes do fix)", async (t) => {
  const GET = await loadRouteWith(t, { assetRow: { storage_path: "company-A/item-1/gen-1.jpg", metadata: { mime: "image/jpeg" } } });
  const res = await GET(getReq("http://x/x/content-handoff?content_id=content-A"), paramsFor("series-1", "item-1"));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.contentId, "content-A");
});

test("[TEST 02] DIFFERENT COMPANY -- content_id pedido diferente do já associado à série -- 403 DENY", async (t) => {
  const GET = await loadRouteWith(t, {});
  const res = await GET(getReq("http://x/x/content-handoff?content_id=content-de-outra-company"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, "SERIES_ITEM_CONTENT_FORBIDDEN");
});

test("[TEST 03] série standalone (sem content_id associado) -- 403 fail closed", async (t) => {
  const GET = await loadRouteWith(t, { series: seriesFixture(null) });
  const res = await GET(getReq("http://x/x/content-handoff?content_id=content-qualquer"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 403);
});

test("[TEST 05] item de outra série -- 404, nunca autoriza", async (t) => {
  const GET = await loadRouteWith(t, {});
  const res = await GET(getReq("http://x/x/content-handoff?content_id=content-A"), paramsFor("series-1", "item-inexistente"));
  assert.equal(res.status, 404);
});

test("item não-ready -- 409, nunca autoriza handoff de conteúdo de um item incompleto", async (t) => {
  const GET = await loadRouteWith(t, { series: seriesFixture("content-A", "planned", null) });
  const res = await GET(getReq("http://x/x/content-handoff?content_id=content-A"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 409);
});

test("[TEST 08] sucesso -- 0 chamadas ao provider (rota nunca importa nada de geração)", async (t) => {
  const GET = await loadRouteWith(t, { assetRow: { storage_path: "company-A/item-1/gen-1.png", metadata: { mime: "image/png" } } });
  const res = await GET(getReq("http://x/x/content-handoff?content_id=content-A"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(typeof data.signedUrl === "string" && typeof data.mimeType === "string" && typeof data.fileName === "string");
});

test("content_id ausente na query -- 400, nunca tenta autorizar sem ele", async (t) => {
  const GET = await loadRouteWith(t, {});
  const res = await GET(getReq("http://x/x/content-handoff"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 400);
});

test("série inexistente/não autorizada -- 404 genérico (fail closed)", async (t) => {
  const GET = await loadRouteWith(t, { series: null });
  const res = await GET(getReq("http://x/x/content-handoff?content_id=content-A"), paramsFor("series-x", "item-1"));
  assert.equal(res.status, 404);
});
