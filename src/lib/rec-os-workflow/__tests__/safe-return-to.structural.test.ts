/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os-workflow/__tests__/safe-return-to.structural.test.ts
 * Prompt 26 (Dedicated Series Workspace Completion) -- [TEST 07] open redirect.
 */
import { sanitizeInternalReturnTo } from "../safe-return-to";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const FALLBACK = "/admin/contentos/criar";

async function main() {
  console.log("[test] rota interna válida -- preservada");
  assert(sanitizeInternalReturnTo("/admin/contentos/criar?client=c1&content_id=k1", FALLBACK) === "/admin/contentos/criar?client=c1&content_id=k1", "query preservada em rota interna válida");

  console.log("[test] [TEST 07] URL externa -- rejeitada, cai pro fallback");
  assert(sanitizeInternalReturnTo("https://evil.example.com", FALLBACK) === FALLBACK, "https:// externo rejeitado");
  assert(sanitizeInternalReturnTo("http://evil.example.com", FALLBACK) === FALLBACK, "http:// externo rejeitado");
  assert(sanitizeInternalReturnTo("//evil.example.com", FALLBACK) === FALLBACK, "protocol-relative // rejeitado");
  assert(sanitizeInternalReturnTo("javascript:alert(1)", FALLBACK) === FALLBACK, "javascript: rejeitado");
  assert(sanitizeInternalReturnTo("data:text/html,<script>alert(1)</script>", FALLBACK) === FALLBACK, "data: rejeitado");

  console.log("[test] rota interna mas fora de /admin/ -- rejeitada");
  assert(sanitizeInternalReturnTo("/login", FALLBACK) === FALLBACK, "/login (fora de /admin/) cai pro fallback");
  assert(sanitizeInternalReturnTo("/", FALLBACK) === FALLBACK, "raiz cai pro fallback");

  console.log("[test] ausente/vazio -- fallback, nunca lança");
  assert(sanitizeInternalReturnTo(null, FALLBACK) === FALLBACK, "null -> fallback");
  assert(sanitizeInternalReturnTo(undefined, FALLBACK) === FALLBACK, "undefined -> fallback");
  assert(sanitizeInternalReturnTo("", FALLBACK) === FALLBACK, "string vazia -> fallback");

  console.log("[test] percent-encoding malformado -- nunca lança, cai pro fallback");
  assert(sanitizeInternalReturnTo("%", FALLBACK) === FALLBACK, "sequência de encoding inválida não lança, cai pro fallback");

  console.log("[test] bypass via encoding não funciona (rejeitado depois do decode)");
  assert(sanitizeInternalReturnTo(encodeURIComponent("https://evil.example.com"), FALLBACK) === FALLBACK, "URL externa encoded ainda é rejeitada depois do decode");

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
