/**
 * Retomada do produto — autorização compartilhada pelas novas rotas de
 * escrita Company-scoped (Decisões, Reuniões, Propostas, Projetos,
 * Oportunidades, Próxima Janela). Reaproveita resolveCompanyContext()
 * (a mesma autoridade já usada por /admin/empresa e pelo Studio em
 * /api/studio/images/generate) -- nunca uma segunda lógica de
 * autorização paralela.
 */
import { resolveCompanyContext } from "@/lib/company-context/resolve";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ClientWriteAuthResult =
  | { ok: true; companyId: string; userId: string | null }
  | { ok: false; status: 401 | 403; error: string };

export async function authorizeClientWrite(clientId: string): Promise<ClientWriteAuthResult> {
  const resolution = await resolveCompanyContext(clientId);
  if (!resolution.valid || !resolution.context) {
    const unauthorized = resolution.reason === "role_not_supported";
    return {
      ok: false,
      status: unauthorized ? 403 : 401,
      error: unauthorized ? "Sem permissão para esta Company." : "Sessão/Company necessária.",
    };
  }
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  return { ok: true, companyId: resolution.context.companyId, userId: user?.id ?? null };
}
