/**
 * Executar com: node .tmp/run-tsx-dom-test.cjs "src/app/admin/contentos/visual/series/[seriesId]/__tests__/series-workspace-panel-actions.dom.test.tsx"
 * Prompt 26 (Dedicated Series Workspace Completion) -- monta o
 * componente REAL em jsdom (mesma técnica do Prompt 24). [TEST 01]
 * ready+asset mostra o menu de ações; [TEST 02] planned/generating/
 * error/canceled nunca mostram; [TEST 12] a ação atua sobre o item
 * SELECIONADO/clicado (item-2), nunca um item 01 fixo.
 */
import * as React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SeriesWorkspacePanel } from "../_series-workspace-panel";
import type { CreativeSeriesItem } from "@/lib/rec-os/studio/series/types";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const LAUNCH_CONTEXT_STANDALONE: StudioLaunchContext = { clientId: null, contentId: null, campaignId: null, socialProfileId: null, format: null, returnRoute: "/admin/contentos/criar" };
const LAUNCH_CONTEXT_FROM_CREATE: StudioLaunchContext = { clientId: "company-a", contentId: "content-1", campaignId: null, socialProfileId: null, format: null, returnRoute: "/admin/contentos/criar?client=company-a&content_id=content-1" };

function item(overrides: Partial<CreativeSeriesItem>): CreativeSeriesItem {
  return { id: "item-1", position: 1, role: "Peça 1", brief: "b", status: "planned", visualAssetId: null, image: null, error: null, ...overrides };
}

async function main() {
  console.log("\n[dom] [TEST 01/02] menu de ações só existe pra item ready COM visual_asset_id -- nunca planned/generating/error/canceled");
  {
    const items: CreativeSeriesItem[] = [
      item({ id: "i-planned", position: 1, status: "planned" }),
      item({ id: "i-generating", position: 2, status: "generating" }),
      item({ id: "i-error", position: 3, status: "error", error: "falhou" }),
      item({ id: "i-canceled", position: 4, status: "canceled" }),
      item({ id: "i-ready-no-asset", position: 5, status: "ready", visualAssetId: null, image: { url: "https://x/1", width: 1080, height: 1080 } }),
      item({ id: "i-ready", position: 6, status: "ready", visualAssetId: "asset-1", image: { url: "https://x/2", width: 1080, height: 1080 } }),
    ];
    render(<SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId="company-a" skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT_FROM_CREATE} navigate={() => {}} />);
    const toggles = screen.getAllByTestId("series-workspace-item-actions-toggle");
    assert(toggles.length === 1, "exatamente UM item mostra o menu de ações -- só o ready com visual_asset_id (5 outros nunca mostram)");
    cleanup();
  }

  console.log("\n[dom] [TEST 01] menu revela Ver peça/Baixar/EditorOS/Usar no conteúdo quando há Company + contentId real");
  {
    const items: CreativeSeriesItem[] = [item({ id: "item-1", status: "ready", visualAssetId: "asset-1", image: { url: "https://x/1", width: 1080, height: 1080 } })];
    render(<SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId="company-a" skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT_FROM_CREATE} navigate={() => {}} />);
    fireEvent.click(screen.getByTestId("series-workspace-item-actions-toggle"));
    const menu = screen.getByTestId("series-workspace-item-actions-menu");
    assert(menu.textContent!.includes("Ver peça"), "Ver peça sempre presente pra item ready");
    assert(menu.textContent!.includes("Baixar"), "Baixar sempre presente pra item ready");
    assert(menu.textContent!.includes("Abrir no EditorOS"), "EditorOS presente (Company-scoped)");
    assert(menu.textContent!.includes("Usar no conteúdo"), "Usar no conteúdo presente (contentId real via Criar)");
    cleanup();
  }

  console.log("\n[dom] [FASE 15-18] série standalone (sem contentId real) -- 'Usar no conteúdo' NUNCA aparece, mesmo pra item ready");
  {
    const items: CreativeSeriesItem[] = [item({ id: "item-1", status: "ready", visualAssetId: "asset-1", image: { url: "https://x/1", width: 1080, height: 1080 } })];
    render(<SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId="company-a" skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT_STANDALONE} navigate={() => {}} />);
    fireEvent.click(screen.getByTestId("series-workspace-item-actions-toggle"));
    const menu = screen.getByTestId("series-workspace-item-actions-menu");
    assert(!menu.textContent!.includes("Usar no conteúdo"), "standalone -- 'Usar no conteúdo' não aparece sem destino real");
    assert(menu.textContent!.includes("Abrir no EditorOS"), "EditorOS continua disponível standalone (ação mínima, Company presente)");
    cleanup();
  }

  console.log("\n[dom] [FASE 26] Free Mode (sem Company) -- 'Abrir no EditorOS' NUNCA aparece (EditorOS sempre exige uma Company)");
  {
    const items: CreativeSeriesItem[] = [item({ id: "item-1", status: "ready", visualAssetId: "asset-1", image: { url: "https://x/1", width: 1080, height: 1080 } })];
    render(<SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId={null} skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT_STANDALONE} navigate={() => {}} />);
    fireEvent.click(screen.getByTestId("series-workspace-item-actions-toggle"));
    const menu = screen.getByTestId("series-workspace-item-actions-menu");
    assert(!menu.textContent!.includes("Abrir no EditorOS"), "Free Mode -- EditorOS nunca oferecido (arquitetura do EditorOS exige Company)");
    assert(menu.textContent!.includes("Baixar"), "Baixar continua disponível em Free Mode");
    cleanup();
  }

  console.log("\n[dom] [TEST 12] ação sobre item SELECIONADO (item-2), nunca item 01 fixo/hardcoded");
  {
    const requestedUrls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      requestedUrls.push(url);
      return new Response(JSON.stringify({ ok: false, error: "stub" }), { status: 404 });
    }) as typeof fetch;

    try {
      const items: CreativeSeriesItem[] = [
        item({ id: "item-1", position: 1, status: "ready", visualAssetId: "asset-1", image: { url: "https://x/1", width: 1080, height: 1080 } }),
        item({ id: "item-2", position: 2, status: "ready", visualAssetId: "asset-2", image: { url: "https://x/2", width: 1080, height: 1080 } }),
      ];
      render(<SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId="company-a" skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT_FROM_CREATE} navigate={() => {}} />);
      const toggles = screen.getAllByTestId("series-workspace-item-actions-toggle");
      assert(toggles.length === 2, "os dois itens ready mostram o menu, cada um o seu próprio");
      // Clica no menu do SEGUNDO item e em "Baixar" -- nunca deve tocar o endpoint do item-1.
      fireEvent.click(toggles[1]);
      const menu = screen.getByTestId("series-workspace-item-actions-menu");
      const downloadButton = Array.from(menu.querySelectorAll("button")).find((b) => b.textContent?.includes("Baixar"))!;
      await Promise.resolve(fireEvent.click(downloadButton));
      await new Promise((r) => setTimeout(r, 0));
      assert(requestedUrls.length === 1, "exatamente uma chamada de resolução de ativo disparada");
      assert(requestedUrls[0].includes("/items/item-2/asset"), "a chamada é para item-2 (o clicado), nunca item-1 hardcoded");
      cleanup();
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log("\n[dom] [PROMPT 28 -- TEST 01/08] clicar 'Usar no conteúdo' chama a rota DEDICADA de content-handoff com o content_id real -- nunca o endpoint genérico de asset");
  {
    const requestedUrls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      requestedUrls.push(url);
      return new Response(JSON.stringify({ ok: true, signedUrl: "https://signed.example/x.jpg", mimeType: "image/jpeg", fileName: "x.jpg", width: 1080, height: 1080, contentId: "content-1" }), { status: 200 });
    }) as typeof fetch;
    const navigated: string[] = [];

    try {
      const items: CreativeSeriesItem[] = [item({ id: "item-1", status: "ready", visualAssetId: "asset-1", image: { url: "https://x/1", width: 1080, height: 1080 } })];
      render(<SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId="company-a" skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT_FROM_CREATE} navigate={(path) => navigated.push(path)} />);
      fireEvent.click(screen.getByTestId("series-workspace-item-actions-toggle"));
      const menu = screen.getByTestId("series-workspace-item-actions-menu");
      const useInContentButton = Array.from(menu.querySelectorAll("button")).find((b) => b.textContent?.includes("Usar no conteúdo"))!;
      await Promise.resolve(fireEvent.click(useInContentButton));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      assert(requestedUrls.some((u) => u.includes("/items/item-1/content-handoff?content_id=content-1")), "chama a rota dedicada /content-handoff com o content_id real da sessão -- nunca /asset");
      assert(!requestedUrls.some((u) => /\/items\/item-1\/asset(\?|$)/.test(u)), "NUNCA chama o endpoint genérico de asset pra esta ação");
      cleanup();
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log(`\n[dom result] ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main();
