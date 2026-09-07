/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os/studio/series/__tests__/item-transport-id.structural.test.ts
 * Prompt 26 (Dedicated Series Workspace Completion).
 */
import { seriesItemTransportContentId } from "../item-transport-id";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

async function main() {
  console.log("[test] determinístico e único por (seriesId, itemId)");
  const a = seriesItemTransportContentId("series-1", "item-1");
  const b = seriesItemTransportContentId("series-1", "item-1");
  const c = seriesItemTransportContentId("series-1", "item-2");
  const d = seriesItemTransportContentId("series-2", "item-1");
  assert(a === b, "mesma entrada -> mesma saída (determinístico)");
  assert(a !== c, "itens diferentes da mesma série nunca colidem");
  assert(a !== d, "mesmo itemId em séries diferentes nunca colide");
  assert(a.includes("series-1") && a.includes("item-1"), "carrega os dois ids de forma legível/depurável");

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
