import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CompanyContextRequiredState } from "@/components/company-context-required-state";
import { resolveCompanyContext } from "@/lib/company-context/resolve";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { ONBOARDING_PROFILE_FIELDS, type OnboardingProfileRow } from "@/lib/rec-os/studio/business-context";
import { CompanyDnaForm } from "./_company-dna-form";

/**
 * FASE 31O (Admin Company DNA Editor) — editor de uma Company EXISTENTE,
 * sempre escopada por `?client=` (mesma convenção de /admin/empresa e
 * /admin/contentos/visual, nunca um segundo padrão de seleção de Company).
 * Autorização por resolveCompanyContext() -- a mesma autoridade central já
 * usada por /admin/empresa (valida role admin/super_admin/agency E que a
 * Company alvo é real e visível; nunca cria uma Company nova a partir
 * daqui, só lê). Fonte de dados: onboarding_profiles, nenhuma tabela nova.
 */
export default async function AdminEmpresaDnaPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const params = await searchParams;
  const clientId = params.client ?? null;
  const nextPath = clientId ? `/admin/empresa/dna?client=${clientId}` : "/admin/empresa/dna";

  const resolution = await resolveCompanyContext(clientId);
  if (!resolution.valid) {
    if (resolution.reason === "not_authenticated") redirect("/login");
    if (resolution.reason === "role_not_supported") redirect("/admin/dashboard");
    return (
      <>
        <PageHeader title="Company DNA" description="Editar identidade, marca, mercado e produtos de uma Company." />
        <CompanyContextRequiredState reason={resolution.reason ?? "company_required"} nextPath={nextPath} />
      </>
    );
  }
  const context = resolution.context!;

  if (!hasSupabaseServiceRoleKey()) {
    return (
      <>
        <PageHeader title="Company DNA" />
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs text-amber-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          Este recurso está temporariamente indisponível. Sua sessão continua ativa.
        </div>
      </>
    );
  }

  const adminDb = createSupabaseAdminClient();
  let profile: OnboardingProfileRow | null = null;
  try {
    const { data } = await adminDb
      .from("onboarding_profiles")
      .select(ONBOARDING_PROFILE_FIELDS.join(", "))
      .eq("client_id", context.companyId)
      .maybeSingle();
    profile = (data as unknown as OnboardingProfileRow | null) ?? null;
  } catch {
    profile = null;
  }

  return (
    <>
      <PageHeader
        title={`Company DNA · ${context.companyName ?? "Empresa"}`}
        description="Identidade, marca, mercado e produtos usados pelo Studio para gerar criativos desta Company."
      />
      <CompanyDnaForm clientId={context.companyId} companyName={context.companyName} profile={profile} />
    </>
  );
}
