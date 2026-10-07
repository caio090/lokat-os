import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { createClientProject } from "@/lib/client-projects-admin/adapters";
import type { ScopeCategory } from "@/lib/client-projects-admin/types";

const VALID_SCOPE: ScopeCategory[] = ["contratado", "bonus", "planejamento", "fora_do_escopo", "orcamento_pendente", "extra_aprovado"];

/**
 * Retomada do produto, seção 4/17 — CRUD administrativo real de
 * client_projects (confirmado pela auditoria: só existia leitura no
 * portal do cliente). scopeCategory depende de SQL 99 (DB MIGRATION
 * PENDING) -- createClientProject() já degrada graciosamente sem ele.
 */
export const POST = withMutationProtection(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeClientWrite(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.title !== "string") {
    return NextResponse.json({ error: "title obrigatório" }, { status: 400 });
  }
  const scopeCategory = typeof body.scopeCategory === "string" && VALID_SCOPE.includes(body.scopeCategory as ScopeCategory)
    ? (body.scopeCategory as ScopeCategory) : undefined;

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  const result = await createClientProject(db, auth.companyId, auth.userId, {
    title: body.title,
    description: typeof body.description === "string" ? body.description : null,
    dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
    visibleToClient: typeof body.visibleToClient === "boolean" ? body.visibleToClient : undefined,
    scopeCategory,
  });
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Tabela client_projects indisponível.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: result.reason === "validation_error" ? "Dados inválidos." : "Não foi possível criar o projeto agora." }, { status: result.reason === "validation_error" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, id: result.id, scopeCategoryApplied: result.scopeCategoryApplied });
});
