import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateMarketingDiagnosticScore, normalizeWhatsapp, type MarketingDiagnosticInput } from "@/lib/marketing-diagnostic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: NextRequest) {
  let body: Partial<MarketingDiagnosticInput> & { utm_source?: string; utm_medium?: string; utm_campaign?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const { full_name, company_name, whatsapp, business_type, main_problem, marketing_responsible, instagram, best_contact_time, utm_source, utm_medium, utm_campaign } = body;

  if (!full_name?.trim())    return NextResponse.json({ error: "Nome obrigatório" }, { status: 422 });
  if (!company_name?.trim()) return NextResponse.json({ error: "Empresa obrigatória" }, { status: 422 });
  if (!whatsapp?.trim())     return NextResponse.json({ error: "WhatsApp obrigatório" }, { status: 422 });
  if (!business_type?.trim()) return NextResponse.json({ error: "Tipo de negócio obrigatório" }, { status: 422 });
  if (!main_problem?.trim()) return NextResponse.json({ error: "Problema principal obrigatório" }, { status: 422 });

  const normalizedPhone = normalizeWhatsapp(whatsapp);
  if (normalizedPhone.length < 10) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 422 });

  const supabase = adminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Serviço indisponível" }, { status: 503 });
  }

  const input: MarketingDiagnosticInput = {
    full_name: full_name.trim(),
    company_name: company_name.trim(),
    instagram: instagram?.trim() ?? "",
    whatsapp: normalizedPhone,
    best_contact_time: best_contact_time?.trim() ?? "",
    business_type,
    marketing_responsible: marketing_responsible ?? "",
    main_problem,
  };

  const { lead_score, lead_temperature, offer_suggestion, advice } = calculateMarketingDiagnosticScore(input);

  // 1. Salvar diagnóstico
  const { data: diag, error: diagError } = await supabase
    .from("marketing_diagnostics")
    .insert({
      ...input,
      lead_score,
      lead_temperature,
      offer_suggestion,
      advice,
      utm_source,
      utm_medium,
      utm_campaign,
      raw_payload: body,
    })
    .select("id")
    .single();

  if (diagError) {
    console.error("[marketing-diagnostics] Insert error:", diagError.message);
    return NextResponse.json({ error: "Erro ao salvar diagnóstico. Tente novamente." }, { status: 500 });
  }

  // 2. Criar lead em commercial_leads (best-effort -- mas cada operação
  // checa `error` explicitamente, nunca confia só em try/catch: o
  // cliente Supabase normalmente RETORNA um erro em vez de lançar
  // exceção, então um try/catch sozinho deixava passar falha de
  // lookup/insert/update em silêncio completo (PROMPT 02, seção 14/15).
  // Se o LOOKUP falhar, nunca cai pro "senão" e cria um lead novo --
  // isso poderia duplicar exatamente no caso em que o dedup falhou.
  let leadId: string | null = null;
  const { data: existingLead, error: lookupError } = await supabase
    .from("commercial_leads")
    .select("id")
    .eq("contact_phone", normalizedPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    console.error("[marketing-diagnostics] falha ao buscar lead existente (diagnóstico salvo, SEM lead vinculado -- visível em /admin/diagnosticos como 'sem lead')", { diagId: diag?.id, phone: normalizedPhone, error: lookupError.message });
  } else if (existingLead) {
    leadId = existingLead.id as string;
    const { error: updateLeadError } = await supabase.from("commercial_leads").update({
      notes: `[Diagnóstico de Marketing Local — ${new Date().toLocaleDateString("pt-BR")}]\nOferta: ${offer_suggestion}\nConselho: ${advice}\nProblema: ${main_problem}\nTemperatura: ${lead_temperature}`,
      pipeline_stage: "diagnostico_realizado",
    }).eq("id", existingLead.id);
    if (updateLeadError) console.error("[marketing-diagnostics] lead existente encontrado, mas falha ao atualizar notas/estágio", { leadId, error: updateLeadError.message });
  } else {
    const { data: newLead, error: insertLeadError } = await supabase
      .from("commercial_leads")
      .insert({
        company_name: input.company_name,
        contact_name: input.full_name,
        contact_phone: normalizedPhone,
        origin: "diagnostico-marketing",
        interest: offer_suggestion,
        pipeline_stage: "novo_lead",
        notes: `[Diagnóstico de Marketing Local]\nProblema: ${main_problem}\nOferta sugerida: ${offer_suggestion}\nConselho: ${advice}\nTemperatura: ${lead_temperature}`,
      })
      .select("id")
      .single();
    if (insertLeadError || !newLead) {
      console.error("[marketing-diagnostics] falha ao criar lead (diagnóstico salvo, SEM lead vinculado -- visível em /admin/diagnosticos como 'sem lead')", { diagId: diag?.id, error: insertLeadError?.message });
    } else {
      leadId = newLead.id as string;
    }
  }

  // Vincular diagnóstico ao lead -- se falhar, o diagnóstico fica
  // visivelmente "sem lead" em /admin/diagnosticos (commercial_lead_id
  // IS NULL já é o sinal de recuperação existente, sem precisar de
  // nenhuma coluna/tabela nova).
  if (leadId && diag?.id) {
    const { error: linkError } = await supabase.from("marketing_diagnostics").update({ commercial_lead_id: leadId }).eq("id", diag.id);
    if (linkError) console.error("[marketing-diagnostics] lead criado/encontrado, mas falha ao vincular ao diagnóstico", { diagId: diag.id, leadId, error: linkError.message });
  }

  // 3. Criar notificação admin (best-effort)
  try {
    await supabase.from("notifications").insert({
      recipient_role: "admin",
      type: "novo_diagnostico_marketing",
      title: `Novo diagnóstico: ${input.company_name}`,
      message: `${input.full_name} respondeu o Diagnóstico de Marketing Local. Temperatura: ${lead_temperature}. Oferta: ${offer_suggestion}.`,
      href: "/admin/diagnosticos",
    });
  } catch (e) {
    console.error("[marketing-diagnostics] Notification error:", e);
  }

  return NextResponse.json({
    success: true,
    id: diag?.id,
    lead_score,
    lead_temperature,
    offer_suggestion,
    advice,
  });
}
