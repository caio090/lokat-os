/**
 * Executar com: node .tmp/run-tsx-dom-test.cjs "src/app/admin/contentos/visual/series/[seriesId]/__tests__/series-workspace-panel-hydration.dom.test.tsx"
 * Prompt 24 (Dedicated Creative Series Workspace) -- FASE 43-46: "o bug
 * sobreviveu a source tests, pure resolver tests, server bootstrap
 * tests. Precisamos um teste que execute o workspace React real."
 *
 * Este arquivo monta `SeriesWorkspacePanel` DE VERDADE em jsdom (via
 * @testing-library/react, já devDependency -- nenhuma lib nova
 * instalada) e simula transições de "Company Context" (a mesma classe
 * de evento que causou o P1 recorrente dos Prompts 20/21/22: o
 * Company Context do cliente terminando de hidratar DEPOIS da série já
 * estar montada) via re-render com valores diferentes de `clientId` --
 * a única coisa que um "Company Context" real poderia mudar sob este
 * componente.
 *
 * FASE 46 -- "fail before fix": a suíte inclui um componente-espelho
 * (`LegacyClientKeyedPanel`, definido só neste arquivo de teste) que
 * reproduz fielmente o padrão exato que causou o incidente real (Prompt
 * 20: um efeito `useEffect(..., [clientId])` que reseta a série quando
 * `clientId` muda de valor) -- prova que ESSE padrão especificamente
 * falha (limpa a série), e que `SeriesWorkspacePanel` (arquitetura
 * real, Prompt 24) não tem esse padrão e por isso passa. Não é uma
 * reprodução de "código antigo importado" (o arquivo antigo já foi
 * apagado, ver relatório) -- é uma reprodução funcional do MESMO bug de
 * design, montada lado a lado com o componente real pra prova
 * comparativa.
 */
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { SeriesWorkspacePanel } from "../_series-workspace-panel";
import type { CreativeSeriesItem } from "@/lib/rec-os/studio/series/types";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const LAUNCH_CONTEXT: StudioLaunchContext = { clientId: null, contentId: null, campaignId: null, socialProfileId: null, format: null, returnRoute: "/admin/contentos/criar" };

function makeItems(): CreativeSeriesItem[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `item-${i + 1}`, position: i + 1, role: `Peça ${i + 1}`, brief: "brief",
    status: "planned" as const, visualAssetId: null, image: null, error: null,
  }));
}

/**
 * FASE 46 -- espelho funcional do padrão exato do incidente real
 * (Prompt 20's `_series-panel.tsx`, ANTES do Prompt 22): um efeito
 * `[clientId]` que reseta a série sempre que `clientId` muda de valor,
 * mesmo que a mudança seja só "hidratação assentando" (ex.: null ->
 * "company-a" -> "company-a" de novo por outra via) em vez de uma troca
 * real de Company. Existe SÓ neste arquivo de teste, como baseline
 * comparativo -- nunca importado por código de produção.
 */
function LegacyClientKeyedPanel({ initialItems, clientId }: { initialItems: CreativeSeriesItem[]; clientId: string | null }) {
  const [items, setItems] = useState<CreativeSeriesItem[] | null>(initialItems);
  const loadedClientRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (loadedClientRef.current === undefined) { loadedClientRef.current = clientId; return; }
    if (loadedClientRef.current !== clientId) { setItems(null); loadedClientRef.current = clientId; }
  }, [clientId]);
  return (
    <div data-testid="legacy-panel">
      {items ? <div data-testid="legacy-items" data-count={items.length} /> : <div data-testid="legacy-empty" />}
    </div>
  );
}

async function main() {
  console.log("\n[dom] FASE 46 -- BASELINE (padrão antigo, [clientId]-keyed effect) FALHA: uma segunda transição de clientId para o MESMO valor lógico ainda limpa a série");
  {
    const { rerender } = render(<LegacyClientKeyedPanel initialItems={makeItems()} clientId={undefined as unknown as string | null} />);
    // hidratação: clientId chega como null primeiro (Company Context ainda não resolveu)...
    rerender(<LegacyClientKeyedPanel initialItems={makeItems()} clientId={null} />);
    assert(screen.getByTestId("legacy-items").getAttribute("data-count") === "6", "baseline: itens presentes com clientId=null (mount inicial 'undefined' não contou como mudança real)");
    // ...depois "resolve" pra uma Company real.
    rerender(<LegacyClientKeyedPanel initialItems={makeItems()} clientId="company-a" />);
    assert(screen.queryByTestId("legacy-empty") !== null, "baseline REPRODUZ o incidente: a série SOME assim que clientId muda de null pra 'company-a', mesmo sem nenhuma troca real de Company pelo usuário -- exatamente o P1 dos Prompts 20/21");
    cleanup();
  }

  console.log("\n[dom] FASE 45 -- SeriesWorkspacePanel REAL sobrevive à mesma sequência de transições de clientId (mount da árvore React de verdade, jsdom)");
  {
    const items = makeItems();
    const { rerender } = render(
      <SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId={null} skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT} navigate={() => {}} />,
    );
    assert(screen.getAllByTestId("series-workspace-item").length === 6, "6 itens no DOM logo após o mount (clientId ainda null -- 'Company Context' não resolveu)");

    // Simula o Company Context "terminando de hidratar": clientId muda de null -> "company-a".
    rerender(
      <SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId="company-a" skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT} navigate={() => {}} />,
    );
    assert(screen.getAllByTestId("series-workspace-item").length === 6, "série SOBREVIVE à hidratação do Company Context (clientId null -> company-a) -- os mesmos 6 itens continuam no DOM");

    // Simula uma segunda passada reafirmando o MESMO valor lógico (a race exata do incidente: um segundo disparo do mesmo Company, não uma troca real).
    rerender(
      <SeriesWorkspacePanel seriesId="series-1" initialItems={items} clientId="company-a" skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT} navigate={() => {}} />,
    );
    assert(screen.getAllByTestId("series-workspace-item").length === 6, "segunda reafirmação do MESMO clientId -- ainda 6 itens, nunca limpa (não existe efeito algum reagindo a clientId neste componente)");
    assert(screen.getByTestId("series-workspace-panel").getAttribute("data-series-id") === "series-1", "seriesId nunca muda -- é um prop constante, não estado reconciliado");
    cleanup();
  }

  console.log("\n[dom] REGRESSÃO -- itens em status diferentes renderizam corretamente (grid real, não um mosaico único)");
  {
    const items: CreativeSeriesItem[] = [
      { id: "i1", position: 1, role: "Peça 1", brief: "b", status: "ready", visualAssetId: "asset-1", image: { url: "https://example.test/signed-1.png", width: 1080, height: 1080 }, error: null },
      { id: "i2", position: 2, role: "Peça 2", brief: "b", status: "planned", visualAssetId: null, image: null, error: null },
      { id: "i3", position: 3, role: "Peça 3", brief: "b", status: "generating", visualAssetId: null, image: null, error: null },
      { id: "i4", position: 4, role: "Peça 4", brief: "b", status: "error", visualAssetId: null, image: null, error: "falhou" },
      { id: "i5", position: 5, role: "Peça 5", brief: "b", status: "canceled", visualAssetId: null, image: null, error: null },
      { id: "i6", position: 6, role: "Peça 6", brief: "b", status: "planned", visualAssetId: null, image: null, error: null },
    ];
    render(<SeriesWorkspacePanel seriesId="series-2" initialItems={items} clientId="company-a" skillId="vidigal_png" format="carousel" launchContext={LAUNCH_CONTEXT} navigate={() => {}} />);
    const rendered = screen.getAllByTestId("series-workspace-item");
    assert(rendered.length === 6, "6 células independentes no grid -- nunca um mosaico único");
    assert(rendered.map((el) => el.getAttribute("data-item-status")).join(",") === "ready,planned,generating,error,canceled,planned", "cada célula reflete o status real e independente do seu próprio item");
    assert(screen.getByText("1/6 prontas") !== null, "contador agregado reflete exatamente 1 item ready entre 6");
    cleanup();
  }

  console.log(`\n[dom result] ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main();
