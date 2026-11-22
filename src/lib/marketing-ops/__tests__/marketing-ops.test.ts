/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/marketing-ops/__tests__/marketing-ops.test.ts
 *
 * Operação de marketing — fluxo de publicação, métricas sem meta universal,
 * análise de gargalo honesta, templates com origem declarada, cliente de
 * leitura da Marketing API (paginação, limite, erros, fuso/moeda) e ciclo
 * de vida do token. Tudo com fetch falso: nenhuma chamada de rede.
 */
import { canTransition, canActivateDelivery, PLATFORM_STATUS_ON_PUBLISH } from "../workflow";
import { METRICS, safeRatio, computeMediaMetrics, compareWithBenchmark } from "../metrics";
import { analyzeFunnel, MIN_SAMPLE } from "../funnel-analysis";
import { FUNNEL_TEMPLATES, LAUNCH_TEMPLATES } from "../frameworks";
import { WORKFLOW_STATUSES } from "../types";
import { graphGetAll, classifyMetaError, MetaApiError, fetchDailyInsights, buildCampaignDraftRequest, ATTRIBUTION_LABEL } from "@/lib/meta/marketing-api";
import { exchangeForLongLivedToken, inspectToken, resolveOAuthScopes, META_BASE_SCOPES } from "@/lib/meta/token-lifecycle";
import { resolveMetaApiVersion, DEFAULT_META_API_VERSION } from "@/lib/meta/graph-version";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

async function main() {
  // ── Fluxo ──
  assert(canTransition("rascunho", "em_revisao", "equipe").allowed, "1. equipe envia para revisão");
  assert(!canTransition("em_revisao", "aprovada", "equipe").allowed, "2. equipe não aprova");
  assert(canTransition("em_revisao", "aprovada", "aprovador").allowed, "3. aprovador aprova");
  assert(!canTransition("aprovada", "publicada", "aprovador").allowed, "4. aprovador não publica pelo navegador");
  assert(canTransition("aprovada", "publicada", "servidor").allowed, "5. servidor publica aprovada");
  assert(!canTransition("rascunho", "publicada", "servidor").allowed, "6. servidor não publica rascunho");
  assert(!canTransition("publicada", "rascunho", "aprovador").allowed, "7. publicada não volta a rascunho");
  assert(PLATFORM_STATUS_ON_PUBLISH === "PAUSED", "8. publicação nasce PAUSED");
  assert(!canActivateDelivery({ status: "publicada", platformStatus: "PAUSED", activationAuthorizedAt: null, explicitConfirmation: true }).allowed, "9. sem autorização registrada não veicula");
  assert(!canActivateDelivery({ status: "publicada", platformStatus: "PAUSED", activationAuthorizedAt: "2026-11-22T10:00:00Z", explicitConfirmation: false }).allowed, "10. sem confirmação explícita não veicula");
  assert(!canActivateDelivery({ status: "aprovada", platformStatus: null, activationAuthorizedAt: "2026-11-22T10:00:00Z", explicitConfirmation: true }).allowed, "11. aprovada (não publicada) não veicula");
  assert(canActivateDelivery({ status: "pausada", platformStatus: "PAUSED", activationAuthorizedAt: "2026-11-22T10:00:00Z", explicitConfirmation: true }).allowed, "12. publicada+autorizada+confirmada pode veicular");
  assert(WORKFLOW_STATUSES.length === 7, "13. sete status (iguais ao CHECK da migração 105)");

  // ── Métricas ──
  const defs = Object.values(METRICS);
  assert(defs.every((d) => d.formula && d.period && d.source && d.limitations.length > 0), "14. todo indicador tem fórmula, período, fonte e limitações");
  assert(defs.every((d) => !("target" in d) && !("benchmark" in d)), "15. nenhum indicador carrega meta universal");
  assert(safeRatio(5, 0) === null && safeRatio(null, 10) === null && safeRatio(1, 4) === 0.25, "16. divisão segura (zero/ausente → null)");
  const m = computeMediaMetrics({ spend: 100, impressions: 10000, clicks: 200, linkClicks: 120, reach: 4000 });
  assert(m.cpm === 10 && m.ctr === 0.02 && m.frequency === 2.5 && Math.abs((m.cpc_link ?? 0) - 0.8333) < 0.001, "17. métricas de mídia corretas");
  assert(computeMediaMetrics({ spend: 0, impressions: 0, clicks: 0 }).cpm === null, "18. sem impressões → CPM sem dado");
  assert(compareWithBenchmark(0.02, undefined).status === "sem_referencia", "19. sem benchmark do cliente → sem_referencia");
  assert(compareWithBenchmark(30, { metricKey: "cpl", targetValue: 25, direction: "menor_melhor", source: "média Q3 do cliente" }).status === "fora", "20. benchmark do cliente aplicado com direção");

  // ── Gargalo ──
  const atual = [{ stageKey: "a", name: "Anúncio", count: 1000 }, { stageKey: "b", name: "Captura", count: 100 }, { stageKey: "c", name: "Venda", count: 5 }];
  const anterior = [{ stageKey: "a", name: "Anúncio", count: 1000 }, { stageKey: "b", name: "Captura", count: 100 }, { stageKey: "c", name: "Venda", count: 10 }];
  const d1 = analyzeFunnel(atual, anterior);
  assert(d1.bottleneck?.label === "Captura → Venda" && d1.basis === "historico_do_cliente", "21. gargalo = passagem que mais piorou vs. histórico");
  const d2 = analyzeFunnel(atual);
  assert(d2.bottleneck === null && d2.basis === "sem_referencia", "22. sem histórico não aponta gargalo");
  const d3 = analyzeFunnel([{ stageKey: "a", name: "A", count: 10 }, { stageKey: "b", name: "B", count: 2 }], [{ stageKey: "a", name: "A", count: 10 }, { stageKey: "b", name: "B", count: 5 }]);
  assert(d3.bottleneck === null && d3.transitions[0].weakSample && MIN_SAMPLE === 30, "23. amostra pequena não vira conclusão");
  const d4 = analyzeFunnel([{ stageKey: "a", name: "A", count: 50 }, { stageKey: "b", name: "B", count: 60 }]);
  assert(d4.notes.some((n) => n.includes("evento faltando")), "24. etapa com mais entradas que a anterior gera alerta de rastreamento");

  // ── Frameworks ──
  assert(FUNNEL_TEMPLATES.every((t) => t.origin.length > 5 && t.whenToAvoid.length > 5), "25. templates de funil citam origem e quando evitar");
  assert(FUNNEL_TEMPLATES.every((t) => new Set(t.stages.map((s) => s.stageKey)).size === t.stages.length && t.stages.every((s) => /^[a-z0-9_]{1,60}$/.test(s.stageKey) && /^[a-z0-9_]{1,60}$/.test(s.entryEventKey))), "26. chaves de etapa/evento válidas para o CHECK do banco");
  assert(LAUNCH_TEMPLATES.every((t) => t.origin.includes("Érico Rocha") && t.origin.includes("Jeff Walker")), "27. lançamentos creditam Érico Rocha e a origem em Jeff Walker");
  assert(!JSON.stringify([FUNNEL_TEMPLATES, LAUNCH_TEMPLATES]).match(/\d+\s?%/), "28. templates não trazem taxas de referência");

  // ── Marketing API (fetch falso) ──
  const calls: string[] = [];
  const pages = [
    { status: 200, body: { data: [{ id: 1 }], paging: { next: "https://graph.facebook.com/v26.0/next1?access_token=x" } } },
    { status: 200, body: { error: { code: 17, message: "User request limit reached" } } },
    { status: 200, body: { data: [{ id: 2 }] } },
  ];
  let i = 0;
  const fakeFetch = async (url: string) => { calls.push(url); const p = pages[i++]; return { status: p.status, json: async () => p.body }; };
  const waits: number[] = [];
  const rows = await graphGetAll<{ id: number }>("act_1/insights", { level: "ad" }, "TOKEN", { fetchImpl: fakeFetch, sleep: async (ms) => { waits.push(ms); }, version: "v26.0" });
  assert(rows.length === 2 && rows[1].id === 2, "29. pagina por paging.next");
  assert(waits.length === 1 && waits[0] === 1000, "30. limite (17) espera e tenta de novo");
  assert(calls[0].startsWith("https://graph.facebook.com/v26.0/act_1/insights"), "31. versão explícita na URL");

  let erro: MetaApiError | null = null;
  try {
    await graphGetAll("me/adaccounts", {}, "SEGREDO123", { fetchImpl: async () => ({ status: 400, json: async () => ({ error: { code: 190, message: "Error validating access token" } }) }), sleep: async () => {} });
  } catch (e) { erro = e as MetaApiError; }
  assert(erro?.kind === "token_invalido" && !erro.message.includes("SEGREDO123"), "32. token expirado não repete e não vaza token na mensagem");
  assert(classifyMetaError(200, 400) === "sem_permissao" && classifyMetaError(80004, 400) === "limite" && classifyMetaError(null, 503) === "transitorio", "33. classificação de erros");

  const insightFetch = async () => ({ status: 200, json: async () => ({ data: [{ ad_id: "99", account_currency: "BRL", spend: "12.34", impressions: "1000", reach: "800", clicks: "30", inline_link_clicks: "20", actions: [{ action_type: "lead", value: "3" }], date_start: "2026-11-01" }] }) });
  const perf = await fetchDailyInsights({ accountId: "123", level: "ad", since: "2026-11-01", until: "2026-11-01", clientId: "c1", accountTimezone: "America/Sao_Paulo", accountCurrency: "BRL" }, "T", { fetchImpl: insightFetch });
  assert(perf[0].externalObjectId === "99" && perf[0].spend === 12.34 && perf[0].linkClicks === 20 && perf[0].accountTimezone === "America/Sao_Paulo" && perf[0].currency === "BRL", "34. insights normalizados com fuso e moeda da conta");
  assert(perf[0].attributionSetting === ATTRIBUTION_LABEL && perf[0].actions[0].action_type === "lead", "35. atribuição rotulada e ações preservadas");
  let periodoInvalido = false;
  try { await fetchDailyInsights({ accountId: "1", level: "ad", since: "2026-11-05", until: "2026-11-01", clientId: "c", accountTimezone: "UTC", accountCurrency: "BRL" }, "T", { fetchImpl: insightFetch }); } catch { periodoInvalido = true; }
  assert(periodoInvalido, "36. período invertido é recusado");

  const draft = buildCampaignDraftRequest({ accountId: "act_123", name: "Captação", objective: "OUTCOME_LEADS" });
  assert(draft.body.status === "PAUSED" && draft.path === "act_123/campaigns" && draft.notice.includes("nada foi enviado"), "37. rascunho de campanha sempre PAUSED e sem envio");
  let objetivoInvalido = false;
  try { buildCampaignDraftRequest({ accountId: "123", name: "x", objective: "ACTIVE" }); } catch { objetivoInvalido = true; }
  assert(objetivoInvalido, "38. objetivo fora do padrão OUTCOME_* é recusado");

  // ── Token ──
  const now = new Date("2026-11-22T00:00:00Z");
  const ll = await exchangeForLongLivedToken("CURTO", "app", "sec", async () => ({ json: async () => ({ access_token: "LONGO", expires_in: 5184000 }) }), now);
  assert(ll.exchanged && ll.accessToken === "LONGO" && ll.expiresAt?.toISOString() === "2027-01-21T00:00:00.000Z", "39. troca por token longo calcula validade");
  const fb = await exchangeForLongLivedToken("CURTO", "app", "sec", async () => ({ json: async () => ({ error: { message: "x" } }) }));
  assert(!fb.exchanged && fb.accessToken === "CURTO", "40. falha na troca mantém token curto e não inventa validade");
  const insp = await inspectToken("T", "app", "sec", async () => ({ json: async () => ({ data: { is_valid: true, scopes: ["ads_read", "pages_show_list"], expires_at: 0, data_access_expires_at: 1790000000, type: "USER" } }) }));
  assert(insp?.isValid === true && insp.scopes.includes("ads_read") && insp.expiresAt === null && insp.dataAccessExpiresAt instanceof Date, "41. debug_token: escopos, 'não expira' e expiração de acesso a dados");
  assert(resolveOAuthScopes("").length === META_BASE_SCOPES.length, "42. sem extras, só escopos base");
  const ext = resolveOAuthScopes("ads_read, nao_existe ads_management");
  assert(ext.includes("ads_read") && ext.includes("ads_management") && !ext.includes("nao_existe"), "43. extras só da lista permitida");
  assert(resolveMetaApiVersion(undefined) === DEFAULT_META_API_VERSION && resolveMetaApiVersion("v25.0") === "v25.0" && resolveMetaApiVersion("latest") === DEFAULT_META_API_VERSION, "44. versão: env válida tem prioridade, inválida cai no padrão");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
