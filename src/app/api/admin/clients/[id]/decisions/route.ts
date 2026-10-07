import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { createCompanyDecision } from "@/lib/company-decisions/adapters";
import type { CreateCompanyDecisionInput } from "@/lib/company-decisions/types";

/**
 * Retomada do produto, seção 8 — registrar uma Decisão da Company.
 * Depende de SQL 99 (DB MIGRATION PENDING) -- enquanto a migration não
 * for aplicada em Production, createCompanyDecision() degrada para
 * { ok:false, reason:"schema_not_applied" }, nunca finge sucesso.
 */
export const POST = withMutationProtection(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeClientWrite(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Partial<CreateCompanyDecisionInput>;
  try {
    body = (await req.json()) as Partial<CreateCompanyDecisionInput>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.title !== "string" || typeof body.decision !== "string") {
    return NextResponse.json({ error: "title/decision obrigatórios" }, { status: 400 });
  }

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  const result = await createCompanyDecision(db, auth.companyId, auth.userId, body as CreateCompanyDecisionInput);
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Migration pendente (SQL 99) -- Decisões ainda não disponíveis em Production.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: result.reason === "validation_error" ? "Dados inválidos." : "Não foi possível salvar a decisão agora." }, { status: result.reason === "validation_error" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, id: result.id });
});
