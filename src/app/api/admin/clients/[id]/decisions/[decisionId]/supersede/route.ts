import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { supersedeCompanyDecision } from "@/lib/company-decisions/adapters";
import type { CreateCompanyDecisionInput } from "@/lib/company-decisions/types";

/**
 * Retomada do produto, seção 8 — "mudar de posição" nunca reescreve a
 * decisão antiga; sempre via company_supersede_decision() (SQL 99,
 * DB MIGRATION PENDING), atômico.
 */
export const POST = withMutationProtection(async function POST(req: Request, { params }: { params: Promise<{ id: string; decisionId: string }> }) {
  const { id, decisionId } = await params;
  const auth = await authorizeClientWrite(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Partial<CreateCompanyDecisionInput>;
  try {
    body = (await req.json()) as Partial<CreateCompanyDecisionInput>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.decision !== "string") {
    return NextResponse.json({ error: "decision obrigatório" }, { status: 400 });
  }

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  const result = await supersedeCompanyDecision(db, decisionId, auth.companyId, body as CreateCompanyDecisionInput);
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Migration pendente (SQL 99).", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: result.reason === "validation_error" ? "Dados inválidos." : "Não foi possível substituir a decisão agora." }, { status: result.reason === "validation_error" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, id: result.id });
});
