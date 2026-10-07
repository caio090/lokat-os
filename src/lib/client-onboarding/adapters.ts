/**
 * FASE 1C — adapters do Onboarding. DB MIGRATION PENDING (SQL 101) no
 * momento em que este código foi escrito -- toda leitura/escrita
 * degrada honestamente para unavailable/schema_not_applied, mesmo
 * princípio já estabelecido em company-diagnostic/adapters.ts e
 * company-decisions/adapters.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientOnboarding, ClientOnboardingItem, OnboardingTemplate, OnboardingTemplateItem,
  OnboardingFetchReason, OnboardingFetchResult, OnboardingWriteResult, OnboardingSummary,
  OnboardingResponsibleSide, OnboardingItemStatus, OnboardingItemVisibility, OnboardingCreatedFrom, OnboardingStatus,
  OnboardingAttentionItem,
} from "./types";
import { RESOLVED_ITEM_STATUSES } from "./types";
import { logClientActivity } from "@/lib/client-timeline/adapters";

/** Seção 20 -- só estes status de item entram na timeline (nunca cada clique/checkbox). */
const TIMELINE_ITEM_STATUSES: ReadonlySet<OnboardingItemStatus> = new Set(["REQUESTED", "RECEIVED", "APPROVED", "COMPLETED"]);

function classifyError(table: string, err: unknown): OnboardingFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[client-onboarding] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

const ONBOARDING_COLUMNS = "id, client_id, status, template_codes, started_at, target_completion_at, completed_at, owner_id, progress, created_from, commercial_opportunity_id, contract_id, created_at, updated_at";
const ITEM_COLUMNS = "id, onboarding_id, item_key, category, label, responsible_side, status, visibility, is_required_for_kickoff, due_date, notes, reference_url, access_holder, depends_on_item_id, source_templates, created_at, updated_at";

function mapOnboarding(r: Record<string, unknown>): ClientOnboarding {
  return {
    id: r.id as string, companyId: r.client_id as string, status: r.status as ClientOnboarding["status"],
    templateCodes: (r.template_codes as string[] | null) ?? [], startedAt: (r.started_at as string | null) ?? null,
    targetCompletionAt: (r.target_completion_at as string | null) ?? null, completedAt: (r.completed_at as string | null) ?? null,
    ownerId: (r.owner_id as string | null) ?? null, progress: r.progress as number,
    createdFrom: r.created_from as OnboardingCreatedFrom, commercialOpportunityId: (r.commercial_opportunity_id as string | null) ?? null,
    contractId: (r.contract_id as string | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

function mapItem(r: Record<string, unknown>): ClientOnboardingItem {
  return {
    id: r.id as string, onboardingId: r.onboarding_id as string, itemKey: (r.item_key as string | null) ?? null,
    category: (r.category as string | null) ?? null, label: r.label as string, responsibleSide: r.responsible_side as OnboardingResponsibleSide,
    status: r.status as OnboardingItemStatus, visibility: r.visibility as OnboardingItemVisibility,
    isRequiredForKickoff: r.is_required_for_kickoff as boolean, dueDate: (r.due_date as string | null) ?? null,
    notes: (r.notes as string | null) ?? null, referenceUrl: (r.reference_url as string | null) ?? null,
    accessHolder: (r.access_holder as string | null) ?? null, dependsOnItemId: (r.depends_on_item_id as string | null) ?? null,
    sourceTemplates: (r.source_templates as string[] | null) ?? [],
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export async function getActiveOnboarding(adminDb: SupabaseClient, companyId: string): Promise<OnboardingFetchResult<ClientOnboarding | null>> {
  try {
    const { data, error } = await adminDb
      .from("client_onboardings").select(ONBOARDING_COLUMNS).eq("client_id", companyId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
    if (error) return { status: "unavailable", reason: classifyError("client_onboardings", error) };
    return { status: "available", data: data ? mapOnboarding(data) : null };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("client_onboardings", err) };
  }
}

export async function getOnboardingItems(adminDb: SupabaseClient, onboardingId: string): Promise<OnboardingFetchResult<ClientOnboardingItem[]>> {
  try {
    const { data, error } = await adminDb.from("client_onboarding_items").select(ITEM_COLUMNS).eq("onboarding_id", onboardingId).order("created_at", { ascending: true });
    if (error) return { status: "unavailable", reason: classifyError("client_onboarding_items", error) };
    return { status: "available", data: (data ?? []).map(mapItem) };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("client_onboarding_items", err) };
  }
}

export async function listOnboardingTemplates(adminDb: SupabaseClient): Promise<OnboardingFetchResult<OnboardingTemplate[]>> {
  try {
    const { data, error } = await adminDb.from("client_onboarding_templates").select("code, label, description").order("code");
    if (error) return { status: "unavailable", reason: classifyError("client_onboarding_templates", error) };
    return { status: "available", data: (data ?? []).map((r) => ({ code: r.code as string, label: r.label as string, description: (r.description as string | null) ?? null })) };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("client_onboarding_templates", err) };
  }
}

async function getTemplateItems(adminDb: SupabaseClient, templateCodes: string[]): Promise<OnboardingFetchResult<OnboardingTemplateItem[]>> {
  try {
    const { data, error } = await adminDb
      .from("client_onboarding_template_items")
      .select("id, template_code, item_key, category, label, responsible_side, default_visibility, is_required_for_kickoff, sort_order")
      .in("template_code", templateCodes)
      .order("sort_order", { ascending: true });
    if (error) return { status: "unavailable", reason: classifyError("client_onboarding_template_items", error) };
    return {
      status: "available",
      data: (data ?? []).map((r) => ({
        id: r.id as string, templateCode: r.template_code as string, itemKey: r.item_key as string,
        category: (r.category as string | null) ?? null, label: r.label as string, responsibleSide: r.responsible_side as OnboardingResponsibleSide,
        defaultVisibility: r.default_visibility as OnboardingItemVisibility, isRequiredForKickoff: r.is_required_for_kickoff as boolean,
        sortOrder: r.sort_order as number,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("client_onboarding_template_items", err) };
  }
}

/**
 * FASE 1C.1/1C.2 -- quando um onboarding combina múltiplos templates, o
 * MESMO requisito canônico (item_key, ex.: "identidade_visual") pode
 * existir em mais de um template escolhido. Mesclar aqui garante UM
 * ÚNICO client_onboarding_item por item_key, nunca duplicado.
 *
 * Não existe hoje nenhuma fonte canônica central de item_key fora desta
 * função (auditado: nenhum registry/dicionário de item_key em
 * src/lib/*) -- por isso os PRÓPRIOS template_items são a fonte de
 * verdade, e a validação de compatibilidade abaixo garante que
 * combinar templates nunca produz um resultado arbitrário.
 *
 * Regra de merge (determinística, independente de ordem -- A+B === B+A):
 *   - is_required_for_kickoff: OR (o mais exigente sempre vence);
 *   - sourceTemplates: união sem duplicidade, sempre ordenada;
 *   - label/category/responsible_side/default_visibility: só podem ser
 *     reaproveitados quando TODAS as ocorrências do mesmo item_key
 *     concordam. responsible_side e default_visibility mudam QUEM tem
 *     acesso/responsabilidade pelo item -- nunca escolhidos
 *     arbitrariamente; se dois templates divergem nesses campos (ex.:
 *     CLIENT vs LOKAT), é um erro de configuração do catálogo, reportado
 *     explicitamente (nunca silenciado escolhendo o 1º). label/category
 *     divergentes também são tratados como erro -- não há como escolher
 *     entre dois rótulos diferentes para o mesmo requisito sem
 *     arbitrariedade.
 *
 * Pura, idempotente: chamar com o mesmo conjunto de itens (mesmo
 * fora de ordem, ou com um template repetido na lista) sempre produz o
 * mesmo resultado.
 */
export interface MergedTemplateItem {
  itemKey: string;
  category: string | null;
  label: string;
  responsibleSide: OnboardingResponsibleSide;
  defaultVisibility: OnboardingItemVisibility;
  isRequiredForKickoff: boolean;
  sourceTemplates: string[];
}

export type MergeTemplateItemsResult =
  | { ok: true; items: MergedTemplateItem[] }
  | { ok: false; itemKey: string; error: string };

export function mergeTemplateItems(items: OnboardingTemplateItem[]): MergeTemplateItemsResult {
  const byKey = new Map<string, OnboardingTemplateItem[]>();
  for (const ti of items) {
    const group = byKey.get(ti.itemKey);
    if (group) group.push(ti);
    else byKey.set(ti.itemKey, [ti]);
  }

  const merged: MergedTemplateItem[] = [];
  // Ordena as chaves antes de processar -- junto com o sort final, garante que o
  // resultado (e a primeira divergência encontrada, se houver) nunca dependa da
  // ordem de entrada dos templates.
  for (const itemKey of Array.from(byKey.keys()).sort()) {
    const group = byKey.get(itemKey)!;
    const distinctResponsibleSides = Array.from(new Set(group.map((g) => g.responsibleSide))).sort();
    if (distinctResponsibleSides.length > 1) {
      return { ok: false, itemKey, error: `item_key "${itemKey}" tem responsible_side incompatível entre templates (${distinctResponsibleSides.join(" vs ")}) -- muda quem é responsável pelo item, nunca escolhido arbitrariamente.` };
    }
    const distinctVisibilities = Array.from(new Set(group.map((g) => g.defaultVisibility))).sort();
    if (distinctVisibilities.length > 1) {
      return { ok: false, itemKey, error: `item_key "${itemKey}" tem default_visibility incompatível entre templates (${distinctVisibilities.join(" vs ")}) -- pode mudar quem acessa o item, nunca escolhido arbitrariamente.` };
    }
    const distinctLabels = Array.from(new Set(group.map((g) => g.label))).sort();
    if (distinctLabels.length > 1) {
      return { ok: false, itemKey, error: `item_key "${itemKey}" tem label incompatível entre templates (${distinctLabels.join(" vs ")}) -- catálogo de templates inconsistente, corrija antes de combinar.` };
    }
    const distinctCategories = Array.from(new Set(group.map((g) => g.category ?? ""))).sort();
    if (distinctCategories.length > 1) {
      return { ok: false, itemKey, error: `item_key "${itemKey}" tem category incompatível entre templates (${distinctCategories.join(" vs ")}) -- catálogo de templates inconsistente, corrija antes de combinar.` };
    }

    const first = group[0];
    merged.push({
      itemKey, category: first.category, label: first.label, responsibleSide: first.responsibleSide,
      defaultVisibility: first.defaultVisibility,
      isRequiredForKickoff: group.some((g) => g.isRequiredForKickoff),
      sourceTemplates: Array.from(new Set(group.map((g) => g.templateCode))).sort(),
    });
  }
  return { ok: true, items: merged };
}

/**
 * Seção 3/4 -- cria o onboarding e semeia os itens a partir de 1+
 * templates combinados (seção 8). NUNCA gera "dezenas de tarefas
 * cegamente" -- os itens vêm só dos templates explicitamente
 * escolhidos, nunca de todos os templates existentes. FASE 1C.1 --
 * itens repetidos entre templates são mesclados (mergeTemplateItems),
 * nunca inseridos duas vezes.
 */
export async function createOnboarding(
  adminDb: SupabaseClient,
  companyId: string,
  input: { templateCodes: string[]; createdFrom: OnboardingCreatedFrom; commercialOpportunityId?: string | null; ownerId?: string | null },
): Promise<OnboardingWriteResult> {
  if (input.templateCodes.length === 0) return { ok: false, reason: "validation_error" };
  try {
    // dedupe antes de ir pra lista -- templateCodes repetido/sobreposto nunca gera fetch nem insert redundante.
    const uniqueTemplateCodes = Array.from(new Set(input.templateCodes));
    const templateItemsResult = await getTemplateItems(adminDb, uniqueTemplateCodes);
    if (templateItemsResult.status === "unavailable") return { ok: false, reason: templateItemsResult.reason };

    // FASE 1C.2 -- valida/mescla ANTES de criar qualquer linha: um conflito de
    // configuração entre templates nunca deixa um onboarding pela metade (sem itens).
    let mergedItems: MergedTemplateItem[] = [];
    if (templateItemsResult.data.length > 0) {
      const merge = mergeTemplateItems(templateItemsResult.data);
      if (!merge.ok) {
        console.error(`[client-onboarding] conflito de configuração entre templates (${uniqueTemplateCodes.join(", ")}): ${merge.error}`);
        return { ok: false, reason: "template_conflict" };
      }
      mergedItems = merge.items;
    }

    const { data: onboardingRow, error: onboardingError } = await adminDb
      .from("client_onboardings")
      .insert({
        client_id: companyId, status: "IN_PROGRESS", template_codes: input.templateCodes, started_at: new Date().toISOString(),
        owner_id: input.ownerId ?? null, created_from: input.createdFrom, commercial_opportunity_id: input.commercialOpportunityId ?? null,
      })
      .select("id")
      .single();
    if (onboardingError) return { ok: false, reason: classifyError("client_onboardings", onboardingError) };
    const onboardingId = onboardingRow.id as string;

    if (mergedItems.length > 0) {
      const rows = mergedItems.map((mi) => ({
        onboarding_id: onboardingId, item_key: mi.itemKey, category: mi.category, label: mi.label,
        responsible_side: mi.responsibleSide, visibility: mi.defaultVisibility, is_required_for_kickoff: mi.isRequiredForKickoff,
        source_templates: mi.sourceTemplates,
      }));
      const { error: itemsError } = await adminDb.from("client_onboarding_items").insert(rows);
      if (itemsError) console.error("[client-onboarding] onboarding criado mas falha ao semear itens dos templates (best-effort)", itemsError.message);
    }
    // Seção 20 -- marco de timeline: "Onboarding iniciado".
    await logClientActivity(adminDb, companyId, "onboarding_iniciado", "client_onboarding", onboardingId, { templateCodes: input.templateCodes, createdFrom: input.createdFrom });
    return { ok: true, id: onboardingId };
  } catch (err) {
    return { ok: false, reason: classifyError("client_onboardings", err) };
  }
}

export async function updateOnboardingItemStatus(
  adminDb: SupabaseClient,
  companyId: string,
  itemId: string,
  status: OnboardingItemStatus,
  extra?: { notes?: string | null; referenceUrl?: string | null; accessHolder?: string | null },
): Promise<OnboardingWriteResult> {
  try {
    const { data, error } = await adminDb
      .from("client_onboarding_items")
      .update({ status, ...(extra?.notes !== undefined ? { notes: extra.notes } : {}), ...(extra?.referenceUrl !== undefined ? { reference_url: extra.referenceUrl } : {}), ...(extra?.accessHolder !== undefined ? { access_holder: extra.accessHolder } : {}) })
      .eq("id", itemId)
      .select("label, category")
      .maybeSingle();
    if (error) return { ok: false, reason: classifyError("client_onboarding_items", error) };
    // Seção 20 -- só os status que representam um marco real entram na timeline (nunca cada clique/checkbox).
    if (TIMELINE_ITEM_STATUSES.has(status)) {
      await logClientActivity(adminDb, companyId, `onboarding_item_${status.toLowerCase()}`, "client_onboarding_item", itemId, { label: (data?.label as string | undefined) ?? null, category: (data?.category as string | undefined) ?? null });
    }
    return { ok: true, id: itemId };
  } catch (err) {
    return { ok: false, reason: classifyError("client_onboarding_items", err) };
  }
}

/** Seção 18 -- transição explícita do status do PROCESSO de onboarding (nunca confundir com status de item, seção 1). Usada pra marcar READY_FOR_KICKOFF e COMPLETED (kickoff concluído). */
export async function updateOnboardingStatus(
  adminDb: SupabaseClient,
  companyId: string,
  onboardingId: string,
  status: OnboardingStatus,
): Promise<OnboardingWriteResult> {
  try {
    const patch: Record<string, unknown> = { status };
    if (status === "COMPLETED") patch.completed_at = new Date().toISOString();
    const { error } = await adminDb.from("client_onboardings").update(patch).eq("id", onboardingId);
    if (error) return { ok: false, reason: classifyError("client_onboardings", error) };
    if (status === "READY_FOR_KICKOFF") {
      await logClientActivity(adminDb, companyId, "onboarding_pronto_para_kickoff", "client_onboarding", onboardingId, {});
    } else if (status === "COMPLETED") {
      await logClientActivity(adminDb, companyId, "onboarding_kickoff_concluido", "client_onboarding", onboardingId, {});
    }
    return { ok: true, id: onboardingId };
  } catch (err) {
    return { ok: false, reason: classifyError("client_onboardings", err) };
  }
}

/** Seção 18 -- gate de kickoff: só itens marcados is_required_for_kickoff precisam estar resolvidos. Pura, testável sem banco. */
export function computeKickoffReadiness(items: ClientOnboardingItem[]): { ready: boolean; missing: string[] } {
  const missing = items.filter((i) => i.isRequiredForKickoff && !RESOLVED_ITEM_STATUSES.has(i.status)).map((i) => i.label);
  return { ready: missing.length === 0, missing };
}

/** Progresso = % de itens resolvidos sobre o total -- nunca conta itens opcionais como "bloqueio", mas conta pro denominador (visão honesta do todo). Pura. */
export function computeOnboardingProgress(items: ClientOnboardingItem[]): number {
  if (items.length === 0) return 0;
  const resolved = items.filter((i) => RESOLVED_ITEM_STATUSES.has(i.status)).length;
  return Math.round((resolved / items.length) * 100);
}

/** Próxima ação honesta: primeiro item bloqueado, senão o primeiro item pendente/solicitado mais antigo -- nunca inventado quando tudo está resolvido. Pura. */
export function computeNextAction(items: ClientOnboardingItem[]): { itemId: string; label: string; responsibleSide: OnboardingResponsibleSide } | null {
  const blocked = items.find((i) => i.status === "BLOCKED");
  if (blocked) return { itemId: blocked.id, label: blocked.label, responsibleSide: blocked.responsibleSide };
  const pending = items.find((i) => !RESOLVED_ITEM_STATUSES.has(i.status) && i.status !== "BLOCKED");
  if (pending) return { itemId: pending.id, label: pending.label, responsibleSide: pending.responsibleSide };
  return null;
}

/** Seção 13 -- projeção segura para visão do cliente: nunca inclui itens INTERNAL_ONLY, nunca inclui notes/accessHolder (nota interna/quem tem acesso -- nunca exposto ao cliente mesmo num item visível). Pura. */
export function filterItemsForClientVisibility(items: ClientOnboardingItem[]): Array<Pick<ClientOnboardingItem, "id" | "label" | "category" | "status" | "visibility" | "dueDate" | "referenceUrl">> {
  return items
    .filter((i) => i.visibility !== "INTERNAL_ONLY")
    .map((i) => ({ id: i.id, label: i.label, category: i.category, status: i.status, visibility: i.visibility, dueDate: i.dueDate, referenceUrl: i.referenceUrl }));
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));
}

function buildAttentionMessage(companyName: string, label: string, status: OnboardingItemStatus, responsibleSide: OnboardingResponsibleSide, days: number): string {
  if (status === "BLOCKED") return `${companyName}: bloqueio em "${label}" há ${days} dia(s).`;
  if (responsibleSide === "CLIENT") return `${companyName} está há ${days} dia(s) aguardando ${label.toLowerCase()}.`;
  return `"${label}" (${companyName}) pendente há ${days} dia(s) -- responsável: LOKAT.`;
}

/**
 * Seção 12 -- onboardings parados entram na Central do Dia da AGÊNCIA
 * (todas as Companies, não só uma página de cliente). "Evitar dashboard
 * decorativo": cada item aqui é uma pendência real (item não resolvido
 * há N dias), nunca uma métrica solta. DB MIGRATION PENDING (SQL 101).
 */
export async function getOnboardingAttentionItems(adminDb: SupabaseClient, limit = 5): Promise<OnboardingFetchResult<OnboardingAttentionItem[]>> {
  try {
    const { data, error } = await adminDb
      .from("client_onboarding_items")
      .select("id, label, status, responsible_side, updated_at, onboarding_id, client_onboardings!inner(client_id, status, clients!inner(company_name))")
      .in("status", ["PENDING", "REQUESTED", "BLOCKED"])
      .order("updated_at", { ascending: true })
      .limit(limit * 4); // lê mais do que precisa pra poder filtrar onboardings não mais ativos (ver abaixo) e ainda sobrar `limit` itens reais.
    if (error) return { status: "unavailable", reason: classifyError("client_onboarding_items", error) };

    const items: OnboardingAttentionItem[] = (data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => {
        const onboarding = Array.isArray(r.client_onboardings) ? r.client_onboardings[0] : r.client_onboardings;
        const client = onboarding ? (Array.isArray(onboarding.clients) ? onboarding.clients[0] : onboarding.clients) : null;
        if (!onboarding || !client) return null;
        // Só onboardings de fato em andamento pedem atenção -- um onboarding já CANCELLED/COMPLETED nunca aparece aqui.
        if (onboarding.status === "COMPLETED" || onboarding.status === "CANCELLED") return null;
        const days = daysSince(r.updated_at as string);
        const label = r.label as string;
        const status = r.status as OnboardingItemStatus;
        const responsibleSide = r.responsible_side as OnboardingResponsibleSide;
        const companyName = (client.company_name as string | null) ?? "Cliente sem nome";
        return {
          companyId: onboarding.client_id as string, companyName, onboardingId: r.onboarding_id as string, itemId: r.id as string,
          label, responsibleSide, waitingDays: days, message: buildAttentionMessage(companyName, label, status, responsibleSide, days),
        };
      })
      .filter((x): x is OnboardingAttentionItem => x !== null)
      .sort((a, b) => b.waitingDays - a.waitingDays)
      .slice(0, limit);
    return { status: "available", data: items };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("client_onboarding_items", err) };
  }
}

/** Seção 11 -- resumo real pronto pra UI. null quando a Company não tem nenhum onboarding ainda (estado honesto, não um erro). */
export async function getOnboardingSummary(adminDb: SupabaseClient, companyId: string): Promise<OnboardingFetchResult<OnboardingSummary | null>> {
  const onboardingResult = await getActiveOnboarding(adminDb, companyId);
  if (onboardingResult.status === "unavailable") return onboardingResult;
  if (!onboardingResult.data) return { status: "available", data: null };
  const onboarding = onboardingResult.data;

  const itemsResult = await getOnboardingItems(adminDb, onboarding.id);
  if (itemsResult.status === "unavailable") return itemsResult;
  const items = itemsResult.data;

  let nextMeeting: OnboardingSummary["nextMeeting"] = null;
  try {
    const { data } = await adminDb
      .from("commercial_meetings").select("id, title, scheduled_at").eq("onboarding_id", onboarding.id)
      .gte("scheduled_at", new Date().toISOString()).order("scheduled_at", { ascending: true }).limit(1).maybeSingle();
    if (data) nextMeeting = { id: data.id as string, title: data.title as string, scheduledAt: data.scheduled_at as string };
  } catch {
    // best-effort -- ausência de reunião futura nunca derruba o resumo do onboarding.
  }

  const { ready, missing } = computeKickoffReadiness(items);
  return {
    status: "available",
    data: {
      onboarding, progress: computeOnboardingProgress(items),
      waitingOnClientCount: items.filter((i) => i.responsibleSide === "CLIENT" && !RESOLVED_ITEM_STATUSES.has(i.status) && i.status !== "BLOCKED").length,
      waitingOnLokatCount: items.filter((i) => i.responsibleSide === "LOKAT" && !RESOLVED_ITEM_STATUSES.has(i.status) && i.status !== "BLOCKED").length,
      blockedCount: items.filter((i) => i.status === "BLOCKED").length,
      nextAction: computeNextAction(items), nextMeeting, readyForKickoff: ready, missingForKickoff: missing,
    },
  };
}
