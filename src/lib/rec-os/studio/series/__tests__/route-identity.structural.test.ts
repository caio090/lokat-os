/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os/studio/series/__tests__/route-identity.structural.test.ts
 * Prompt 24 (Dedicated Creative Series Workspace) -- FASE 02.
 */
import { isValidCreativeSeriesRouteId } from "../route-identity";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

async function main() {
  console.log("[test] UUID real -- válido");
  assert(isValidCreativeSeriesRouteId("3f7b6e2a-1c4d-4e5f-9a8b-7c6d5e4f3a2b"), "UUID v4-shaped aceito");
  assert(isValidCreativeSeriesRouteId("00000000-0000-0000-0000-000000000000"), "UUID nil aceito (formato válido, existência é responsabilidade do banco)");
  assert(isValidCreativeSeriesRouteId("3F7B6E2A-1C4D-4E5F-9A8B-7C6D5E4F3A2B"), "case-insensitive");

  console.log("[test] entradas inválidas/adulteradas -- nunca lança, sempre false");
  assert(!isValidCreativeSeriesRouteId(""), "string vazia");
  assert(!isValidCreativeSeriesRouteId("not-a-uuid"), "texto arbitrário");
  assert(!isValidCreativeSeriesRouteId("'; DROP TABLE creative_series; --"), "tentativa de injeção -- rejeitada por formato, nunca chega ao banco");
  assert(!isValidCreativeSeriesRouteId(null), "null");
  assert(!isValidCreativeSeriesRouteId(undefined), "undefined");
  assert(!isValidCreativeSeriesRouteId("3f7b6e2a-1c4d-4e5f-9a8b-7c6d5e4f3a2"), "UUID um caractere curto");
  assert(!isValidCreativeSeriesRouteId("3f7b6e2a-1c4d-4e5f-9a8b-7c6d5e4f3a2bb"), "UUID um caractere longo");

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
