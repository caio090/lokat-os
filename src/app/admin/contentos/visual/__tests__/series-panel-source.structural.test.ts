/**
 * Executar com: node .tmp/run-ts-test.cjs src/app/admin/contentos/visual/__tests__/series-panel-source.structural.test.ts
 * Prompt 24 (Dedicated Creative Series Workspace) — `_series-panel.tsx`
 * (root Studio, "porta de entrada") deixou de administrar qualquer
 * série existente: só cria a ESTRUTURA (zero chamadas ao provider,
 * regra de produto desde o Prompt 18) e navega pro workspace canônico.
 * Toda a gestão de geração/fila/regenerate/asset-link migrou pra
 * `series/[seriesId]/_series-workspace-panel.tsx` (ver
 * series-workspace-panel-source.structural.test.ts).
 */
import fs from "node:fs";
import path from "node:path";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const root = path.resolve(import.meta.dirname, "../../../../../..");
const filePath = path.join(root, "src/app/admin/contentos/visual/_series-panel.tsx");

function extractFunctionBody(source: string, functionSignature: string): string {
  const start = source.indexOf(functionSignature);
  if (start === -1) throw new Error(`função "${functionSignature}" não encontrada em ${filePath}`);
  let parenDepth = 0; let angleDepth = 0; let bodyStart = -1; let i = start;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "<") angleDepth++;
    else if (ch === ">") angleDepth--;
    else if (ch === "{" && parenDepth === 0 && angleDepth <= 0) { bodyStart = i; break; }
  }
  if (bodyStart === -1) throw new Error(`corpo de "${functionSignature}" não encontrado`);
  let depth = 0;
  for (i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) break; }
  }
  return source.slice(bodyStart, i + 1);
}

async function main() {
  const source = fs.readFileSync(filePath, "utf8");

  console.log("[test] [TEST 01/PROMPT 18] createSeries() só cria a estrutura -- NENHUMA chamada de geração dentro do próprio corpo");
  {
    const body = extractFunctionBody(source, "async function createSeries()");
    assert(/fetch\("\/api\/rec-os\/series"/.test(body), "createSeries() chama POST /api/rec-os/series (cria a estrutura)");
    assert(!/generateOneItemPersisted/.test(body), "createSeries() NUNCA chama generateOneItemPersisted");
    assert(!/runSeriesGeneration/.test(body), "createSeries() NUNCA chama runSeriesGeneration");
    assert(!/callImageProvider/.test(body), "createSeries() NUNCA chama o provider de imagem diretamente");
    assert(!/studio\/images\/generate/.test(body), "createSeries() NUNCA chama /api/studio/images/generate");
  }

  console.log("[test] [PROMPT 24 -- FASE 17/18] depois de criar, navega DE VERDADE pro workspace canônico -- nunca tenta hidratar/mostrar items aqui");
  {
    const body = extractFunctionBody(source, "async function createSeries()");
    assert(/router\.push\(buildSeriesWorkspaceUrl\(newSeriesId, launchContext\)\)/.test(body), "navega via router.push pro workspace da série recém-criada");
    assert(!/setItems\(/.test(source), "este arquivo nunca mantém items em state -- não é mais responsabilidade dele");
    assert(!/setSeriesId\(/.test(source), "este arquivo nunca guarda um seriesId 'ativo' -- a rota /series/[seriesId] é que é a identidade agora");
  }

  console.log("[test] [PROMPT 26 -- FASE 27/33] abrir uma série recente sempre navega pro workspace, STANDALONE (nunca reusa o launchContext atual), nunca carrega items localmente");
  {
    const body = extractFunctionBody(source, "function openRecentSeries(seriesId: string)");
    assert(/router\.push\(`\/admin\/contentos\/visual\/series\/\$\{seriesId\}`\)/.test(body), "openRecentSeries() navega direto pro workspace, sem nenhum query param (standalone -- FASE 33)");
    assert(!/launchContext/.test(body), "nunca reusa o launchContext da sessão atual pra abrir uma série recente (FASE 33 -- 'não inventar return_to')");
    assert(!/setItems/.test(source), "este arquivo nunca carrega items localmente");
  }

  console.log("[test] [PROMPT 26 -- FASE 23-28] lista de séries recentes é LEVE (bounded, via endpoint dedicado), nunca hidrata items/imagens");
  {
    assert(/fetch\(`\/api\/rec-os\/series\/recent\?/.test(source), "usa o endpoint dedicado e bounded de séries recentes");
    assert(/params\.set\("limit", String\(RECENT_SERIES_LIMIT\)\)/.test(source), "limite explícito enviado na própria query, nunca busca tudo pra cortar depois");
    assert(!/\.items\.filter/.test(source), "nunca acessa .items de uma série recente -- o resumo já vem com readyCount/totalCount prontos");
  }

  console.log("[test] [PROMPT 24] nenhuma dependência de query-param/URL pra identidade de série -- zero useSearchParams neste arquivo");
  {
    assert(!/useSearchParams/.test(source), "este arquivo nunca lê series_id da URL -- a rota genérica não administra mais série alguma (regra final do Prompt 24)");
    assert(!/series_id/.test(source), "nenhuma menção a series_id -- não é mais um conceito deste componente");
  }

  console.log("[test] [PROMPT 24] nenhum discovery de identidade (recent NUNCA disputa com nada, porque não existe mais 'série ativa' aqui)");
  {
    assert(!/initialSeries/.test(source), "prop initialSeries removida -- este componente nunca recebe uma série já resolvida (não administra série nenhuma além de criar)");
    assert(!/loadedSeriesClientIdRef|lastServerSeriesIdRef/.test(source), "nenhuma ref de reconciliação -- a causa raiz do P1 recorrente (Prompts 20/21/22) não existe mais nesta arquitetura");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
