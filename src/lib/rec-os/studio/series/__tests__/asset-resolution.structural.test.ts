/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os/studio/series/__tests__/asset-resolution.structural.test.ts
 * Prompt 26 (Dedicated Series Workspace Completion) -- [TEST 03] download
 * resolve o ativo canônico; [TEST 05/06] content handoff; [TEST 08] asset
 * spoof. Comportamental de verdade (fakes injetados, chama a função real).
 */
import { resolveSeriesItemAsset } from "../asset-resolution";
import type { CreativeSeriesWithItems } from "../repository";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function fakeSeries(clientId: string | null, items: CreativeSeriesWithItems["items"]): CreativeSeriesWithItems {
  return {
    series: { id: "series-1", clientId, contentId: null, campaignId: null, title: null, count: 6, placement: null, format: "carousel", creativeDirection: null, status: "generating", createdBy: "user-1", createdAt: "x", updatedAt: "x" },
    items,
  };
}
function readyItem(overrides: Partial<CreativeSeriesWithItems["items"][number]> = {}): CreativeSeriesWithItems["items"][number] {
  return { id: "item-1", position: 1, role: "Peça 1", brief: "b", status: "ready", visualAssetId: "asset-1", image: { url: "x", width: 1080, height: 1080 }, error: null, ...overrides };
}

async function main() {
  console.log("[test] [TEST 03] item ready com asset -- resolve signed URL nova, MIME e nome de arquivo coerentes");
  {
    const result = await resolveSeriesItemAsset(
      {
        fetchSeriesById: async () => fakeSeries("company-a", [readyItem()]),
        fetchAssetRow: async (id) => (id === "asset-1" ? { storagePath: "company-a/item-1/gen-1.jpg", mime: "image/jpeg" } : null),
        resolveSignedUrl: async (path) => `https://signed.example/${path}?fresh=1`,
        checkContentAccessible: async () => true,
      },
      { seriesId: "series-1", itemId: "item-1" },
    );
    assert(result.ok === true, "resolve com sucesso");
    assert(result.ok && result.signedUrl === "https://signed.example/company-a/item-1/gen-1.jpg?fresh=1", "signed URL vem da chamada FRESCA, nunca de estado antigo");
    assert(result.ok && result.mimeType === "image/jpeg", "MIME real preservado (nunca convertido)");
    assert(result.ok && result.fileName === "serie-series-1-peca-1.jpg", "nome de arquivo humano (série + posição), nunca só UUID");
  }

  console.log("[test] [FASE 02] item não-ready -- 409, nunca expõe asset");
  {
    for (const status of ["planned", "generating", "error", "canceled"] as const) {
      const result = await resolveSeriesItemAsset(
        { fetchSeriesById: async () => fakeSeries("company-a", [readyItem({ status, visualAssetId: status === "error" ? null : "asset-1" })]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x", checkContentAccessible: async () => true },
        { seriesId: "series-1", itemId: "item-1" },
      );
      assert(!result.ok && result.status === 409, `status '${status}' -- 409 SERIES_ITEM_NOT_READY, nunca libera o asset`);
    }
  }

  console.log("[test] [TEST 08] asset spoof -- itemId de outra série/inexistente nunca resolve (nunca aceita assetId vindo do cliente, só seriesId+itemId)");
  {
    const result = await resolveSeriesItemAsset(
      { fetchSeriesById: async () => fakeSeries("company-a", [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x", checkContentAccessible: async () => true },
      { seriesId: "series-1", itemId: "item-de-outra-serie" },
    );
    assert(!result.ok && result.status === 404 && result.code === "SERIES_ITEM_NOT_FOUND", "itemId que não pertence a esta série -- 404, nunca vaza asset de outro item");
  }

  console.log("[test] série inexistente/não autorizada -- 404, mesmo resultado do item inexistente (fail closed)");
  {
    const result = await resolveSeriesItemAsset(
      { fetchSeriesById: async () => null, fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x", checkContentAccessible: async () => true },
      { seriesId: "series-inexistente", itemId: "item-1" },
    );
    assert(!result.ok && result.status === 404 && result.code === "SERIES_NOT_FOUND", "série não encontrada/não autorizada -- 404");
  }

  console.log("[test] [TEST 05] content_id presente e pertencente à mesma Company -- autorizado");
  {
    let checkedWith: { contentId: string; clientId: string | null } | null = null;
    const result = await resolveSeriesItemAsset(
      {
        fetchSeriesById: async () => fakeSeries("company-a", [readyItem()]),
        fetchAssetRow: async () => ({ storagePath: "company-a/item-1/gen-1.png", mime: "image/png" }),
        resolveSignedUrl: async () => "https://signed.example/x",
        checkContentAccessible: async (contentId, clientId) => { checkedWith = { contentId, clientId }; return true; },
      },
      { seriesId: "series-1", itemId: "item-1", contentId: "content-1" },
    );
    assert(result.ok === true, "content_id válido -- asset liberado (handoff pra Usar no conteúdo)");
    assert(checkedWith !== null && (checkedWith as { contentId: string; clientId: string | null }).contentId === "content-1" && (checkedWith as { contentId: string; clientId: string | null }).clientId === "company-a", "checagem de conteúdo recebe o contentId pedido e a Company REAL da série (nunca outra)");
  }

  console.log("[test] [FASE 36] content_id de Company diferente -- 403, nunca libera o asset");
  {
    const result = await resolveSeriesItemAsset(
      { fetchSeriesById: async () => fakeSeries("company-a", [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x", checkContentAccessible: async () => false },
      { seriesId: "series-1", itemId: "item-1", contentId: "content-de-outra-company" },
    );
    assert(!result.ok && result.status === 403 && result.code === "SERIES_ITEM_CONTENT_FORBIDDEN", "content_id não autorizado -- 403, nunca vaza o asset");
  }

  console.log("[test] [TEST 06] sem content_id (Download/EditorOS) -- checkContentAccessible NUNCA é chamado");
  {
    let called = false;
    const result = await resolveSeriesItemAsset(
      { fetchSeriesById: async () => fakeSeries("company-a", [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://signed.example/x", checkContentAccessible: async () => { called = true; return true; } },
      { seriesId: "series-1", itemId: "item-1" },
    );
    assert(result.ok === true, "resolve normalmente sem content_id");
    assert(!called, "checagem de conteúdo nunca chamada quando não há content_id -- Download/EditorOS não dependem de conteúdo");
  }

  console.log("[test] Free Mode (clientId null) -- resolve normalmente, checagem de conteúdo recebe clientId null");
  {
    let receivedClientId: string | null | undefined;
    await resolveSeriesItemAsset(
      { fetchSeriesById: async () => fakeSeries(null, [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://signed.example/x", checkContentAccessible: async (_c, clientId) => { receivedClientId = clientId; return true; } },
      { seriesId: "series-1", itemId: "item-1", contentId: "content-1" },
    );
    assert(receivedClientId === null, "Free Mode -- clientId null repassado corretamente pra checagem de conteúdo");
  }

  console.log("[test] falha ao gerar signed URL -- 502, nunca devolve um resultado ok com URL vazia");
  {
    const result = await resolveSeriesItemAsset(
      { fetchSeriesById: async () => fakeSeries("company-a", [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => null, checkContentAccessible: async () => true },
      { seriesId: "series-1", itemId: "item-1" },
    );
    assert(!result.ok && result.status === 502 && result.code === "SERIES_ITEM_ASSET_SIGN_FAILED", "falha de assinatura -- 502 explícito, nunca um ok:true quebrado");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
