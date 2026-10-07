import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { createClientOpportunity } from "@/lib/client-opportunities/adapters";
import type { OpportunityOrigin, OpportunityPriority } from "@/lib/client-opportunities/types";

const VALID_ORIGIN: OpportunityOrigin[] = ["meeting", "diagnostic", "client", "acompanhamento", "manual"];
const VALID_PRIORITY: OpportunityPriority[] = ["low", "normal", "high", "urgent"];

/**
 * Retomada do produto, seção 18 — Oportunidade Comercial sobre
 * client_requests (tabela já existe, nenhuma migration necessária).
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
  const origin = typeof body.origin === "string" && VALID_ORIGIN.includes(body.origin as OpportunityOrigin) ? (body.origin as OpportunityOrigin) : undefined;
  const priority = typeof body.priority === "string" && VALID_PRIORITY.includes(body.priority as OpportunityPriority) ? (body.priority as OpportunityPriority) : undefined;

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  const result = await createClientOpportunity(db, auth.companyId, auth.userId, {
    title: body.title,
    description: typeof body.description === "string" ? body.description : null,
    origin, priority,
  });
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Tabela client_requests indisponível.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: result.reason === "validation_error" ? "Dados inválidos." : "Não foi possível registrar a oportunidade agora." }, { status: result.reason === "validation_error" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, id: result.id });
});
