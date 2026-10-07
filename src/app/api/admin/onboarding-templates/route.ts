import { NextResponse } from "next/server";
import { createServerSupabaseClient, createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { canAccessAdmin, resolveEffectiveUserRole } from "@/lib/access-control";
import { listOnboardingTemplates } from "@/lib/client-onboarding/adapters";

/**
 * FASE 1C, seção 8 — catálogo de templates de onboarding (dado de
 * referência, nunca Company-scoped -- por isso autorização simples de
 * role, sem resolveCompanyContext). DB MIGRATION PENDING (SQL 101).
 *
 * Nota: production-qa-authorization.ts/resolveRoleForCurrentUser()
 * (usado em fases anteriores) pertence à branch prompt31-work, nunca
 * mergeada em main -- não existe aqui. Esta rota usa o mesmo mecanismo
 * real já usado por resolveCompanyContext() (access-control.ts).
 */
export async function GET() {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: profile } = await session.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = resolveEffectiveUserRole({
    profileRole: profile?.role as string | undefined,
    userMetadataRole: user.user_metadata?.role as string | undefined,
    appMetadataRole: user.app_metadata?.role as string | undefined,
  });
  if (!role || !canAccessAdmin(role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = hasSupabaseServiceRoleKey() ? createSupabaseAdminClient() : session;
  const result = await listOnboardingTemplates(db);
  if (result.status === "unavailable") {
    if (result.reason === "schema_not_applied") {
      return NextResponse.json({ templates: [], code: "DB_MIGRATION_PENDING" }, { status: 200 });
    }
    return NextResponse.json({ error: "Não foi possível carregar os templates agora." }, { status: 500 });
  }
  return NextResponse.json({ templates: result.data });
}
