import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { createClientProposal } from "@/lib/client-commercial/adapters";

/**
 * Retomada do produto, seção 19 — proposta de upsell/extra para uma
 * Company já fechada. Depende de commercial_proposals.client_id
 * (SQL 99, DB MIGRATION PENDING).
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

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  const result = await createClientProposal(db, auth.companyId, auth.userId, {
    title: body.title,
    value: typeof body.value === "number" ? body.value : null,
    services: Array.isArray(body.services) ? body.services.filter((s): s is string => typeof s === "string") : undefined,
    recurrence: typeof body.recurrence === "string" ? body.recurrence : null,
    validUntil: typeof body.validUntil === "string" ? body.validUntil : null,
  });
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Migration pendente (SQL 99) -- propostas para Company já fechada ainda não disponíveis.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: result.reason === "validation_error" ? "Dados inválidos." : "Não foi possível salvar a proposta agora." }, { status: result.reason === "validation_error" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, id: result.id });
});
