/**
 * PROMPT 03, seção 5 — recuperação real de um `marketing_diagnostics`
 * sem `commercial_lead_id` (o relatório anterior só mostrava um aviso
 * visual, sem nenhum caminho de recuperação). Mesmas garantias de
 * `convertLeadToClient` (nunca escolhe ambiguidade silenciosamente,
 * nunca mascara erro de busca como "não encontrado", idempotente se já
 * vinculado) -- aqui aplicadas a diagnóstico→lead em vez de lead→cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DiagnosticForRecovery {
  id: string;
  company_name: string;
  full_name: string;
  whatsapp: string;
  commercial_lead_id: string | null;
}

export type RecoverDiagnosticLeadResult<T> =
  | { ok: true; leadId: string; leadCreated: boolean; diagnostic: T }
  | { ok: false; reason: "lookup_failed" | "ambiguous_match" | "insert_lead_failed" | "link_diagnostic_failed"; message: string; candidateLeadIds?: string[] };

export async function recoverDiagnosticLead<T extends DiagnosticForRecovery>(
  supabase: SupabaseClient,
  diagnostic: T,
  currentUserId: string | null,
): Promise<RecoverDiagnosticLeadResult<T>> {
  if (diagnostic.commercial_lead_id) {
    return { ok: true, leadId: diagnostic.commercial_lead_id, leadCreated: false, diagnostic };
  }

  const { data: candidates, error: lookupError } = await supabase
    .from("commercial_leads")
    .select("id")
    .eq("contact_phone", diagnostic.whatsapp);
  if (lookupError) {
    return { ok: false, reason: "lookup_failed", message: lookupError.message };
  }
  if ((candidates ?? []).length > 1) {
    return {
      ok: false, reason: "ambiguous_match", candidateLeadIds: (candidates ?? []).map((c) => (c as { id: string }).id),
      message: "Mais de um lead já existe com este telefone. Revise manualmente qual é o vínculo correto -- a recuperação não escolhe por conta própria.",
    };
  }

  let leadId: string | null = candidates && candidates.length === 1 ? (candidates[0] as { id: string }).id : null;
  const leadCreated = !leadId;
  if (!leadId) {
    const { data: newLead, error: insertError } = await supabase
      .from("commercial_leads")
      .insert({
        company_name: diagnostic.company_name,
        contact_name: diagnostic.full_name,
        contact_phone: diagnostic.whatsapp,
        origin: "diagnostico-marketing-recuperacao",
        pipeline_stage: "novo_lead",
        responsible_id: currentUserId,
        created_by: currentUserId,
      })
      .select("id")
      .single();
    if (insertError || !newLead) {
      return { ok: false, reason: "insert_lead_failed", message: insertError?.message ?? "Não foi possível criar o lead agora." };
    }
    leadId = newLead.id as string;
  }

  const { data: updatedDiagnostic, error: linkError } = await supabase
    .from("marketing_diagnostics")
    .update({ commercial_lead_id: leadId })
    .eq("id", diagnostic.id)
    .select()
    .single();
  if (linkError || !updatedDiagnostic) {
    return { ok: false, reason: "link_diagnostic_failed", message: linkError?.message ?? "Lead localizado/criado, mas não foi possível vincular o diagnóstico a ele." };
  }

  return { ok: true, leadId, leadCreated, diagnostic: updatedDiagnostic as unknown as T };
}
