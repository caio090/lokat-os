/**
 * Retomada do produto — adapters do Decision Ledger da Company.
 * DB MIGRATION PENDING: docs/supabase/99-company-decisions-and-relationship-links.sql
 * ainda não foi aplicado em Production (gate de escrita do conector
 * Supabase recusou a aplicação -- ver relatório da fase). Todo este
 * arquivo já funciona corretamente nos dois mundos: antes da migration
 * (toda leitura/escrita degrada para unavailable/schema_not_applied,
 * nunca inventa dado) e depois (passa a funcionar sem nenhuma mudança
 * de código), mesmo padrão já estabelecido em company-diagnostic/adapters.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CompanyDecision, CreateCompanyDecisionInput, DecisionFetchReason, DecisionFetchResult, DecisionWriteResult,
} from "./types";

function classifyError(table: string, err: unknown): DecisionFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || code === "42883" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[company-decisions] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

interface CompanyDecisionRow {
  id: string; client_id: string; title: string; decision: string; context: string | null;
  origin: string; impact: string | null; client_validation: string; belongs_to_scope: boolean | null;
  generates_task: boolean; generates_project: boolean; generates_budget: boolean;
  status: string; supersedes_decision_id: string | null;
  decided_on: string; review_at: string | null; last_reviewed_at: string | null;
  created_at: string; updated_at: string;
}

function mapDecision(r: CompanyDecisionRow): CompanyDecision {
  return {
    id: r.id, companyId: r.client_id, title: r.title, decision: r.decision, context: r.context,
    origin: r.origin as CompanyDecision["origin"], impact: r.impact as CompanyDecision["impact"],
    clientValidation: r.client_validation as CompanyDecision["clientValidation"],
    belongsToScope: r.belongs_to_scope, generatesTask: r.generates_task, generatesProject: r.generates_project,
    generatesBudget: r.generates_budget, status: r.status as CompanyDecision["status"],
    supersedesDecisionId: r.supersedes_decision_id, decidedOn: r.decided_on, reviewAt: r.review_at,
    lastReviewedAt: r.last_reviewed_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const DECISION_COLUMNS = "id, client_id, title, decision, context, origin, impact, client_validation, belongs_to_scope, generates_task, generates_project, generates_budget, status, supersedes_decision_id, decided_on, review_at, last_reviewed_at, created_at, updated_at";

/** Histórico completo (active + superseded) -- a UI decide o que destacar; nunca esconde a cadeia. */
export async function getCompanyDecisions(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<DecisionFetchResult<CompanyDecision[]>> {
  try {
    const { data, error } = await adminDb
      .from("company_decisions")
      .select(DECISION_COLUMNS)
      .eq("client_id", companyId)
      .order("decided_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) return { status: "unavailable", reason: classifyError("company_decisions", error) };
    return { status: "available", data: (data ?? []).map((r) => mapDecision(r as CompanyDecisionRow)) };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("company_decisions", err) };
  }
}

export async function createCompanyDecision(
  adminDb: SupabaseClient,
  companyId: string,
  createdBy: string | null,
  input: CreateCompanyDecisionInput,
): Promise<DecisionWriteResult> {
  if (!input.title.trim() || !input.decision.trim()) return { ok: false, reason: "validation_error" };
  try {
    const { data, error } = await adminDb
      .from("company_decisions")
      .insert({
        client_id: companyId,
        created_by: createdBy,
        title: input.title.trim(),
        decision: input.decision.trim(),
        context: input.context ?? null,
        origin: input.origin ?? "manual",
        impact: input.impact ?? null,
        client_validation: input.clientValidation ?? "internal",
        belongs_to_scope: input.belongsToScope ?? null,
        generates_task: input.generatesTask ?? false,
        generates_project: input.generatesProject ?? false,
        generates_budget: input.generatesBudget ?? false,
        decided_on: input.decidedOn ?? new Date().toISOString().slice(0, 10),
        review_at: input.reviewAt ?? null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, reason: classifyError("company_decisions", error) };
    return { ok: true, id: data.id as string };
  } catch (err) {
    return { ok: false, reason: classifyError("company_decisions", err) };
  }
}

/** Supersede atômico via RPC (SQL 99 company_supersede_decision) -- nunca um UPDATE direto (perderia a imutabilidade/cadeia). */
export async function supersedeCompanyDecision(
  adminDb: SupabaseClient,
  oldDecisionId: string,
  companyId: string,
  input: CreateCompanyDecisionInput,
): Promise<DecisionWriteResult> {
  if (!input.decision.trim()) return { ok: false, reason: "validation_error" };
  try {
    const { data, error } = await adminDb.rpc("company_supersede_decision", {
      p_old_id: oldDecisionId,
      p_client_id: companyId,
      p_payload: {
        title: input.title, decision: input.decision, context: input.context ?? undefined,
        origin: input.origin, impact: input.impact ?? undefined,
        client_validation: input.clientValidation, belongs_to_scope: input.belongsToScope ?? undefined,
        generates_task: input.generatesTask, generates_project: input.generatesProject, generates_budget: input.generatesBudget,
        decided_on: input.decidedOn, review_at: input.reviewAt ?? undefined,
      },
    });
    if (error) return { ok: false, reason: classifyError("company_supersede_decision", error) };
    return { ok: true, id: data as string };
  } catch (err) {
    return { ok: false, reason: classifyError("company_supersede_decision", err) };
  }
}
