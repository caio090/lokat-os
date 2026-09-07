/**
 * Executar com: node .tmp/run-ts-test.cjs src/components/__tests__/company-context-bar.structural.test.ts
 * Prompt 24 (Dedicated Creative Series Workspace) -- [TEST 12] REGRA
 * "Trocar Company = SAIR DA SÉRIE": dentro do workspace canônico de uma
 * série, trocar de Company pela barra global nunca deve preservar o
 * pathname da série (isso deixaria um `?client=` pendurado que a
 * própria série ignora, sem indicar ao usuário que nada mudou) -- deve
 * navegar pra raiz do Studio. Em qualquer outra rota do produto, o
 * comportamento transversal original (preservar pathname) continua
 * intacto.
 */
import fs from "node:fs";
import path from "node:path";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const root = path.resolve(import.meta.dirname, "../../..");
const filePath = path.join(root, "src/components/company-context-bar.tsx");

function extractFunctionBody(source: string, functionSignature: string): string {
  const start = source.indexOf(functionSignature);
  if (start === -1) throw new Error(`função "${functionSignature}" não encontrada em ${filePath}`);
  let parenDepth = 0; let bodyStart = -1; let i = start;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{" && parenDepth === 0) { bodyStart = i; break; }
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
  const body = extractFunctionBody(source, "function handleSelect(selectedId: string)");

  console.log("[test] [TEST 12] handleSelect() dentro do workspace de série navega pra raiz do Studio, nunca preserva o pathname da série");
  assert(/pathname\.startsWith\("\/admin\/contentos\/visual\/series\/"\)/.test(body), "checa explicitamente o prefixo do workspace canônico de série");
  assert(/"\/admin\/contentos\/visual"/.test(body), "destino é a raiz do Studio quando dentro de uma série");
  assert(/withCompanyContext\(target, selectedId\)/.test(body), "usa o helper canônico com o `target` calculado (nunca `pathname` direto quando dentro da série)");

  console.log("[test] [REGRESSÃO] fora do workspace de série, comportamento transversal original é preservado (mesmo pathname)");
  assert(/const target = pathname\.startsWith\("\/admin\/contentos\/visual\/series\/"\) \? "\/admin\/contentos\/visual" : pathname;/.test(body), "fallback explícito pro pathname original em qualquer outra rota -- nenhuma outra página do produto perde o comportamento existente");

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
