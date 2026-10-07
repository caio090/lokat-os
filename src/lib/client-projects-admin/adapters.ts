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

function mapRow(r: Record<string, unknown>): ClientProject {
  return {
    id: r.id as string, companyId: r.client_id as string, title: r.title as string,
    description: (r.description as string | null) ?? null, status: r.status as ClientProjectStatus,
    progress: r.progress as number, startDate: (r.start_date as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null, visibleToClient: r.visible_to_client as boolean,
    scopeCategory: (r.scope_category as ScopeCategory | undefined) ?? null,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export async function getClientProjects(
  adminDb: SupabaseClient,
  companyId: string,
): Promise<ClientProjectFetchResult<ClientProject[]>> {
  try {
    const withScope = await adminDb.from("client_projects").select(`${BASE_COLUMNS}, scope_category`).eq("client_id", companyId).order("created_at", { ascending: false });
    if (!withScope.error) return { status: "available", data: (withScope.data ?? []).map(mapRow) };
    if (!isUndefinedColumn(withScope.error)) return { status: "unavailable", reason: classifyError("client_projects", withScope.error) };

    // scope_category ainda não existe (SQL 99 pendente) -- mesma leitura, sem o campo aditivo.
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
  input: { title: string; description?: string | null; dueDate?: string | null; visibleToClient?: boolean; scopeCategory?: ScopeCategory },
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
    const withScope = await adminDb.from("client_projects").insert({ ...basePayload, scope_category: input.scopeCategory ?? "contratado" }).select("id").single();
    if (!withScope.error) return { ok: true, id: withScope.data.id as string, scopeCategoryApplied: true };
    if (!isUndefinedColumn(withScope.error)) return { ok: false, reason: classifyError("client_projects", withScope.error) };

    // scope_category ainda não existe (SQL 99 pendente) -- grava o resto normalmente, sem o campo aditivo.
    const { data, error } = await adminDb.from("client_projects").insert(basePayload).select("id").single();
    if (error) return { ok: false, reason: classifyError("client_projects", error) };
    return { ok: true, id: data.id as string, scopeCategoryApplied: false };
  } catch (err) {
    return { ok: false, reason: classifyError("client_projects", err) };
  }
}
