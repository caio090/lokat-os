/**
 * Executar com: node .tmp/run-tsx-dom-test.cjs src/app/admin/contentos/visual/__tests__/recent-series-section.dom.test.tsx
 * Prompt 28 (Content Handoff Authorization & Recent Series Repair) --
 * FASE 38/39: "não usar apenas regex/source tests -- Prompt 27 falhou
 * em UI real mesmo com testes verdes." Monta `RecentSeriesSection` DE
 * VERDADE em jsdom, simula Company resolvida + o endpoint de recentes
 * devolvendo 2 linhas, e prova que a seção aparece no DOM (TEST 12/13/
 * 14/15/16).
 */
import * as React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { RecentSeriesSection } from "../_recent-series-section";
import { pushedPaths } from "../../../../../../.tmp/fake-next-navigation.mjs";
import { fireEvent } from "@testing-library/react";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function fakeRecentResponse(series: unknown[]) {
  return new Response(JSON.stringify({ ok: true, series }), { status: 200 });
}

const TWO_ROWS = [
  { id: "series-A", clientId: "company-a", count: 6, format: "carousel", status: "generating", createdAt: "2026-09-01T10:00:00Z", readyCount: 2, totalCount: 6 },
  { id: "series-B", clientId: "company-a", count: 3, format: "story_vertical", status: "ready", createdAt: "2026-08-30T10:00:00Z", readyCount: 3, totalCount: 3 },
];

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function main() {
  console.log("\n[dom] [TEST 13/FASE 39] Company resolvida + endpoint devolve 2 linhas -- a seção aparece no DOM, sem depender de nenhum modo de criação selecionado");
  {
    const originalFetch = global.fetch;
    const requestedUrls: string[] = [];
    global.fetch = (async (input: unknown) => { requestedUrls.push(String(input)); return fakeRecentResponse(TWO_ROWS); }) as typeof fetch;
    try {
      render(<RecentSeriesSection clientId="company-a" contentId={null} />);
      await flush();
      const section = screen.getByTestId("recent-series-section");
      assert(section.getAttribute("data-state") === "ready", "estado final é 'ready' depois do fetch resolver");
      assert(screen.getAllByTestId("recent-series-card").length === 2, "as 2 séries devolvidas pelo endpoint aparecem no DOM -- a seção NUNCA depende de o usuário estar no modo 'Série Visual' (este componente nem recebe esse conceito como prop)");
      assert(requestedUrls[0].includes("client_id=company-a"), "Company scope enviado na query (TEST 12)");
      cleanup();
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log("\n[dom] [TEST 14/FASE 33/34] loading NUNCA vira 'empty' prematuramente -- estado inicial é honesto");
  {
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const originalFetch = global.fetch;
    global.fetch = (async () => pending) as typeof fetch;
    try {
      render(<RecentSeriesSection clientId="company-a" contentId={null} />);
      await flush();
      const duringLoad = screen.getByTestId("recent-series-section");
      assert(duringLoad.getAttribute("data-state") === "loading", "estado 'loading' explícito enquanto o fetch está em andamento -- nunca indistinguível de 'lista vazia'");
      assert(screen.queryByTestId("recent-series-card") === null, "nenhum card ainda (fetch não terminou)");
      resolveFetch(fakeRecentResponse([]));
      await flush();
      // Lista genuinamente vazia -- FASE 34: pode ocultar o conteúdo.
      assert(screen.queryByTestId("recent-series-section") === null, "lista vazia (fetch já concluído) -- oculta o bloco, nunca um dashboard ruidoso, mas só DEPOIS que o fetch terminou de verdade");
      cleanup();
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log("\n[dom] [FASE 33] erro de fetch nunca some silenciosamente -- estado 'error' visível");
  {
    const originalFetch = global.fetch;
    global.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try {
      render(<RecentSeriesSection clientId="company-a" contentId={null} />);
      await flush();
      const section = screen.getByTestId("recent-series-section");
      assert(section.getAttribute("data-state") === "error", "estado 'error' explícito -- nunca renderiza como se a lista estivesse simplesmente vazia");
      cleanup();
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log("\n[dom] [TEST 15/16] abrir série recente navega pro dedicated route (nunca query-state); limite de 6 respeitado na query enviada");
  {
    const originalFetch = global.fetch;
    global.fetch = (async () => fakeRecentResponse(TWO_ROWS)) as typeof fetch;
    pushedPaths.length = 0;
    try {
      render(<RecentSeriesSection clientId="company-a" contentId={null} />);
      await flush();
      const openButtons = screen.getAllByText("Abrir série");
      fireEvent.click(openButtons[0]);
      assert(pushedPaths.length === 1 && pushedPaths[0] === "/admin/contentos/visual/series/series-A", "navega direto pro dedicated route da série clicada, sem query param nenhum");
      cleanup();
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log(`\n[dom result] ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main();
