import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { createClientMeeting } from "@/lib/client-commercial/adapters";

/**
 * Retomada do produto, seção 5 — reunião para uma Company já fechada
 * (QBR, revisão mensal, upsell). Depende de commercial_meetings.client_id
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
  if (typeof body.title !== "string" || typeof body.scheduledAt !== "string") {
    return NextResponse.json({ error: "title/scheduledAt obrigatórios" }, { status: 400 });
  }

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  const result = await createClientMeeting(db, auth.companyId, auth.userId, {
    title: body.title, scheduledAt: body.scheduledAt,
    description: typeof body.description === "string" ? body.description : null,
    durationMin: typeof body.durationMin === "number" ? body.durationMin : undefined,
    meetLink: typeof body.meetLink === "string" ? body.meetLink : null,
  });
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Migration pendente (SQL 99) -- reuniões para Company já fechada ainda não disponíveis.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: result.reason === "validation_error" ? "Dados inválidos." : "Não foi possível salvar a reunião agora." }, { status: result.reason === "validation_error" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, id: result.id });
});
