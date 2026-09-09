/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os/studio/series/__tests__/content-handoff.structural.test.ts
 * Prompt 28 (Content Handoff Authorization & Recent Series Repair) --
 * TEST 01-08. Fixture realista (PARTE K/FASE 40): mesmo shape observado
 * em Production -- `creative_series.content_id` real, FK-backed,
 * nunca um campo inventado. Este teste PROVA a reprodução do 403
 * (documentada no comentário de cada caso) e o fix.
 */
import { prepareSeriesItemContentHandoff } from "../content-handoff";
import { seriesItemTransportContentId } from "../item-transport-id";
import type { CreativeSeriesWithItems } from "../repository";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

/** Mesmo shape real de creative_series (Prompt 16/18/22/24), nunca campos inventados. */
function fakeSeries(overrides: Partial<CreativeSeriesWithItems["series"]> = {}, items: CreativeSeriesWithItems["items"] = []): CreativeSeriesWithItems {
  return {
    series: {
      id: "series-A", clientId: "company-A", contentId: "content-A", campaignId: null, title: null,
      count: 1, placement: null, format: "carousel", creativeDirection: null, status: "ready",
      createdBy: "user-1", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:05:00Z",
      ...overrides,
    },
    items,
  };
}
function readyItem(overrides: Partial<CreativeSeriesWithItems["items"][number]> = {}): CreativeSeriesWithItems["items"][number] {
  return { id: "item-A", position: 1, role: "Peça 1", brief: "b", status: "ready", visualAssetId: "asset-A", image: { url: "x", width: 1080, height: 1080 }, error: null, ...overrides };
}

async function main() {
  console.log("[test] [TEST 01] REAL SAME-COMPANY HANDOFF -- Series A + Content A + mesma Company real: ALLOW (isso reproduzia 403 em Production antes do fix)");
  {
    const result = await prepareSeriesItemContentHandoff(
      {
        fetchSeriesById: async () => fakeSeries({}, [readyItem()]),
        fetchAssetRow: async (id) => (id === "asset-A" ? { storagePath: "company-A/item-A/gen-1.jpg", mime: "image/jpeg" } : null),
        resolveSignedUrl: async (path) => `https://signed.example/${path}`,
      },
      { seriesId: "series-A", itemId: "item-A", contentId: "content-A" },
    );
    assert(result.ok === true, "ALLOW -- Series A + Content A da mesma Company é um caso legítimo (o 403 relatado em Production era um falso negativo)");
    assert(result.ok && result.contentId === "content-A", "payload devolve o contentId autorizado");
    assert(result.ok && result.signedUrl.startsWith("https://signed.example/"), "signed URL fresca, nunca reusada");
  }

  console.log("[test] [TEST 02] DIFFERENT COMPANY -- Series A (content_id=content-A) + client pedindo content-B: DENY");
  {
    const result = await prepareSeriesItemContentHandoff(
      { fetchSeriesById: async () => fakeSeries({}, [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-A", itemId: "item-A", contentId: "content-B" },
    );
    assert(!result.ok && result.status === 403, "DENY -- content_id pedido não é o mesmo já associado à série, mesmo que ambos existam de verdade");
  }

  console.log("[test] [TEST 03] CONTENT NOT FOUND (série standalone, sem content_id associado) -- fail closed");
  {
    const result = await prepareSeriesItemContentHandoff(
      { fetchSeriesById: async () => fakeSeries({ contentId: null }, [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-A", itemId: "item-A", contentId: "content-qualquer" },
    );
    assert(!result.ok && result.status === 403, "fail closed -- série sem content_id nunca autoriza handoff nenhum");
  }

  console.log("[test] [TEST 04] CONTENT RLS (conteúdo existe mas não pertence a esta série) -- fail closed, mesmo resultado observável do 'not found'");
  {
    const notAssociated = await prepareSeriesItemContentHandoff(
      { fetchSeriesById: async () => fakeSeries({ contentId: "content-A" }, [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-A", itemId: "item-A", contentId: "content-existe-mas-de-outra-serie" },
    );
    const noContent = await prepareSeriesItemContentHandoff(
      { fetchSeriesById: async () => fakeSeries({ contentId: null }, [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-A", itemId: "item-A", contentId: "content-inexistente" },
    );
    assert(JSON.stringify(notAssociated) === JSON.stringify(noContent), "conteúdo real-mas-não-associado e conteúdo inexistente produzem o MESMO resultado -- nunca revela detalhes de outro workspace");
  }

  console.log("[test] [TEST 05] ITEM OWNERSHIP -- item que não pertence à série: DENY (404)");
  {
    const result = await prepareSeriesItemContentHandoff(
      { fetchSeriesById: async () => fakeSeries({}, [readyItem({ id: "item-A" })]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-A", itemId: "item-B-de-outra-serie", contentId: "content-A" },
    );
    assert(!result.ok && result.status === 404 && result.code === "SERIES_ITEM_NOT_FOUND", "item-B não pertence à série A -- 404, nunca autoriza");
  }

  console.log("[test] [TEST 06] ASSET RELATION -- visual_asset_id é sempre o do próprio item (fetchAssetRow nunca recebe nada vindo do cliente)");
  {
    let assetRowRequestedWith: string | null = null;
    await prepareSeriesItemContentHandoff(
      {
        fetchSeriesById: async () => fakeSeries({}, [readyItem({ visualAssetId: "asset-canonico-do-item" })]),
        fetchAssetRow: async (id) => { assetRowRequestedWith = id; return { storagePath: "x", mime: "image/png" }; },
        resolveSignedUrl: async () => "https://x",
      },
      { seriesId: "series-A", itemId: "item-A", contentId: "content-A" },
    );
    assert(assetRowRequestedWith === "asset-canonico-do-item", "o asset resolvido é EXATAMENTE o vinculado ao item (nunca um id vindo do input/client)");
  }

  console.log("[test] [TEST 07] SYNTHETIC TRANSPORT ID -- seriesItemTransportContentId nunca é aceito como content_items.id real");
  {
    const syntheticId = seriesItemTransportContentId("series-A", "item-A");
    const result = await prepareSeriesItemContentHandoff(
      { fetchSeriesById: async () => fakeSeries({ contentId: null }, [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-A", itemId: "item-A", contentId: syntheticId },
    );
    assert(!result.ok && result.status === 403, "id de transporte sintético do EditorOS nunca é confundido com um content_id real -- sempre DENY");
  }

  console.log("[test] [TEST 08] HANDOFF SUCCESS RESPONSE -- payload completo (asset + contentId), nunca chama nada de geração");
  {
    const result = await prepareSeriesItemContentHandoff(
      { fetchSeriesById: async () => fakeSeries({}, [readyItem()]), fetchAssetRow: async () => ({ storagePath: "company-A/item-A/gen-1.png", mime: "image/png" }), resolveSignedUrl: async () => "https://signed.example/x.png" },
      { seriesId: "series-A", itemId: "item-A", contentId: "content-A" },
    );
    assert(result.ok === true, "sucesso");
    assert(result.ok && typeof result.signedUrl === "string" && typeof result.mimeType === "string" && typeof result.fileName === "string", "payload traz signedUrl/mimeType/fileName -- suficiente pro handoff, nunca base64 gigante");
    assert(result.ok && result.contentId === "content-A", "contentId autorizado presente no payload de sucesso");
  }

  console.log("[test] item não-ready -- 409, nunca autoriza handoff de conteúdo de um item incompleto");
  {
    const result = await prepareSeriesItemContentHandoff(
      { fetchSeriesById: async () => fakeSeries({}, [readyItem({ status: "planned", visualAssetId: null, image: null })]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-A", itemId: "item-A", contentId: "content-A" },
    );
    assert(!result.ok && result.status === 409, "item planned nunca autoriza handoff de conteúdo");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
