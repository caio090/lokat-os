/**
 * Executar com: node .tmp/run-ts-test.cjs src/app/admin/contentos/visual/series/[seriesId]/__tests__/workspace-bootstrap.behavioral.test.ts
 * Prompt 24 (Dedicated Creative Series Workspace) -- comportamental de
 * verdade (fakes injetados, chama a função real, nunca regex de
 * fonte): [TEST 01] dedicated route load, [TEST 05] unauthorized,
 * [TEST 06] free series, [TEST 14] recent nunca disputa a rota.
 */
import { resolveCreativeSeriesWorkspaceBootstrap } from "../workspace-bootstrap";
import type { CreativeSeriesWithItems } from "@/lib/rec-os/studio/series/repository";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function fakeSeries(overrides: Partial<CreativeSeriesWithItems["series"]> = {}): CreativeSeriesWithItems {
  return {
    series: {
      id: "series-1", clientId: "company-a", contentId: null, campaignId: null, title: null,
      count: 6, placement: null, format: "carousel", creativeDirection: null, status: "draft",
      createdBy: "user-1", createdAt: "x", updatedAt: "x", ...overrides,
    },
    items: [],
  };
}

async function main() {
  console.log("[test] [TEST 01] dedicated route load -- série autorizada carrega, clientId vem da série");
  {
    const result = await resolveCreativeSeriesWorkspaceBootstrap(
      { fetchSeriesById: async (id) => (id === "series-1" ? fakeSeries() : null), checkCompanyAuthorized: async () => true },
      "series-1",
    );
    assert(result.ok === true, "série ABC carregada com sucesso");
    assert(result.ok && result.series.series.id === "series-1", "é exatamente a série pedida pela rota");
    assert(result.ok && result.clientId === "company-a", "clientId vem da série, não de heurística nenhuma");
  }

  console.log("[test] [TEST 05] série inexistente/não autorizada -- ok:false, mesmo resultado observável pros dois casos (fail closed)");
  {
    const notFound = await resolveCreativeSeriesWorkspaceBootstrap(
      { fetchSeriesById: async () => null, checkCompanyAuthorized: async () => true },
      "series-inexistente",
    );
    const forbidden = await resolveCreativeSeriesWorkspaceBootstrap(
      { fetchSeriesById: async () => fakeSeries({ clientId: "company-b" }), checkCompanyAuthorized: async () => false },
      "series-de-outra-company",
    );
    assert(notFound.ok === false, "série inexistente -> ok:false");
    assert(forbidden.ok === false, "série de Company não autorizada -> ok:false");
    assert(JSON.stringify(notFound) === JSON.stringify(forbidden), "os dois casos produzem exatamente o mesmo resultado observável -- nunca revela qual dos dois é");
  }

  console.log("[test] [TEST 06] Free series (client_id null) autorizada por RLS/created_by -- abre, nunca exige Company");
  {
    let companyCheckCalled = false;
    const result = await resolveCreativeSeriesWorkspaceBootstrap(
      { fetchSeriesById: async () => fakeSeries({ clientId: null }), checkCompanyAuthorized: async () => { companyCheckCalled = true; return true; } },
      "series-free",
    );
    assert(result.ok === true, "Free series abre normalmente");
    assert(result.ok && result.clientId === null, "clientId permanece null -- Free Mode, nunca promovido a Company");
    assert(!companyCheckCalled, "checkCompanyAuthorized NUNCA é chamado quando client_id é null -- Company Context não é requisito (FASE 26)");
  }

  console.log("[test] [TEST 14] recent nunca disputa a identidade da rota -- esta função nem aceita/considera 'recente'");
  {
    // A própria assinatura da função prova isso: recebe só `seriesId` (o
    // route param), nunca um filtro de client/content pra buscar "a mais
    // recente". Reforça com um fake que devolveria uma série DIFERENTE
    // ("mais recente" hipotética) se fosse por acaso chamado com outro
    // argumento -- prova que só o id pedido é usado.
    const result = await resolveCreativeSeriesWorkspaceBootstrap(
      { fetchSeriesById: async (id) => (id === "series-A" ? fakeSeries({ id: "series-A" }) : fakeSeries({ id: "series-B-mais-recente-hipotetica" })), checkCompanyAuthorized: async () => true },
      "series-A",
    );
    assert(result.ok === true && result.series.series.id === "series-A", "a rota A é a série resolvida, nunca uma B hipoteticamente mais recente");
  }

  console.log("[test] fetchSeriesById lança -- nunca propaga, degrada pra ok:false (fail closed)");
  {
    const result = await resolveCreativeSeriesWorkspaceBootstrap(
      { fetchSeriesById: async () => { throw new Error("boom"); }, checkCompanyAuthorized: async () => true },
      "series-1",
    );
    assert(result.ok === false, "erro no fetch nunca derruba a página -- vira not found seguro");
  }

  console.log("[test] checkCompanyAuthorized lança -- nunca propaga, degrada pra não-autorizado (fail closed, nunca abre por acidente)");
  {
    const result = await resolveCreativeSeriesWorkspaceBootstrap(
      { fetchSeriesById: async () => fakeSeries(), checkCompanyAuthorized: async () => { throw new Error("boom"); } },
      "series-1",
    );
    assert(result.ok === false, "erro na checagem de Company nunca vira 'autorizado' por acidente -- fail closed");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
