/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/client-onboarding/__tests__/adapters.structural.test.ts
 * FASE 1C, seção 23 — cobre o comportamento mais arriscado deste domínio:
 * gate de kickoff (só itens obrigatórios bloqueiam), progresso honesto,
 * próxima ação (bloqueio > pendente mais antigo > nenhuma), visibilidade
 * de cliente (nunca vaza INTERNAL_ONLY/notes/accessHolder), criação de
 * onboarding a partir de 1+ templates (nunca "dezenas de tarefas
 * cegamente"), e degradação honesta quando SQL 101 ainda não foi
 * aplicada (DB MIGRATION PENDING).
 */
import {
  computeKickoffReadiness, computeOnboardingProgress, computeNextAction, filterItemsForClientVisibility,
  createOnboarding, getOnboardingSummary, getActiveOnboarding, getOnboardingAttentionItems, mergeTemplateItems,
} from "../adapters";
import type { ClientOnboardingItem, OnboardingTemplateItem } from "../types";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

function item(partial: Partial<ClientOnboardingItem> & { id: string; label: string; status: ClientOnboardingItem["status"] }): ClientOnboardingItem {
  return {
    onboardingId: "onb-1", itemKey: null, category: null, responsibleSide: "CLIENT", visibility: "CLIENT_VISIBLE",
    isRequiredForKickoff: false, dueDate: null, notes: null, referenceUrl: null, accessHolder: null, dependsOnItemId: null, sourceTemplates: [],
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    ...partial,
  };
}

const UNDEFINED_TABLE_ERR = { code: "42P01", message: 'relation "client_onboardings" does not exist' };

function fakeDbNoOnboarding() {
  return {
    from: (table: string) => {
      if (table === "client_onboardings") return { select: () => ({ eq: () => ({ order: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) }) };
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakeDbSchemaNotApplied() {
  return {
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: UNDEFINED_TABLE_ERR }) }) }) }) }) }) }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function main() {
  console.log("[test] gate de kickoff -- só itens obrigatórios bloqueiam, opcionais pendentes não contam");
  {
    const items = [
      item({ id: "i1", label: "Logo", status: "COMPLETED", isRequiredForKickoff: true }),
      item({ id: "i2", label: "Fotos (opcional)", status: "PENDING", isRequiredForKickoff: false }),
      item({ id: "i3", label: "Acesso Meta", status: "APPROVED", isRequiredForKickoff: true }),
    ];
    const { ready, missing } = computeKickoffReadiness(items);
    assert(ready === true, "pronto para kickoff quando todos os OBRIGATÓRIOS estão resolvidos, mesmo com opcional pendente");
    assert(missing.length === 0, "lista de faltantes vazia");
  }
  {
    const items = [
      item({ id: "i1", label: "Logo", status: "PENDING", isRequiredForKickoff: true }),
      item({ id: "i2", label: "Fotos (opcional)", status: "PENDING", isRequiredForKickoff: false }),
    ];
    const { ready, missing } = computeKickoffReadiness(items);
    assert(ready === false, "NÃO pronto quando um item obrigatório ainda está pendente");
    assert(missing.length === 1 && missing[0] === "Logo", "aponta exatamente o item obrigatório faltante (nunca os opcionais)");
  }

  console.log("[test] progresso -- % de itens resolvidos sobre o total (opcionais contam no denominador)");
  {
    const items = [
      item({ id: "i1", label: "a", status: "COMPLETED" }),
      item({ id: "i2", label: "b", status: "APPROVED" }),
      item({ id: "i3", label: "c", status: "PENDING" }),
      item({ id: "i4", label: "d", status: "REQUESTED" }),
    ];
    assert(computeOnboardingProgress(items) === 50, "2 de 4 resolvidos = 50%");
    assert(computeOnboardingProgress([]) === 0, "lista vazia nunca gera NaN/Infinity -- 0%");
  }

  console.log("[test] próxima ação -- bloqueio sempre vence, senão o pendente mais antigo, senão nenhuma (nunca inventada)");
  {
    const items = [
      item({ id: "i1", label: "Aprovado", status: "APPROVED" }),
      item({ id: "i2", label: "Travado", status: "BLOCKED", responsibleSide: "LOKAT" }),
      item({ id: "i3", label: "Pendente antigo", status: "PENDING" }),
    ];
    const next = computeNextAction(items);
    assert(next?.itemId === "i2", "bloqueio tem prioridade sobre qualquer pendência comum");
    assert(next?.responsibleSide === "LOKAT", "responsável correto propagado");
  }
  {
    const items = [item({ id: "i1", label: "Resolvido", status: "COMPLETED" }), item({ id: "i2", label: "Não necessário", status: "NOT_REQUIRED" })];
    assert(computeNextAction(items) === null, "nenhuma ação pendente quando tudo está resolvido -- nunca inventa uma próxima ação");
  }

  console.log("[test] visibilidade de cliente -- nunca vaza INTERNAL_ONLY nem notes/accessHolder (seção 13/6)");
  {
    const items = [
      item({ id: "i1", label: "Margem interna", status: "PENDING", visibility: "INTERNAL_ONLY", notes: "risco financeiro" }),
      item({ id: "i2", label: "Logo", status: "REQUESTED", visibility: "CLIENT_ACTION_REQUIRED", notes: "nota interna qualquer", accessHolder: "fulano@lokat.com" }),
    ];
    const visible = filterItemsForClientVisibility(items);
    assert(visible.length === 1 && visible[0].id === "i2", "item INTERNAL_ONLY nunca aparece na visão do cliente");
    assert(!("notes" in visible[0]) && !("accessHolder" in visible[0]), "notes/accessHolder nunca viajam na projeção do cliente, mesmo em item visível");
  }

  function mergeOk(items: OnboardingTemplateItem[], label: string): import("../adapters").MergedTemplateItem[] {
    const result = mergeTemplateItems(items);
    if (!result.ok) { failed++; console.error(`  FAIL - ${label}: esperava sucesso, veio conflito: ${result.error}`); return []; }
    return result.items;
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: template único (sem sobreposição) -- nenhuma mudança, itens intactos");
  {
    const items: OnboardingTemplateItem[] = [
      { id: "ti1", templateCode: "MARKETING", itemKey: "BRAND_LOGO", category: "Materiais", label: "Logo em alta resolução", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 1 },
    ];
    const merged = mergeOk(items, "template único");
    assert(merged.length === 1 && merged[0].itemKey === "BRAND_LOGO", "1 template, 1 item -- sem merge necessário");
    assert(merged[0].sourceTemplates.length === 1 && merged[0].sourceTemplates[0] === "MARKETING", "sourceTemplates aponta pro único template de origem");
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: dois templates SEM sobreposição -- nenhum item perdido, nenhum duplicado");
  {
    const items: OnboardingTemplateItem[] = [
      { id: "ti1", templateCode: "MARKETING", itemKey: "BRAND_LOGO", category: "Materiais", label: "Logo", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 1 },
      { id: "ti2", templateCode: "SITE", itemKey: "DOMAIN_ACCESS", category: "Acessos", label: "Domínio", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: true, sortOrder: 1 },
    ];
    const merged = mergeOk(items, "dois sem sobreposição");
    assert(merged.length === 2, "2 templates sem sobreposição -- 2 itens, nenhum perdido/fundido indevidamente");
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: dois templates com item_key repetido E COMPATÍVEL -- 1 item só, nunca duplicado");
  {
    const items: OnboardingTemplateItem[] = [
      { id: "ti1", templateCode: "MARKETING", itemKey: "META_ACCESS", category: "Acessos", label: "Acesso Meta Business", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 5 },
      { id: "ti2", templateCode: "TRAFEGO", itemKey: "META_ACCESS", category: "Acessos", label: "Acesso Meta Business", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 2 },
    ];
    const merged = mergeOk(items, "dois com item repetido compatível");
    assert(merged.length === 1, "item_key repetido entre MARKETING e TRAFEGO -- UM item final, nunca dois");
    assert(merged[0].sourceTemplates.length === 2 && merged[0].sourceTemplates.includes("MARKETING") && merged[0].sourceTemplates.includes("TRAFEGO"), "sourceTemplates preserva AMBOS os templates que originaram o requisito");
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: três templates com item_key repetido E COMPATÍVEL -- continua 1 item, 3 origens preservadas");
  {
    const items: OnboardingTemplateItem[] = [
      { id: "ti1", templateCode: "MARKETING", itemKey: "SCOPE_CONFIRMATION", category: "Escopo", label: "Escopo confirmado", responsibleSide: "SHARED", defaultVisibility: "CLIENT_APPROVAL_REQUIRED", isRequiredForKickoff: false, sortOrder: 6 },
      { id: "ti2", templateCode: "SITE", itemKey: "SCOPE_CONFIRMATION", category: "Escopo", label: "Escopo confirmado", responsibleSide: "SHARED", defaultVisibility: "CLIENT_APPROVAL_REQUIRED", isRequiredForKickoff: false, sortOrder: 6 },
      { id: "ti3", templateCode: "AUDIOVISUAL", itemKey: "SCOPE_CONFIRMATION", category: "Escopo", label: "Escopo confirmado", responsibleSide: "SHARED", defaultVisibility: "CLIENT_APPROVAL_REQUIRED", isRequiredForKickoff: false, sortOrder: 6 },
    ];
    const merged = mergeOk(items, "três com item repetido compatível");
    assert(merged.length === 1, "3 templates com o mesmo requisito -- continua 1 item só");
    assert(merged[0].sourceTemplates.length === 3, "as 3 origens são preservadas, nenhuma perdida");
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: obrigatório + opcional = obrigatório (o mais exigente sempre vence, OR nunca AND)");
  {
    const items: OnboardingTemplateItem[] = [
      { id: "ti1", templateCode: "MARKETING", itemKey: "CLIENT_CONTACT", category: "Cadastro", label: "Contato do cliente", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 3 },
      { id: "ti2", templateCode: "SOCIAL_MEDIA", itemKey: "CLIENT_CONTACT", category: "Cadastro", label: "Contato do cliente", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: true, sortOrder: 3 },
    ];
    const merged = mergeOk(items, "obrigatório + opcional");
    assert(merged.length === 1 && merged[0].isRequiredForKickoff === true, "um template marca obrigatório -- o item final é obrigatório, mesmo o outro template tratando como opcional");
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: aplicação repetida do mesmo template (lista com código duplicado) -- idempotente, nunca duplica");
  {
    const singleTemplateItems: OnboardingTemplateItem[] = [
      { id: "ti1", templateCode: "MARKETING", itemKey: "BRAND_GUIDELINES", category: "Materiais", label: "Manual de marca", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 7 },
    ];
    // Simula o que getTemplateItems traria se templateCodes=["MARKETING","MARKETING"] fosse passado sem dedupe de códigos primeiro -- a mesma linha apareceria 2x.
    const duplicatedRows: OnboardingTemplateItem[] = [...singleTemplateItems, ...singleTemplateItems];
    const mergedOnce = mergeOk(singleTemplateItems, "idempotência (1x)");
    const mergedTwice = mergeOk(duplicatedRows, "idempotência (2x)");
    assert(mergedTwice.length === mergedOnce.length, "aplicar o mesmo template 2x produz o MESMO resultado que aplicar 1x -- idempotente");
    assert(mergedTwice[0].sourceTemplates.length === 1, "mesmo repetido na lista, sourceTemplates nunca lista o mesmo template 2x");
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: resultado é o MESMO independente da ordem dos templates (A+B === B+A)");
  {
    const a: OnboardingTemplateItem = { id: "ti1", templateCode: "MARKETING", itemKey: "GOOGLE_ACCESS", category: "Acessos", label: "Acesso Google Ads", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 4 };
    const b: OnboardingTemplateItem = { id: "ti2", templateCode: "SITE", itemKey: "GOOGLE_ACCESS", category: "Acessos", label: "Acesso Google Ads", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: true, sortOrder: 4 };
    const mergedAB = mergeOk([a, b], "ordem A+B");
    const mergedBA = mergeOk([b, a], "ordem B+A");
    assert(JSON.stringify(mergedAB) === JSON.stringify(mergedBA), "combinar [MARKETING, SITE] ou [SITE, MARKETING] produz exatamente o mesmo resultado -- merge nunca depende da ordem de entrada");
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: conflito estrutural (responsible_side incompatível) é DETECTADO, nunca escolhido silenciosamente");
  {
    const conflictingA: OnboardingTemplateItem = { id: "ti1", templateCode: "MARKETING", itemKey: "DOMAIN_ACCESS", category: "Acessos", label: "Domínio", responsibleSide: "CLIENT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 1 };
    const conflictingB: OnboardingTemplateItem = { id: "ti2", templateCode: "ESTRUTURA_DIGITAL", itemKey: "DOMAIN_ACCESS", category: "Acessos", label: "Domínio", responsibleSide: "LOKAT", defaultVisibility: "CLIENT_ACTION_REQUIRED", isRequiredForKickoff: false, sortOrder: 1 };
    const result = mergeTemplateItems([conflictingA, conflictingB]);
    assert(result.ok === false, "CLIENT vs LOKAT pro mesmo item_key -- erro de configuração, nunca silenciado");
    if (!result.ok) {
      assert(result.itemKey === "DOMAIN_ACCESS", "erro aponta o item_key exato em conflito");
      assert(/responsible_side/.test(result.error), "mensagem de erro explica QUAL campo está em conflito");
    }
    // Mesmo conflito, ordem invertida -- detectado de qualquer jeito (nunca depende de qual template "ganha" por posição).
    const resultReversed = mergeTemplateItems([conflictingB, conflictingA]);
    assert(resultReversed.ok === false, "conflito detectado independente da ordem dos templates na lista");
  }

  console.log("[test] FASE 1C.2 -- mergeTemplateItems: conflito estrutural (visibility incompatível, pode mudar quem acessa) é DETECTADO");
  {
    const a: OnboardingTemplateItem = { id: "ti1", templateCode: "MARKETING", itemKey: "INTERNAL_RISK_NOTE", category: "Interno", label: "Observação interna", responsibleSide: "LOKAT", defaultVisibility: "INTERNAL_ONLY", isRequiredForKickoff: false, sortOrder: 1 };
    const b: OnboardingTemplateItem = { id: "ti2", templateCode: "SITE", itemKey: "INTERNAL_RISK_NOTE", category: "Interno", label: "Observação interna", responsibleSide: "LOKAT", defaultVisibility: "CLIENT_VISIBLE", isRequiredForKickoff: false, sortOrder: 1 };
    const result = mergeTemplateItems([a, b]);
    assert(result.ok === false, "INTERNAL_ONLY vs CLIENT_VISIBLE pro mesmo item_key -- mudaria quem vê o item, erro de configuração");
  }

  console.log("[test] criação de onboarding -- semeia itens SÓ dos templates escolhidos (nunca de todos os templates existentes)");
  {
    let insertedOnboarding: Record<string, unknown> | null = null;
    let insertedItems: Record<string, unknown>[] | null = null;
    const db = {
      from: (table: string) => {
        if (table === "client_onboardings") {
          return { insert: (payload: Record<string, unknown>) => { insertedOnboarding = payload; return { select: () => ({ single: () => Promise.resolve({ data: { id: "onb-new" }, error: null }) }) }; } };
        }
        if (table === "client_onboarding_template_items") {
          return {
            select: () => ({
              in: (_col: string, codes: string[]) => ({
                order: () => Promise.resolve({
                  data: [
                    { id: "ti1", template_code: "SITE", item_key: "logo", category: "visual", label: "Logo em alta resolução", responsible_side: "CLIENT", default_visibility: "CLIENT_ACTION_REQUIRED", is_required_for_kickoff: true, sort_order: 1 },
                    { id: "ti2", template_code: "MARKETING", item_key: "acessos", category: "acessos", label: "Acesso Meta Business", responsible_side: "CLIENT", default_visibility: "CLIENT_ACTION_REQUIRED", is_required_for_kickoff: true, sort_order: 2 },
                  ].filter((r) => codes.includes(r.template_code)),
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "client_onboarding_items") return { insert: (rows: Record<string, unknown>[]) => { insertedItems = rows; return Promise.resolve({ error: null }); } };
        if (table === "activity_logs") return { insert: () => Promise.resolve({ error: null }) };
        throw new Error(`unexpected table ${table}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await createOnboarding(db, "company-tayannara", { templateCodes: ["SITE", "MARKETING"], createdFrom: "commercial_handoff", commercialOpportunityId: "lead-1" });
    assert(result.ok === true, "onboarding criado com sucesso a partir do handoff comercial");
    assert((insertedOnboarding as unknown as { created_from: string })?.created_from === "commercial_handoff", "created_from=commercial_handoff preservado (nunca forçado para manual)");
    assert(insertedItems !== null && (insertedItems as Record<string, unknown>[]).length === 2, "exatamente 2 itens semeados -- um por template escolhido, nunca 'dezenas cegamente'");
  }

  console.log("[test] FASE 1C.1 -- createOnboarding com templates sobrepostos -- item repetido vira UM SÓ client_onboarding_item, nunca duplicado no insert real");
  {
    let insertedItems: Record<string, unknown>[] | null = null;
    const db = {
      from: (table: string) => {
        if (table === "client_onboardings") {
          return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "onb-overlap" }, error: null }) }) }) };
        }
        if (table === "client_onboarding_template_items") {
          return {
            select: () => ({
              in: (_col: string, codes: string[]) => ({
                order: () => Promise.resolve({
                  data: [
                    { id: "ti1", template_code: "MARKETING", item_key: "META_ACCESS", category: "Acessos", label: "Acesso Meta Business", responsible_side: "CLIENT", default_visibility: "CLIENT_ACTION_REQUIRED", is_required_for_kickoff: false, sort_order: 5 },
                    { id: "ti2", template_code: "TRAFEGO", item_key: "META_ACCESS", category: "Acessos", label: "Acesso Meta Business", responsible_side: "CLIENT", default_visibility: "CLIENT_ACTION_REQUIRED", is_required_for_kickoff: true, sort_order: 2 },
                    { id: "ti3", template_code: "TRAFEGO", item_key: "GOOGLE_ACCESS", category: "Acessos", label: "Acesso Google Ads", responsible_side: "CLIENT", default_visibility: "CLIENT_ACTION_REQUIRED", is_required_for_kickoff: true, sort_order: 3 },
                  ].filter((r) => codes.includes(r.template_code)),
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "client_onboarding_items") return { insert: (rows: Record<string, unknown>[]) => { insertedItems = rows; return Promise.resolve({ error: null }); } };
        if (table === "activity_logs") return { insert: () => Promise.resolve({ error: null }) };
        throw new Error(`unexpected table ${table}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await createOnboarding(db, "company-combinado", { templateCodes: ["MARKETING", "TRAFEGO"], createdFrom: "manual" });
    assert(result.ok === true, "onboarding criado com 2 templates sobrepostos");
    const finalItems: Record<string, unknown>[] = insertedItems ?? [];
    assert(finalItems.length === 2, "3 template_items (um duplicado) viram só 2 client_onboarding_items reais -- META_ACCESS nunca inserido 2x");
    const metaRow = finalItems.find((r) => r.item_key === "META_ACCESS");
    assert(metaRow?.is_required_for_kickoff === true, "MARKETING marcava META_ACCESS como opcional, TRAFEGO como obrigatório -- o item final é obrigatório (o mais exigente vence)");
    assert(Array.isArray(metaRow?.source_templates) && (metaRow!.source_templates as string[]).length === 2, "source_templates do item mesclado preserva os 2 templates de origem");
  }

  console.log("[test] templateCodes vazio -- rejeitado antes de qualquer escrita (nunca cria onboarding sem nenhum template)");
  {
    const result = await createOnboarding({} as never, "company-a", { templateCodes: [], createdFrom: "manual" });
    assert(result.ok === false && result.reason === "validation_error", "templateCodes=[] é erro de validação, nunca onboarding vazio");
  }

  console.log("[test] cliente sem onboarding -- resumo honesto (data=null), nunca um erro");
  {
    const result = await getOnboardingSummary(fakeDbNoOnboarding(), "company-sem-onboarding");
    assert(result.status === "available" && result.data === null, "status=available com data=null -- estado real, não falha");
  }

  console.log("[test] migration 101 pendente -- getActiveOnboarding degrada honestamente (nunca finge que existe)");
  {
    const result = await getActiveOnboarding(fakeDbSchemaNotApplied(), "company-a");
    assert(result.status === "unavailable" && result.reason === "schema_not_applied", "schema_not_applied reportado explicitamente quando a tabela ainda não existe");
  }

  console.log("[test] Central do Dia (seção 12) -- onboardings parados de TODA a agência, só itens não resolvidos, nunca de onboarding já concluído/cancelado");
  {
    const now = Date.now();
    const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
    const rows = [
      { id: "i1", label: "Envio de material do Outlet", status: "PENDING", responsible_side: "CLIENT", updated_at: daysAgo(3), onboarding_id: "onb-tay", client_onboardings: { client_id: "company-tayannara", status: "IN_PROGRESS", clients: { company_name: "Tayannara Carvalho" } } },
      { id: "i2", label: "Acesso Meta Business", status: "BLOCKED", responsible_side: "LOKAT", updated_at: daysAgo(10), onboarding_id: "onb-x", client_onboardings: { client_id: "company-x", status: "IN_PROGRESS", clients: { company_name: "Outro Cliente" } } },
      { id: "i3", label: "Item de onboarding já concluído", status: "PENDING", responsible_side: "CLIENT", updated_at: daysAgo(30), onboarding_id: "onb-done", client_onboardings: { client_id: "company-done", status: "COMPLETED", clients: { company_name: "Cliente Antigo" } } },
    ];
    const db = { from: () => ({ select: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }) }) }) }) } as never;
    const result = await getOnboardingAttentionItems(db, 5);
    assert(result.status === "available", "lista disponível");
    if (result.status !== "available") throw new Error("unreachable");
    assert(result.data.length === 2, "onboarding já COMPLETED nunca gera item de atenção, mesmo com item tecnicamente pendente");
    assert(result.data[0].companyId === "company-x", "item com mais dias de espera (bloqueio há 10 dias) vem primeiro");
    assert(result.data[0].message.includes("bloqueio"), "mensagem de item BLOCKED usa a palavra 'bloqueio', nunca a frase genérica de 'aguardando'");
    assert(result.data[1].message === "Tayannara Carvalho está há 3 dia(s) aguardando envio de material do outlet.", "mensagem no formato do exemplo do brief (seção 12), com o nome real do cliente");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
