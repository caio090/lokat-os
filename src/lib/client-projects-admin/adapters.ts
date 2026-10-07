/**
 * Retomada do produto — CRUD administrativo real de client_projects
 * (confirmado pela auditoria: só existia leitura no portal do cliente,
 * zero escrita do lado admin). list/create funcionam HOJE, sem
 * depender de nenhuma migration. scopeCategory depende de SQL 99 (DB
 * MIGRATION PENDING) -- tentado primeiro; se a coluna ainda não
 * existir (42703, "column does not exist"), a função automaticamente
 * tenta de novo sem ela, nunca falha a operação principal por causa de
 * um campo aditivo opcional.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientProject, ClientProjectFetchReason, ClientProjectFetchResult, ClientProjectStatus, ClientProjectWriteResult, ScopeCategory,
} from "./types";

function classifyError(table: string, err: unknown): ClientProjectFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[client-projects-admin] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

/** 42703 = undefined_column -- mais específico que o classify genérico acima (que também cobre tabela ausente). Usado só pra decidir se vale repetir sem scope_category. */
function isUndefinedColumn(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  return code === "42703" || /scope_category.*does not exist/i.test(message);
}

const BASE_COLUMNS = "id, client_id, title, description, status, progress, start_date, due_date, visible_to_client, created_at, updated_at";
/** scope_category = SQL 99; as demais = SQL 101 (FASE 1C, seção 19). Tentadas juntas por simplicidade -- hoje as duas migrations estão pendentes ao mesmo tempo; se um dia uma for aplicada sem a outra, a leitura cai pro fallback BASE_COLUMNS (perde ambos os grupos, nunca quebra). */
const EXTRA_COLUMNS = "scope_category, project_type, current_phase, owner_id, next_action, blocked_reason, client_dependency, onboarding_id";

function mapRow(r: Record<string, unknown>): ClientProject {
  return {
    id: r.id as string, companyId: r.client_id as string, title: r.title as string,
    description: (r.description as string | null) ?? null, status: r.status as ClientProjectStatus,
    progress: r.progress as number, startDate: (r.start_date as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null, visibleToClient: r.visible_to_client as boolean,
    scopeCategory: (r.scope_category as ScopeCategory | undefined) ?? null,
    projectType: (r.project_type as string | undefined) ?? null, currentPhase: (r.current_phase as string | undefined) ?? null,
    ownerId: (r.owner_id as string | undefined) ?? null, nextAction: (r.next_action as string | undefined) ?? null,
    blockedReason: (r.blocked_reason as string | undefined) ?? null, clientDependency: (r.client_dependency as string | undefined) ?? null,
    onboardingId: (r.onboarding_id as string | undefined) ?? null,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export async function getClientProjects(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<ClientProjectFetchResult<ClientProject[]>> {
  try {
    const withExtras = await adminDb.from("client_projects").select(`${BASE_COLUMNS}, ${EXTRA_COLUMNS}`).eq("client_id", companyId).order("created_at", { ascending: false });
    if (!withExtras.error) return { status: "available", data: (withExtras.data ?? []).map(mapRow) };
    if (!isUndefinedColumn(withExtras.error)) return { status: "unavailable", reason: classifyError("client_projects", withExtras.error) };

    // scope_category (SQL 99) e/ou os campos de SQL 101 ainda não existem -- mesma leitura, só as colunas base.
    const { data, error } = await adminDb.from("client_projects").select(BASE_COLUMNS).eq("client_id", companyId).order("created_at", { ascending: false });
    if (error) return { status: "unavailable", reason: classifyError("client_projects", error) };
    return { status: "available", data: (data ?? []).map(mapRow) };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("client_projects", err) };
  }
}

export async function createClientProject(
  adminDb: SupabaseClient,
  companyId: string,
  createdBy: string | null,
  input: {
    title: string; description?: string | null; dueDate?: string | null; visibleToClient?: boolean; scopeCategory?: ScopeCategory;
    projectType?: string | null; onboardingId?: string | null;
  },
): Promise<ClientProjectWriteResult> {
  if (!input.title.trim()) return { ok: false, reason: "validation_error" };
  const basePayload = {
    client_id: companyId,
    created_by: createdBy,
    title: input.title.trim(),
    description: input.description ?? null,
    due_date: input.dueDate ?? null,
    visible_to_client: input.visibleToClient ?? true,
  };
  try {
    const withExtras = await adminDb.from("client_projects").insert({
      ...basePayload, scope_category: input.scopeCategory ?? "contratado",
      project_type: input.projectType ?? null, onboarding_id: input.onboardingId ?? null,
    }).select("id").single();
    if (!withExtras.error) return { ok: true, id: withExtras.data.id as string, scopeCategoryApplied: true };
    if (!isUndefinedColumn(withExtras.error)) return { ok: false, reason: classifyError("client_projects", withExtras.error) };

    // scope_category (SQL 99) e/ou os campos de SQL 101 ainda não existem -- grava o resto normalmente, sem os campos aditivos.
    const { data, error } = await adminDb.from("client_projects").insert(basePayload).select("id").single();
    if (error) return { ok: false, reason: classifyError("client_projects", error) };
    return { ok: true, id: data.id as string, scopeCategoryApplied: false };
  } catch (err) {
    return { ok: false, reason: classifyError("client_projects", err) };
  }
}

/** FASE 1C -- atualizar campos de jornada do projeto (seção 19): fase, próxima ação, bloqueio, dependência do cliente. Mesmo fallback defensivo -- nunca falha a operação principal se SQL 101 ainda não foi aplicado (nesse caso, undefined-column é reportado como erro real, já que não há "payload base" sem esses campos pra um UPDATE que só os contém). */
export async function updateClientProjectJourney(
  adminDb: SupabaseClient,
  projectId: string,
  input: { currentPhase?: string | null; nextAction?: string | null; blockedReason?: string | null; clientDependency?: string | null; status?: ClientProjectStatus; progress?: number },
): Promise<ClientProjectWriteResult> {
  try {
    const payload: Record<string, unknown> = {};
    if (input.currentPhase !== undefined) payload.current_phase = input.currentPhase;
    if (input.nextAction !== undefined) payload.next_action = input.nextAction;
    if (input.blockedReason !== undefined) payload.blocked_reason = input.blockedReason;
    if (input.clientDependency !== undefined) payload.client_dependency = input.clientDependency;
    if (input.status !== undefined) payload.status = input.status;
    if (input.progress !== undefined) payload.progress = input.progress;
    const { error } = await adminDb.from("client_projects").update(payload).eq("id", projectId);
    if (error) return { ok: false, reason: classifyError("client_projects", error) };
    return { ok: true, id: projectId, scopeCategoryApplied: true };
  } catch (err) {
    return { ok: false, reason: classifyError("client_projects", err) };
  }
}
