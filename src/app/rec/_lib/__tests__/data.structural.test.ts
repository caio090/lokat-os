/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/app/rec/_lib/__tests__/data.structural.test.ts
 * HOTFIX — guarda de regressão: STATIC_VIDEOS só pode referenciar
 * arquivos CONFIRMADOS existentes no bucket rec-videos (auditoria via
 * storage.objects em 2026-10-07). Os 6 nomes abaixo já foram removidos
 * do bucket mas continuavam hardcoded no código, gerando requests
 * mortos em toda carga pública de /rec -- este teste impede que
 * qualquer um deles volte a aparecer sem uma nova auditoria.
 */
export {}; // força escopo de módulo -- evita colisão de `passed`/`failed`/`assert` com outros scripts de teste globais.

// recUrl() lê NEXT_PUBLIC_SUPABASE_URL no load do módulo -- precisa estar
// setado ANTES do import (o runner de teste não carrega .env.local).
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ziursnveqpvqkqmaacpl.supabase.co";
const { STATIC_VIDEOS, STATIC_FEEDBACK, GOSTA_SUCO_STORAGE_PATH, HERO_DIA_DO_SOLTEIRO, recUrl } = await import("../data");

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

// Confirmado via `select name from storage.objects where bucket_id='rec-videos'` em 2026-10-07.
const REAL_FILES_IN_BUCKET = new Set([
  "duhlache-DIA -DO-SOLTEIRO.mp4",
  "duhlanche-GOSTA-SUCO.mp4",
  "feedbackduh.mp4",
]);
const KNOWN_DEAD_FILES = ["duhlanche1.mp4", "duhlache2.mp4", "duhlanche3.mp4", "duhlanche4.mp4", "dulanche5.mp4", "VT HP II 30 SEG V2.mp4"];

async function main() {
  console.log("[test] STATIC_VIDEOS -- todo storage_path aponta pra um arquivo que realmente existe no bucket");
  {
    const allReal = STATIC_VIDEOS.every((v) => v.storage_path !== null && REAL_FILES_IN_BUCKET.has(v.storage_path));
    assert(allReal, "nenhum item de STATIC_VIDEOS referencia um arquivo fora da lista confirmada no bucket");
  }

  console.log("[test] nenhuma referência morta conhecida (duhlanche1-4/dulanche5/VT HP) em STATIC_VIDEOS/STATIC_FEEDBACK/GOSTA_SUCO/HERO");
  {
    const allPaths = [
      ...STATIC_VIDEOS.map((v) => v.storage_path),
      STATIC_FEEDBACK.storage_path,
      GOSTA_SUCO_STORAGE_PATH,
      HERO_DIA_DO_SOLTEIRO.storage_path,
    ];
    for (const dead of KNOWN_DEAD_FILES) {
      assert(!allPaths.includes(dead), `"${dead}" não aparece em nenhuma constante pública do catálogo REC`);
    }
  }

  console.log("[test] recUrl -- monta URL pública válida com encoding (espaço vira %20, nunca %2520)");
  {
    const url = recUrl("duhlache-DIA -DO-SOLTEIRO.mp4");
    assert(url.includes("/storage/v1/object/public/rec-videos/"), "URL aponta pro endpoint público correto do bucket");
    assert(!url.includes("%2520"), "nunca double-encode (bug já documentado no código)");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
