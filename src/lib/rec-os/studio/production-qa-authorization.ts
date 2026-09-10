/**
 * FASE 31G.2 (Production-Safe QA Mode) — autorização do `qaMode:
 * "dry_run"` opcional no request de /api/studio/images/generate.
 * NUNCA confia no cliente: mesmo que o request diga `qaMode:"dry_run"`,
 * o servidor só honra quando TODAS as três condições são verdadeiras:
 * (1) feature flag `LKT_PRODUCTION_QA_DRY_RUN` ligada, (2) usuário
 * autenticado, (3) role resolvida server-side é admin/super_admin
 * (`canAccessAdmin`, a autoridade central de src/lib/access-control.ts
 * -- nunca um Set de roles duplicado aqui).
 *
 * Mesmo padrão já estabelecido em api/debug/_require-admin.ts
 * (decisão pura separada do único ponto assíncrono que busca
 * user/role reais) -- não importado diretamente porque aquele arquivo
 * é deliberadamente escopado só ao namespace /api/debug/ (ver seu
 * próprio comentário); aqui a MESMA autoridade central
 * (canAccessAdmin) é reaproveitada, nunca uma segunda lista de roles.
 */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canAccessAdmin } from "@/lib/access-control";

export type ProductionQaAccessDecision = "allowed" | "unauthenticated" | "forbidden" | "flag_disabled";

/** Só ativa a POSSIBILIDADE de qaMode=dry_run em Production -- nunca ativa dry run globalmente por si só (ver evaluateProductionQaAccess). */
export function isProductionQaFlagEnabled(): boolean {
  const raw = process.env.LKT_PRODUCTION_QA_DRY_RUN?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Pura -- testável sem sessão/banco. `requested=false` (qaMode ausente
 * do request) nunca chega a avaliar nada além disso -- comportamento
 * normal é sempre preservado nesse caso (FASE 31G.2 §2).
 */
export function evaluateProductionQaAccess(inputs: {
  requested: boolean;
  flagEnabled: boolean;
  authenticated: boolean;
  role: string | null;
}): ProductionQaAccessDecision | "not_requested" {
  if (!inputs.requested) return "not_requested";
  if (!inputs.flagEnabled) return "flag_disabled";
  if (!inputs.authenticated) return "unauthenticated";
  if (!inputs.role || !canAccessAdmin(inputs.role)) return "forbidden";
  return "allowed";
}

/**
 * Único ponto assíncrono -- busca a role REAL do usuário autenticado
 * (profiles.role, com fallback pro metadata da sessão, mesma
 * precedência do resto do projeto). Usado só quando o request está em
 * Free Mode (Company Mode já resolve `role` via
 * resolveCompanyContext() -- nunca uma segunda query nesse caso).
 * Nunca lança -- ausência de sessão/erro vira `null` (forbidden).
 */
export async function resolveRoleForCurrentUser(): Promise<string | null> {
  try {
    const session = await createServerSupabaseClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return null;
    const { data: profile } = await session.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return (
      (profile?.role as string | undefined) ??
      (user.user_metadata?.role as string | undefined) ??
      (user.app_metadata?.role as string | undefined) ??
      null
    );
  } catch {
    return null;
  }
}
