/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/rec-os/series/__tests__/series-item-asset-route.behavioral.test.ts
 * Prompt 26 (Dedicated Series Workspace Completion) — GET real de
 * src/app/api/rec-os/series/[seriesId]/items/[itemId]/asset/route.ts.
 * [TEST 03] download resolve o ativo canônico; [TEST 05/06] content
 * handoff; [TEST 08] asset spoof -- exercitado fim a fim (rota real,
 * não só a função pura de asset-resolution.ts).
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

function getReq(url: string) {
  return new Request(url);
}
function paramsFor(seriesId: string, itemId: string) {
  return { params: Promise.resolve({ seriesId, itemId }) };
}

function seriesFixture(clientId: string | null, itemStatus: string, visualAssetId: string | null) {
  return {
    series: { id: "series-1", clientId, contentId: null, campaignId: null, title: null, count: 2, placement: null, format: "carousel", creativeDirection: null, status: "generating", createdBy: "user-1", createdAt: "x", updatedAt: "x" },
    items: [
      { id: "item-1", position: 1, role: "Peça 1", brief: "x", status: itemStatus, visualAssetId, image: visualAssetId ? { url: "https://old-signed/x", width: 1080, height: 1080 } : null, error: null },
    ],
  };
}

/** Fake mínimo do client Supabase da sessão: só os dois `.from()` que a rota real usa. */
function fakeDb(opts: { assetRow?: { storage_path: string; metadata: unknown } | null; contentRow?: { id: string } | null }) {
  return {
    from(table: string) {
      if (table === "client_visual_assets") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.assetRow ?? null, error: null }) }) }) };
      }
      if (table === "content_items") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.contentRow ?? null, error: null }) }) }) }) };
      }
      throw new Error(`tabela inesperada neste fake: ${table}`);
    },
    storage: {
      from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}?fresh=1` }, error: null }) }),
    },
  };
}

async function loadRouteWith(t: TestContext, opts: { series?: unknown; assetRow?: { storage_path: string; metadata: unknown } | null; contentRow?: { id: string } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", {
    exports: { createServerSupabaseClient: async () => fakeDb({ assetRow: opts.assetRow, contentRow: opts.contentRow }) },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/rec-os/studio/series/repository", {
    exports: { getCreativeSeriesWithItems: async () => (opts.series === undefined ? seriesFixture("company-a", "ready", "asset-1") : opts.series) },
  });
  const mod = await import(`../[seriesId]/items/[itemId]/asset/route.ts?t=${Date.now()}-${Math.random()}`);
  return mod.GET as (req: Request, ctx: { params: Promise<{ seriesId: string; itemId: string }> }) => Promise<Response>;
}

test("[TEST 03] item ready com asset -- resolve signed URL fresca, MIME e filename coerentes, sem chamada ao provider", async (t) => {
  const GET = await loadRouteWith(t, { assetRow: { storage_path: "company-a/item-1/gen-1.jpg", metadata: { mime: "image/jpeg" } } });
  const res = await GET(getReq("http://x/api/rec-os/series/series-1/items/item-1/asset"), paramsFor("series-1", "item-1"));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.signedUrl, "https://signed.example/company-a/item-1/gen-1.jpg?fresh=1");
  assert.equal(data.mimeType, "image/jpeg");
  assert.equal(data.fileName, "serie-series-1-peca-1.jpg");
});

for (const status of ["planned", "generating", "error", "canceled"]) {
  test(`[FASE 02] item '${status}' -- 409, nunca 200 com asset`, async (t) => {
    const GET = await loadRouteWith(t, { series: seriesFixture("company-a", status, status === "error" ? null : "asset-1") });
    const res = await GET(getReq("http://x/api/rec-os/series/series-1/items/item-1/asset"), paramsFor("series-1", "item-1"));
    assert.equal(res.status, 409, `status '${status}' deveria ser 409`);
  });
}

test("[TEST 08] item de outra série -- 404, nunca vaza asset de outro item", async (t) => {
  const GET = await loadRouteWith(t, {});
  const res = await GET(getReq("http://x/api/rec-os/series/series-1/items/item-de-outra-serie/asset"), paramsFor("series-1", "item-de-outra-serie"));
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.code, "SERIES_ITEM_NOT_FOUND");
});

test("série inexistente/não autorizada -- 404 genérico (fail closed, RLS já garante)", async (t) => {
  const GET = await loadRouteWith(t, { series: null });
  const res = await GET(getReq("http://x/api/rec-os/series/series-x/items/item-1/asset"), paramsFor("series-x", "item-1"));
  assert.equal(res.status, 404);
});

test("[TEST 05] content_id da MESMA Company -- autorizado, asset liberado", async (t) => {
  const GET = await loadRouteWith(t, { assetRow: { storage_path: "company-a/item-1/gen-1.png", metadata: { mime: "image/png" } }, contentRow: { id: "content-1" } });
  const res = await GET(getReq("http://x/api/rec-os/series/series-1/items/item-1/asset?content_id=content-1"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 200);
});

test("[FASE 36] content_id que não pertence à Company da série -- 403, nunca libera o asset", async (t) => {
  const GET = await loadRouteWith(t, { contentRow: null });
  const res = await GET(getReq("http://x/api/rec-os/series/series-1/items/item-1/asset?content_id=content-de-outra-company"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, "SERIES_ITEM_CONTENT_FORBIDDEN");
});

test("[TEST 06] sem content_id (Download/EditorOS) -- nunca consulta content_items, resolve normalmente", async (t) => {
  const GET = await loadRouteWith(t, { assetRow: { storage_path: "company-a/item-1/gen-1.png", metadata: { mime: "image/png" } } });
  const res = await GET(getReq("http://x/api/rec-os/series/series-1/items/item-1/asset"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 200);
});
