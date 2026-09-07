/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os/studio/__tests__/launch-context.structural.test.ts
 * Prompt 13 (REC OS Core Experience) — build/parse do StudioLaunchContext
 * são puros, sem I/O.
 */
import { buildStudioLaunchUrl, parseStudioLaunchContext, isStudioLaunchedFromCreate, buildSeriesWorkspaceUrl } from "../launch-context";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

async function main() {
  console.log("[test] build -- só IDs na URL, nunca conteúdo do briefing");
  {
    const url = buildStudioLaunchUrl("/admin/contentos/visual", {
      clientId: "client-1", contentId: "content-1", campaignId: "camp-1", socialProfileId: "sp-1",
      format: "arte_estatica", returnRoute: "/admin/contentos/criar?client=client-1&content_id=content-1&step=visual",
    });
    assert(url.startsWith("/admin/contentos/visual?"), "base preservada");
    assert(url.includes("client=client-1"), "client presente");
    assert(url.includes("content_id=content-1"), "content_id presente");
    assert(url.includes("campaign_id=camp-1"), "campaign_id presente");
    assert(url.includes("social_profile_id=sp-1"), "social_profile_id presente");
    assert(url.includes("source_format=arte_estatica"), "format presente");
    assert(url.includes("return_to="), "return_to presente");
    assert(!url.includes("briefing") && !url.includes("copy"), "nunca carrega conteúdo de briefing/copy na URL");
  }

  console.log("[test] build -- campos ausentes nunca viram 'null'/'undefined' literal na URL");
  {
    const url = buildStudioLaunchUrl("/admin/contentos/visual", {
      clientId: null, contentId: null, campaignId: null, socialProfileId: null, format: null,
      returnRoute: "/admin/contentos/criar",
    });
    assert(!url.includes("null") && !url.includes("undefined"), "nenhum valor 'null'/'undefined' literal");
    assert(url.includes("return_to=%2Fadmin%2Fcontentos%2Fcriar"), "return_to sempre presente, mesmo sem outros campos");
  }

  console.log("[test] parse -- nunca lança em entrada adulterada/ausente");
  {
    const parsed = parseStudioLaunchContext({});
    assert(parsed.clientId === null && parsed.contentId === null, "campos ausentes viram null, nunca lançam");
    assert(parsed.returnRoute === "/admin/contentos/criar", "returnRoute tem fallback seguro quando ausente");
  }

  console.log("[test] parse -- round trip com build");
  {
    const original = { clientId: "c1", contentId: "k1", campaignId: null, socialProfileId: null, format: "story", returnRoute: "/admin/contentos/criar?client=c1" };
    const url = buildStudioLaunchUrl("/x", original);
    const qs = new URLSearchParams(url.split("?")[1]);
    const parsed = parseStudioLaunchContext({
      client: qs.get("client") ?? undefined,
      content_id: qs.get("content_id") ?? undefined,
      return_to: qs.get("return_to") ?? undefined,
      source_format: qs.get("source_format") ?? undefined,
    });
    assert(parsed.clientId === "c1", "clientId sobrevive ao round trip");
    assert(parsed.contentId === "k1", "contentId sobrevive ao round trip");
    assert(parsed.format === "story", "format sobrevive ao round trip");
  }

  console.log("[test] isStudioLaunchedFromCreate -- só true quando contentId presente");
  {
    assert(isStudioLaunchedFromCreate({ clientId: "c1", contentId: "k1", campaignId: null, socialProfileId: null, format: null, returnRoute: "/x" }) === true, "com contentId -> true");
    assert(isStudioLaunchedFromCreate({ clientId: "c1", contentId: null, campaignId: null, socialProfileId: null, format: null, returnRoute: "/x" }) === false, "sem contentId -> false (Studio standalone)");
  }

  console.log("[test] Prompt 24 -- buildSeriesWorkspaceUrl nunca inclui client (identidade vem do servidor, não da URL)");
  {
    const url = buildSeriesWorkspaceUrl("series-1", {
      clientId: "company-a", contentId: "content-1", campaignId: "camp-1", socialProfileId: "sp-1",
      format: "arte_estatica", returnRoute: "/admin/contentos/criar?client=company-a&content_id=content-1",
    });
    assert(url.startsWith("/admin/contentos/visual/series/series-1"), "base é o workspace canônico da série");
    assert(!url.includes("client=company-a") && !/[?&]client=/.test(url), "NUNCA inclui client -- a Company vem do servidor (series.client_id), nunca da URL");
    assert(url.includes("content_id=content-1"), "content_id preservado (necessário pro handoff)");
    assert(url.includes("campaign_id=camp-1"), "campaign_id preservado");
    assert(url.includes("social_profile_id=sp-1"), "social_profile_id preservado");
    assert(url.includes("source_format=arte_estatica"), "format preservado");
    assert(url.includes("return_to="), "return_to preservado (necessário pro handoff de volta ao Criar)");
    assert(!url.includes("briefing") && !url.includes("copy"), "nunca carrega conteúdo de briefing/copy na URL");
  }

  console.log("[test] [PROMPT 26 -- TEST 07] parseStudioLaunchContext sanitiza return_to -- nunca aceita redirect aberto");
  {
    const external = parseStudioLaunchContext({ return_to: "https://evil.example.com" });
    assert(external.returnRoute === "/admin/contentos/criar", "return_to externo rejeitado, cai pro fallback interno seguro");
    const internal = parseStudioLaunchContext({ return_to: "/admin/contentos/criar?client=c1" });
    assert(internal.returnRoute === "/admin/contentos/criar?client=c1", "return_to interno válido preservado");
  }

  console.log("[test] Prompt 24 -- buildSeriesWorkspaceUrl sem nenhum contexto extra ainda produz uma URL limpa");
  {
    const url = buildSeriesWorkspaceUrl("series-2", { clientId: null, contentId: null, campaignId: null, socialProfileId: null, format: null, returnRoute: "/admin/contentos/criar" });
    assert(url === "/admin/contentos/visual/series/series-2?return_to=%2Fadmin%2Fcontentos%2Fcriar", "só return_to sobrevive quando o resto é null");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
