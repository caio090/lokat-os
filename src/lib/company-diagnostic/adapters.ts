/**
 * Sprint SQL 91 Security Hardening V2 (Fase 41) — leitura real do schema
 * definido em docs/supabase/91-company-diagnostic-roadmap.sql. Nenhuma
 * escrita nesta sprint (o schema ainda não foi aplicado -- ver Fase 50
 * "no database mutation"): só as queries de leitura, que já funcionam
 * corretamente nos dois mundos (antes e depois da migration ser
 * aplicada) sem precisar de nenhuma mudança de código depois.
 *
 * Zero drift com o SQL (Fase 41): `diagnostic_findings` não tem mais
 * `client_id` próprio (P0.3 -- eliminava uma classe de inconsistência
 * cross-company); a Company é sempre derivada via `diagnostic_id` →
 * `company_diagnostics.client_id`, nunca uma coluna redundante.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CompanyDiagnostic, DiagnosticChecklistItem, DiagnosticFinding, DiagnosticRecommendation,
  FindingPriority, RoadmapItem, SourceFetchReason, SourceFetchResult,
} from "./types";

/**
 * Fase 38-39 — distingue "schema 91 ainda não aplicado" (código Postgres
 * real 42P01 / PostgREST PGRST205, nunca um chute) de qualquer outra
 * falha real. Nunca expõe a mensagem bruta do Postgres na UI (Fase 38) --
 * só loga, sanitizada (tabela + código, nunca token/PII), quando a causa
 * NÃO é a ausência esperada de schema (Fase 39).
 */
function classifyFetchError(table: string, err: unknown): SourceFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[company-diagnostic] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

interface CompanyDiagnosticRow {
  id: string; client_id: string; status: string;
  niche_category: string | null; niche_subcategory: string | null;
  operation_type: "b2b" | "b2c" | "both" | null;
  location_city: string | null; location_state: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}

function mapDiagnostic(row: CompanyDiagnosticRow): CompanyDiagnostic {
  return {
    id: row.id, companyId: row.client_id, status: row.status as CompanyDiagnostic["status"],
    nicheCategory: row.niche_category, nicheSubcategory: row.niche_subcategory,
    operationType: row.operation_type, locationCity: row.location_city, locationState: row.location_state,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
  };
}

/** Fase 19 — nunca ordenar prioridade alfabeticamente (TEXT ASC/DESC
 * ordena "high" < "low" < "medium", errado). Ordem explícita real. */
const PRIORITY_RANK: Record<FindingPriority, number> = { high: 0, medium: 1, low: 2 };
function byPriorityThenCreatedDesc(a: { priority: FindingPriority; created_at: string }, b: { priority: FindingPriority; created_at: string }): number {
  const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rankDiff !== 0) return rankDiff;
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

/**
 * Fase 13/30 — "latest" precisa de um contrato determinístico: mais de
 * um diagnostic pode ter o mesmo created_at em teoria (ex.: seed em
 * lote) -- (created_at DESC, id DESC) sempre resolve para exatamente um
 * vencedor, nunca uma ordem "que depende do dia". Espelha o índice
 * idx_company_diagnostics_client_created do SQL 91.
 */
export async function getLatestCompanyDiagnostic(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<SourceFetchResult<CompanyDiagnostic | null>> {
  try {
    const { data, error } = await adminDb
      .from("company_diagnostics")
      .select("id, client_id, status, niche_category, niche_subcategory, operation_type, location_city, location_state, created_at, updated_at, completed_at")
      .eq("client_id", companyId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { status: "unavailable", reason: classifyFetchError("company_diagnostics", error) };
    return { status: "available", data: data ? mapDiagnostic(data as CompanyDiagnosticRow) : null };
  } catch (err) {
    return { status: "unavailable", reason: classifyFetchError("company_diagnostics", err) };
  }
}

export async function getDiagnosticChecklist(
  adminDb: SupabaseClient,
  diagnosticId: string,
): Promise<SourceFetchResult<DiagnosticChecklistItem[]>> {
  try {
    const { data, error } = await adminDb
      .from("diagnostic_checklist_items")
      .select("id, diagnostic_id, item_key, category, label, status, notes, evidence_url, updated_at")
      .eq("diagnostic_id", diagnosticId);
    if (error) return { status: "unavailable", reason: classifyFetchError("diagnostic_checklist_items", error) };
    return {
      status: "available",
      data: (data ?? []).map((r) => ({
        id: r.id, diagnosticId: r.diagnostic_id, itemKey: r.item_key, category: r.category, label: r.label,
        status: r.status, notes: r.notes, evidenceUrl: r.evidence_url, updatedAt: r.updated_at,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyFetchError("diagnostic_checklist_items", err) };
  }
}

/**
 * Fase 7 (P0.3) — `diagnostic_findings` não tem `client_id` próprio no
 * SQL corrigido. Filtra por Company através de um join real contra
 * `company_diagnostics`, nunca confiando em uma coluna redundante que
 * poderia divergir. `companyId` é atribuído no mapeamento a partir do
 * PARÂMETRO já usado para filtrar -- nunca de uma coluna do banco --
 * porque toda linha retornada já pertence, por construção da query, a
 * esta Company.
 */
export async function getCompanyFindings(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<SourceFetchResult<DiagnosticFinding[]>> {
  try {
    const { data, error } = await adminDb
      .from("diagnostic_findings")
      .select("id, diagnostic_id, category, title, description, evidence_url, severity, priority, status, source, created_at, company_diagnostics!inner(client_id)")
      .eq("company_diagnostics.client_id", companyId)
      .neq("status", "ignored");
    if (error) return { status: "unavailable", reason: classifyFetchError("diagnostic_findings", error) };
    const rows = [...(data ?? [])].sort(byPriorityThenCreatedDesc);
    return {
      status: "available",
      data: rows.map((r) => ({
        id: r.id, diagnosticId: r.diagnostic_id, companyId, category: r.category,
        title: r.title, description: r.description, evidenceUrl: r.evidence_url,
        severity: r.severity, priority: r.priority, status: r.status, source: r.source,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyFetchError("diagnostic_findings", err) };
  }
}

export async function getFindingRecommendations(
  adminDb: SupabaseClient,
  findingId: string,
): Promise<SourceFetchResult<DiagnosticRecommendation[]>> {
  try {
    const { data, error } = await adminDb
      .from("diagnostic_recommendations")
      .select("id, finding_id, title, description, capability, status")
      .eq("finding_id", findingId);
    if (error) return { status: "unavailable", reason: classifyFetchError("diagnostic_recommendations", error) };
    return {
      status: "available",
      data: (data ?? []).map((r) => ({
        id: r.id, findingId: r.finding_id, title: r.title, description: r.description,
        capability: r.capability, status: r.status,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyFetchError("diagnostic_recommendations", err) };
  }
}

/**
 * Fase 19/25 — Roadmap real e Company-scoped, nunca lista demonstrativa.
 * SQL 99 (DB MIGRATION PENDING em Production no momento em que este
 * código foi escrito) adicionou planning_stage/horizon/decision_id --
 * já selecionados aqui. Enquanto a migration não for aplicada, o
 * próprio SELECT falha com "column ... does not exist" (42703), que
 * classifyFetchError() já reconhece via o regex "does not exist" --
 * degrada honestamente pra unavailable/schema_not_applied, nunca uma
 * lista parcial fingindo que o recurso existe.
 */
export async function getCompanyRoadmap(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<SourceFetchResult<RoadmapItem[]>> {
  try {
    const { data, error } = await adminDb
      .from("roadmap_items")
      .select("id, client_id, source_type, source_id, title, description, priority, status, destination_capability, due_date, project_id, created_at, planning_stage, horizon, decision_id")
      .eq("client_id", companyId);
    if (error) return { status: "unavailable", reason: classifyFetchError("roadmap_items", error) };
    const rows = [...(data ?? [])].sort(byPriorityThenCreatedDesc);
    return {
      status: "available",
      data: rows.map((r) => ({
        id: r.id, companyId: r.client_id, sourceType: r.source_type, sourceId: r.source_id,
        title: r.title, description: r.description, priority: r.priority, status: r.status,
        destinationCapability: r.destination_capability, dueDate: r.due_date, projectId: r.project_id,
        planningStage: r.planning_stage, horizon: r.horizon, decisionId: r.decision_id,
      })),
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyFetchError("roadmap_items", err) };
  }
}

export type RoadmapWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: SourceFetchReason };

/**
 * "Próxima Janela" (seção 11) — registrar uma ideia nova, sempre
 * começando em planningStage="idea" (nunca em "approved" -- só uma
 * Decisão explícita promove o estágio, nunca a criação em si).
 */
export async function createRoadmapItem(
  adminDb: SupabaseClient,
  companyId: string,
  input: { title: string; description?: string | null; horizon?: RoadmapItem["horizon"]; priority?: FindingPriority },
): Promise<RoadmapWriteResult> {
  try {
    const { data, error } = await adminDb
      .from("roadmap_items")
      .insert({
        client_id: companyId,
        source_type: "manual",
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? "medium",
        status: "planned",
        planning_stage: "idea",
        horizon: input.horizon ?? "next_window",
      })
      .select("id")
      .single();
    if (error) return { ok: false, reason: classifyFetchError("roadmap_items", error) };
    return { ok: true, id: data.id as string };
  } catch (err) {
    return { ok: false, reason: classifyFetchError("roadmap_items", err) };
  }
}
