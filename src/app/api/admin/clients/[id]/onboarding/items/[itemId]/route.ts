import { NextResponse } from "next/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { authorizeClientWrite } from "@/lib/client-admin-write/authorize";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { updateOnboardingItemStatus } from "@/lib/client-onboarding/adapters";
import { ONBOARDING_ITEM_STATUSES } from "@/lib/client-onboarding/types";
import type { OnboardingItemStatus } from "@/lib/client-onboarding/types";

/**
 * FASE 1C, seção 5 — atualizar status/observações de UM item de
 * onboarding. Verifica explicitamente que o item pertence a um
 * onboarding da MESMA Company do path (nunca confia só no itemId --
 * um item de outra Company nunca pode ser tocado por aqui). DB
 * MIGRATION PENDING (SQL 101).
 */
export const PATCH = withMutationProtection(async function PATCH(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const auth = await authorizeClientWrite(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.status !== "string" || !(ONBOARDING_ITEM_STATUSES as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: "status inválido" }, { status: 400 });
  }

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : null;
  if (!db) return NextResponse.json({ error: "server_not_configured" }, { status: 503 });

  // Confirma que o item pertence a um onboarding desta MESMA Company -- nunca confia só no itemId do path/body.
  try {
    const { data: itemRow, error: lookupError } = await db
      .from("client_onboarding_items")
      .select("onboarding_id, client_onboardings!inner(client_id)")
      .eq("id", itemId)
      .maybeSingle();
    if (lookupError) {
      const code = (lookupError as { code?: string }).code;
      const message = (lookupError as { message?: string }).message ?? "";
      if (code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message)) {
        return NextResponse.json({ error: "Migration pendente (SQL 101) -- Onboarding ainda não disponível.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
      }
      return NextResponse.json({ error: "Não foi possível localizar o item agora." }, { status: 500 });
    }
    if (!itemRow) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const ownerClientId = (itemRow.client_onboardings as unknown as { client_id: string }).client_id;
    if (ownerClientId !== auth.companyId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Migration pendente (SQL 101) -- Onboarding ainda não disponível.", code: "DB_MIGRATION_PENDING" }, { status: 503 });
  }

  const result = await updateOnboardingItemStatus(db, auth.companyId, itemId, body.status as OnboardingItemStatus, {
    notes: typeof body.notes === "string" ? body.notes : undefined,
    referenceUrl: typeof body.referenceUrl === "string" ? body.referenceUrl : undefined,
    accessHolder: typeof body.accessHolder === "string" ? body.accessHolder : undefined,
  });
  if (!result.ok) {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ error: "Migration pendente (SQL 101).", code: "DB_MIGRATION_PENDING" }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível atualizar o item agora." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
