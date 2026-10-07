import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { createOnboarding, updateOnboardingStatus } from "@/lib/client-onboarding/adapters";
import { ONBOARDING_STATUSES } from "@/lib/client-onboarding/types";
import type { OnboardingStatus } from "@/lib/client-onboarding/types";

/**
 * FASE 1C, seção 3/4 — cria o Onboarding de uma Company JÁ EXISTENTE
 * (handoff comercial ou manual). Nunca cria/vincula a Company em si
 * (isso é responsabilidade de outro fluxo, fora do escopo desta fase --
 * ver limitações do checkpoint). DB MIGRATION PENDING (SQL 101).
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
  const templateCodes = Array.isArray(body.templateCodes) ? body.templateCodes.filter((c): c is string => typeof c === "string") : [];
  if (templateCodes.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um template de onboarding." }, { status: 400 });
  }
  const createdFrom = body.createdFrom === "commercial_handoff" ? "commercial_handoff" : "manual";
  const commercialOpportunityId = typeof body.commercialLeadId === "string" ? body.commercialLeadId : null;

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  const result = await createOnboarding(db, auth.companyId, {
    templateCodes, createdFrom, commercialOpportunityId, ownerId: auth.userId,
  });
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Migration pendente (SQL 101) -- Onboarding ainda não disponível.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    if (result.reason === "template_conflict") {
      return NextResponse.json({ error: "Os templates escolhidos têm um requisito em comum com configuração incompatível (ex.: responsável ou visibilidade diferentes). Corrija o catálogo de templates antes de combiná-los.", code: "TEMPLATE_CONFLICT" }, { status: 409 });
    }
    return NextResponse.json({ error: result.reason === "validation_error" ? "Dados inválidos." : "Não foi possível criar o onboarding agora." }, { status: result.reason === "validation_error" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, id: result.id });
});

/**
 * FASE 1C, seção 18 — transição do status do PROCESSO de onboarding
 * (nunca confundir com status de item -- seção 1). Usada pra marcar
 * READY_FOR_KICKOFF (gate de kickoff) e COMPLETED (kickoff concluído).
 */
export const PATCH = withMutationProtection(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeClientWrite(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.onboardingId !== "string") {
    return NextResponse.json({ error: "onboardingId obrigatório" }, { status: 400 });
  }
  if (typeof body.status !== "string" || !(ONBOARDING_STATUSES as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: "status inválido" }, { status: 400 });
  }

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  // Mesma checagem de posse já usada na rota de items -- nunca confia só no onboardingId do body.
  try {
    const { data: row, error: lookupError } = await db.from("client_onboardings").select("client_id").eq("id", body.onboardingId).maybeSingle();
    if (lookupError) {
      const code = (lookupError as { code?: string }).code;
      const message = (lookupError as { message?: string }).message ?? "";
      if (code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message)) {
        return NextResponse.json({ error: "Migration pendente (SQL 101).", code: "DB_MIGRATION_PENDING" }, { status: 503 });
      }
      return NextResponse.json({ error: "Não foi possível localizar o onboarding agora." }, { status: 500 });
    }
    if (!row || row.client_id !== auth.companyId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Migration pendente (SQL 101).", code: "DB_MIGRATION_PENDING" }, { status: 503 });
  }

  const result = await updateOnboardingStatus(db, auth.companyId, body.onboardingId, body.status as OnboardingStatus);
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Migration pendente (SQL 101).", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível atualizar o onboarding agora." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
