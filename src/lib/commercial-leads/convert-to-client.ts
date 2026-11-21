/**
 * LKT (clientes/Supabase/integração) — gap confirmado na auditoria: o
 * botão "Converter em cliente" do pipeline (operacional/comercial/
 * pipeline) só movia pipeline_stage pra "fechado", nunca criava um
 * registro em `clients` nem preenchia `commercial_leads.client_id`/
 * `converted_at` -- mesmo essas duas colunas já existindo na tabela
 * base (nenhuma migration pendente envolvida). Extraído do componente
 * client-side pra ser testável com o mesmo padrão de fake-db já usado
 * em todo o projeto (ex.: client-onboarding/adapters.ts).
 *
 * LIMITAÇÃO DOCUMENTADA (PROMPT 02, seção 11/12): `clients` NÃO tem
 * UNIQUE em email/phone hoje (confirmado via pg_constraint -- só FKs/PK/
 * CHECK existem). Isso significa que o dedup abaixo é "check-then-act":
 * protege contra o caso comum (reenvio sequencial, duplo clique seguido
 * de espera), mas NÃO é uma garantia atômica contra duas requisições
 * verdadeiramente simultâneas -- isso exigiria um índice único parcial
 * no banco, que depende de uma migration (fora do escopo desta correção,
 * já que 99/100/101 estão bloqueadas). Próximo passo real: adicionar
 * `CREATE UNIQUE INDEX ... ON clients (lower(email)) WHERE email IS NOT
 * NULL` (e equivalente pra phone) quando as migrations destravarem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeadForConversion {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  client_id: string | null;
}

export type ConvertLeadToClientResult<T> =
  | { ok: true; clientId: string; clientCreated: boolean; lead: T }
  | { ok: false; reason: "lookup_failed" | "ambiguous_match" | "insert_client_failed" | "link_lead_failed" | "no_identifier"; message: string; candidateClientIds?: string[] };

/** Busca candidatos por uma coluna -- NUNCA usa maybeSingle() (que mascararia múltiplos matches como erro genérico ou como "não encontrado"). Retorna a lista real de ids encontrados. */
async function findCandidateClientIds(
  supabase: SupabaseClient,
  column: "email" | "phone",
  value: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  const { data, error } = await supabase.from("clients").select("id").eq(column, value);
  if (error) return { ok: false, message: error.message };
  return { ok: true, ids: (data ?? []).map((r) => (r as { id: string }).id) };
}

/**
 * Dedup real por e-mail/telefone ANTES de inserir -- nunca duplica um
 * cliente já cadastrado (seção 5/10/11 do brief). Idempotente: se o
 * lead já tem client_id, não cria nada novo e retorna o mesmo id.
 *
 * Regra de ambiguidade (seção 10): se e-mail e telefone apontarem pra
 * clientes DIFERENTES, ou se qualquer uma das buscas encontrar mais de
 * um candidato, a função NUNCA escolhe silenciosamente -- retorna
 * `ambiguous_match` com os ids candidatos, pra um humano revisar o
 * vínculo. Um nome parecido nunca é usado como critério (não é
 * verificado em lugar nenhum desta função -- só email/phone exatos).
 */
export async function convertLeadToClient<T extends LeadForConversion>(
  supabase: SupabaseClient,
  lead: T,
  currentUserId: string | null,
): Promise<ConvertLeadToClientResult<T>> {
  if (lead.client_id) {
    return { ok: true, clientId: lead.client_id, clientCreated: false, lead };
  }
  if (!lead.contact_email && !lead.contact_phone) {
    return { ok: false, reason: "no_identifier", message: "Lead sem e-mail e sem telefone -- não há identificador seguro pra buscar ou evitar duplicar um cliente. Confirme manualmente antes de converter." };
  }

  const matchedIds = new Set<string>();
  if (lead.contact_email) {
    const result = await findCandidateClientIds(supabase, "email", lead.contact_email);
    if (!result.ok) return { ok: false, reason: "lookup_failed", message: result.message };
    for (const id of result.ids) matchedIds.add(id);
  }
  if (lead.contact_phone) {
    const result = await findCandidateClientIds(supabase, "phone", lead.contact_phone);
    if (!result.ok) return { ok: false, reason: "lookup_failed", message: result.message };
    for (const id of result.ids) matchedIds.add(id);
  }

  if (matchedIds.size > 1) {
    return {
      ok: false, reason: "ambiguous_match", candidateClientIds: Array.from(matchedIds),
      message: "Mais de um cliente já cadastrado corresponde a este lead (e-mail/telefone apontam pra registros diferentes). Revise manualmente qual é o vínculo correto -- a conversão não escolhe por conta própria.",
    };
  }

  let clientId: string | null = matchedIds.size === 1 ? Array.from(matchedIds)[0] : null;
  const clientCreated = !clientId;
  if (!clientId) {
    const { data: newClient, error } = await supabase
      .from("clients")
      .insert({
        company_name: lead.company_name,
        responsible_name: lead.contact_name,
        email: lead.contact_email,
        phone: lead.contact_phone,
        owner_id: currentUserId,
        created_by: currentUserId,
      })
      .select("id")
      .single();
    if (error || !newClient) {
      return { ok: false, reason: "insert_client_failed", message: error?.message ?? "Não foi possível criar o cliente agora." };
    }
    clientId = newClient.id as string;
  }

  // Falha aqui NUNCA é escondida: o cliente já existe (novo ou reaproveitado),
  // só o vínculo do lead falhou. Uma nova tentativa com o MESMO lead (client_id
  // ainda null) refaz o dedup por email/phone, encontra este mesmo cliente
  // (já "órfão" com esses dados) e vincula -- nunca cria um segundo cliente.
  const { data: updatedLead, error: updateError } = await supabase
    .from("commercial_leads")
    .update({ client_id: clientId, converted_at: new Date().toISOString(), pipeline_stage: "fechado", updated_at: new Date().toISOString() })
    .eq("id", lead.id)
    .select()
    .single();
  if (updateError || !updatedLead) {
    return { ok: false, reason: "link_lead_failed", message: updateError?.message ?? "Cliente criado, mas não foi possível vincular este lead a ele. Tentar converter novamente deve reaproveitar o mesmo cliente, nunca criar outro." };
  }

  return { ok: true, clientId, clientCreated, lead: updatedLead as unknown as T };
}
