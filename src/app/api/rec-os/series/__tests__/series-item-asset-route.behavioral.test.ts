/**
 * Executar com: node --experimental-test-module-mocks --import ./.tmp/preload-ts-loader.mjs --test src/app/api/rec-os/series/__tests__/series-item-asset-route.behavioral.test.ts
 * Prompt 26/28 (Dedicated Series Workspace Completion / Content
 * Handoff Authorization) — GET real de
 * src/app/api/rec-os/series/[seriesId]/items/[itemId]/asset/route.ts.
 * [TEST 03] download resolve o ativo canônico; [TEST 08] asset spoof.
 * Autorização de conteúdo ("Usar no conteúdo") migrou pra uma rota
 * DEDICADA (content-handoff, ver series-item-content-handoff-route.
 * behavioral.test.ts) -- esta rota nunca mais recebe/conhece
 * `content_id` (Prompt 28, PARTE B: esse acoplamento era exatamente o
 * bug).
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

/** Fake mínimo do client Supabase da sessão: só o `.from()` que a rota real usa (client_visual_assets -- nunca content_items, essa rota não conhece mais content_id). */
function fakeDb(opts: { assetRow?: { storage_path: string; metadata: unknown } | null }) {
  return {
    from(table: string) {
      if (table === "client_visual_assets") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.assetRow ?? null, error: null }) }) }) };
      }
      throw new Error(`tabela inesperada neste fake: ${table}`);
    },
    storage: {
      from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}?fresh=1` }, error: null }) }),
    },
  };
}

async function loadRouteWith(t: TestContext, opts: { series?: unknown; assetRow?: { storage_path: string; metadata: unknown } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t.mock.module as any)("@/lib/supabase/server", {
    exports: { createServerSupabaseClient: async () => fakeDb({ assetRow: opts.assetRow }) },
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

test("[TEST 26/27] content_id na query string é ignorado -- resolve normalmente, nunca 403 (regressão: essa rota não autoriza mais conteúdo nenhum)", async (t) => {
  const GET = await loadRouteWith(t, { assetRow: { storage_path: "company-a/item-1/gen-1.png", metadata: { mime: "image/png" } } });
  const res = await GET(getReq("http://x/api/rec-os/series/series-1/items/item-1/asset?content_id=qualquer-coisa"), paramsFor("series-1", "item-1"));
  assert.equal(res.status, 200, "content_id na query nunca é sequer lido por esta rota -- não pode mais causar 403");
});
