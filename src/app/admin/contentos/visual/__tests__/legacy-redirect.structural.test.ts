/**
 * Executar com: node .tmp/run-ts-test.cjs src/app/admin/contentos/visual/__tests__/legacy-redirect.structural.test.ts
 * Prompt 24 (Dedicated Creative Series Workspace) -- [TEST 07] Legacy
 * redirect: `/visual?series_id=ABC` -> `/visual/series/ABC`.
 */
import { resolveLegacySeriesRedirectTarget } from "../legacy-redirect";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const VALID_ID = "3f7b6e2a-1c4d-4e5f-9a8b-7c6d5e4f3a2b";

async function main() {
  console.log("[test] [TEST 07] series_id válido -- redireciona pro workspace canônico");
  {
    const target = resolveLegacySeriesRedirectTarget({ series_id: VALID_ID });
    assert(target === `/admin/contentos/visual/series/${VALID_ID}?return_to=%2Fadmin%2Fcontentos%2Fcriar`, "URL do workspace com o fallback padrão de return_to (nenhum outro contexto informado)");
  }

  console.log("[test] sem series_id -- nunca redireciona");
  {
    assert(resolveLegacySeriesRedirectTarget({}) === null, "ausência de series_id nunca gera redirect");
    assert(resolveLegacySeriesRedirectTarget({ client: "company-a" }) === null, "client sozinho nunca gera redirect");
  }

  console.log("[test] series_id malformado -- nunca gera um redirect quebrado (cai pro comportamento normal da rota genérica)");
  {
    assert(resolveLegacySeriesRedirectTarget({ series_id: "not-a-uuid" }) === null, "texto arbitrário rejeitado por formato");
    assert(resolveLegacySeriesRedirectTarget({ series_id: "" }) === null, "string vazia rejeitada");
    assert(resolveLegacySeriesRedirectTarget({ series_id: "'; DROP TABLE creative_series; --" }) === null, "tentativa de injeção nunca vira redirect (nem chega perto do banco)");
  }

  console.log("[test] [FASE 23] preserva content_id/campaign_id/social_profile_id/source_format/return_to -- nunca client, nunca briefing");
  {
    const target = resolveLegacySeriesRedirectTarget({
      series_id: VALID_ID, client: "company-a", content_id: "content-1", campaign_id: "camp-1",
      social_profile_id: "sp-1", source_format: "arte_estatica", return_to: "/admin/contentos/criar?client=company-a",
    })!;
    assert(target.startsWith(`/admin/contentos/visual/series/${VALID_ID}?`), "base correta");
    assert(!/[?&]client=/.test(target), "NUNCA preserva client -- a Company do workspace vem do servidor (series.client_id)");
    assert(target.includes("content_id=content-1"), "content_id preservado");
    assert(target.includes("campaign_id=camp-1"), "campaign_id preservado");
    assert(target.includes("social_profile_id=sp-1"), "social_profile_id preservado");
    assert(target.includes("source_format=arte_estatica"), "source_format preservado");
    assert(target.includes("return_to="), "return_to preservado (necessário pro handoff de volta ao Criar)");
    assert(!target.includes("briefing") && !target.includes("copy"), "nunca carrega briefing/copy na URL de redirect");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
