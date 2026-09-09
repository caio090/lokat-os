/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os/studio/series/__tests__/asset-resolution.structural.test.ts
 * Prompt 26/28 (Dedicated Series Workspace Completion / Content
 * Handoff Authorization) -- [TEST 03] download/EditorOS resolvem o
 * ativo canônico; [TEST 08] asset spoof. Autorização de conteúdo
 * ("Usar no conteúdo") migrou pra content-handoff.ts (Prompt 28,
 * PARTE B -- separação de responsabilidades: este módulo nunca mais
 * conhece `contentId`).
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
        { fetchSeriesById: async () => fakeSeries("company-a", [readyItem({ status, visualAssetId: status === "error" ? null : "asset-1" })]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
        { seriesId: "series-1", itemId: "item-1" },
      );
      assert(!result.ok && result.status === 409, `status '${status}' -- 409 SERIES_ITEM_NOT_READY, nunca libera o asset`);
    }
  }

  console.log("[test] [TEST 08] asset spoof -- itemId de outra série/inexistente nunca resolve (nunca aceita assetId vindo do cliente, só seriesId+itemId)");
  {
    const result = await resolveSeriesItemAsset(
      { fetchSeriesById: async () => fakeSeries("company-a", [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-1", itemId: "item-de-outra-serie" },
    );
    assert(!result.ok && result.status === 404 && result.code === "SERIES_ITEM_NOT_FOUND", "itemId que não pertence a esta série -- 404, nunca vaza asset de outro item");
  }

  console.log("[test] série inexistente/não autorizada -- 404, mesmo resultado do item inexistente (fail closed)");
  {
    const result = await resolveSeriesItemAsset(
      { fetchSeriesById: async () => null, fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => "https://x" },
      { seriesId: "series-inexistente", itemId: "item-1" },
    );
    assert(!result.ok && result.status === 404 && result.code === "SERIES_NOT_FOUND", "série não encontrada/não autorizada -- 404");
  }

  console.log("[test] [PROMPT 28] este módulo nunca mais conhece content_id -- autorização de conteúdo mora em content-handoff.ts");
  {
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../asset-resolution.ts", import.meta.url), "utf8");
    assert(!/checkContentAccessible/.test(source), "checkContentAccessible removido -- a query ad hoc em content_items (RLS incompatível) nunca mais existe aqui");
    assert(!/from\("content_items"\)/.test(source), "nenhuma query em content_items neste módulo (menções em comentário/histórico são só documentação)");
  }

  console.log("[test] falha ao gerar signed URL -- 502, nunca devolve um resultado ok com URL vazia");
  {
    const result = await resolveSeriesItemAsset(
      { fetchSeriesById: async () => fakeSeries("company-a", [readyItem()]), fetchAssetRow: async () => ({ storagePath: "x", mime: "image/png" }), resolveSignedUrl: async () => null },
      { seriesId: "series-1", itemId: "item-1" },
    );
    assert(!result.ok && result.status === 502 && result.code === "SERIES_ITEM_ASSET_SIGN_FAILED", "falha de assinatura -- 502 explícito, nunca um ok:true quebrado");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
