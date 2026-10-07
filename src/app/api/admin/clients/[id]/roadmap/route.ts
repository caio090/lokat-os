import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { createRoadmapItem } from "@/lib/company-diagnostic/adapters";

const VALID_HORIZON = ["retrospective", "immediate", "next_window"] as const;

/**
 * Retomada do produto, seção 10/11 — "Próxima Janela": registrar uma
 * ideia (sempre planningStage="idea" na criação -- só uma Decisão
 * promove o estágio). horizon/planning_stage dependem de SQL 99
 * (DB MIGRATION PENDING) -- createRoadmapItem() já degrada
 * graciosamente (roadmap_items em si já existe, só as 3 colunas novas
 * são aditivas).
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
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title obrigatório" }, { status: 400 });
  }
  const horizon = typeof body.horizon === "string" && (VALID_HORIZON as readonly string[]).includes(body.horizon)
    ? (body.horizon as (typeof VALID_HORIZON)[number]) : undefined;

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  const result = await createRoadmapItem(db, auth.companyId, {
    title: body.title, description: typeof body.description === "string" ? body.description : null, horizon,
  });
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Migration pendente (SQL 99) -- Próxima Janela ainda não disponível.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível registrar o item agora." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: result.id });
});
