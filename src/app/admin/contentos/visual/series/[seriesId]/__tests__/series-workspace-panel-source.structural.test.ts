/**
 * Executar com: node .tmp/run-ts-test.cjs "src/app/admin/contentos/visual/series/[seriesId]/__tests__/series-workspace-panel-source.structural.test.ts"
 * Prompt 24 (Dedicated Creative Series Workspace) — `_series-workspace-
 * panel.tsx` herda TODAS as garantias de queue/regenerate/asset-link já
 * provadas para o antigo `_series-panel.tsx` (Prompts 18/22, domínio
 * "PRESERVAR" da FASE 34) -- estes testes são a continuação direta de
 * series-panel-source.structural.test.ts pra esta nova localização,
 * MAIS as garantias novas de FASE 09/10/27-29 (nenhuma descoberta de
 * identidade dentro do workspace dedicado).
 */
import fs from "node:fs";
import path from "node:path";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const root = path.resolve(import.meta.dirname, "../../../../../../../..");
const filePath = path.join(root, "src/app/admin/contentos/visual/series/[seriesId]/_series-workspace-panel.tsx");

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

  console.log("[test] [FASE 09/10 -- PROMPT 24] nenhuma descoberta de identidade dentro do workspace dedicado");
  {
    assert(!/findRecentCreativeSeries/.test(source), "PROIBIDO usar findRecentCreativeSeries -- a rota já escolheu a série");
    assert(!/useSearchParams\(\)|router\.replace\(/.test(source), "nenhuma leitura/escrita de query param -- a identidade é o próprio route param, nunca a URL");
    assert(!/setSeriesId\(|useState.*seriesId/.test(source), "seriesId é um valor constante recebido por prop, nunca state React");
    assert(!/useEffect/.test(source), "nenhum useEffect de reconciliação -- não existe nada pra reconciliar (a causa raiz do P1 recorrente foi removida da arquitetura, não escondida atrás de mais um efeito)");
  }

  console.log("[test] [FASE 34 -- PRESERVAR] geração continua chamando o MESMO endpoint de sempre, nunca um provider direto");
  {
    assert(/fetch\("\/api\/studio\/images\/generate"/.test(source), "chama /api/studio/images/generate");
    assert((source.match(/fetch\("\/api\/studio\/images\/generate"/g) ?? []).length === 1, "exatamente um ponto de chamada ao endpoint dentro deste arquivo (callImageProvider), nunca duas implementações divergentes");
  }

  console.log("[test] [PRESERVADO DO PROMPT 18] generateOneItemPersisted() sempre termina num status TERMINAL persistido");
  {
    const body = extractFunctionBody(source, "async function generateOneItemPersisted(item: CreativeSeriesItem)");
    assert(/patchItem\(seriesId, working\.id, \{ status: "generating" \}\)/.test(body), "marca 'generating' (persistido) antes de chamar o provider");
    assert(/if \(!providerResult\.ok\) \{[\s\S]*?status: "error"/.test(body), "branch de FALHA sempre persiste 'error'");
    assert(/status: "ready", imageDataUrl: providerResult\.url/.test(body), "branch de SUCESSO sempre persiste 'ready' com o vínculo real de asset");
  }

  console.log("[test] [PRESERVADO DO PROMPT 18] cancelPending() só toca items 'planned', nunca 'generating'");
  {
    const body = extractFunctionBody(source, "function cancelPending()");
    assert(/i\.status === "planned"/.test(body), "filtra explicitamente por status === 'planned'");
  }

  console.log("[test] [PRESERVADO DO PROMPT 18] regenerateReady() nunca faz PATCH de status ANTES do resultado do provider");
  {
    const body = extractFunctionBody(source, "async function regenerateReady(item: CreativeSeriesItem)");
    const providerCallIndex = body.indexOf("callImageProvider(");
    const firstPatchIndex = body.indexOf("patchItem(");
    assert(providerCallIndex !== -1 && firstPatchIndex !== -1 && providerCallIndex < firstPatchIndex, "provider chamado ANTES de qualquer PATCH -- protege a imagem antiga em caso de falha");
  }

  console.log("[test] geração só é alcançável via ações explícitas (handleGenerateOne/handleGenerateAll), nunca automaticamente");
  {
    assert(/function handleGenerateOne/.test(source), "existe uma ação explícita 'Gerar' por item");
    assert(/function handleGenerateAll/.test(source), "existe uma ação explícita 'Gerar todas'");
  }

  console.log("[test] [FASE 37-39] handoff (Usar no conteúdo/Abrir no EditorOS) delega navegação ao pai via prop -- nunca importa next/navigation aqui");
  {
    assert(!/from "next\/navigation"/.test(source), "SeriesWorkspacePanel nunca importa next/navigation -- 100% props-driven (montável em jsdom sem mockar o App Router)");
    assert(/navigate\(launchContext\.returnRoute\)/.test(source), "Usar no conteúdo navega via prop `navigate`, nunca router direto");
    assert(/navigate\(`\/admin\/contentos\/editor-os/.test(source), "Abrir no EditorOS navega via prop `navigate`, nunca router direto");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
