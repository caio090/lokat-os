"use client";
import { useState } from "react";
import { KanbanSquare, X, Phone, Mail, MessageCircle, CalendarDays, FileText, XCircle, ArrowRightCircle, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured, createClient } from "@/lib/supabase/client";
import { convertLeadToClient } from "@/lib/commercial-leads/convert-to-client";

interface Lead {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  origin: string | null;
  interest: string | null;
  pipeline_stage: string;
  next_action: string | null;
  next_action_at: string | null;
  notes: string | null;
  lost_reason: string | null;
  created_at: string;
  /** Mapeamento real da retomada LKT (clientes/Supabase) -- client_id/converted_at já existem na tabela base, nunca precisaram de migration. */
  client_id: string | null;
  converted_at: string | null;
}

const PIPELINE_STAGES = [
  { key: "novo_lead",              label: "Novo lead",            color: "border-gray-300",   bg: "bg-gray-50",   dot: "bg-gray-400" },
  { key: "pre_qualificacao",       label: "Pré-qualificação",     color: "border-sky-300",    bg: "bg-sky-50",    dot: "bg-sky-500" },
  { key: "contato_feito",          label: "Contato feito",        color: "border-blue-300",   bg: "bg-blue-50",   dot: "bg-blue-500" },
  { key: "reuniao_agendada",       label: "Reunião agendada",     color: "border-violet-300", bg: "bg-violet-50", dot: "bg-violet-500" },
  { key: "diagnostico_realizado",  label: "Diagnóstico",          color: "border-indigo-300", bg: "bg-indigo-50", dot: "bg-indigo-500" },
  { key: "proposta_enviada",       label: "Proposta enviada",     color: "border-amber-300",  bg: "bg-amber-50",  dot: "bg-amber-500" },
  { key: "negociacao",             label: "Negociação",           color: "border-orange-300", bg: "bg-orange-50", dot: "bg-orange-500" },
  { key: "fechado",                label: "Fechado ✓",            color: "border-emerald-300",bg: "bg-emerald-50",dot: "bg-emerald-500" },
  { key: "perdido",                label: "Perdido",              color: "border-red-300",    bg: "bg-red-50",    dot: "bg-red-400" },
  { key: "onboarding",             label: "Onboarding",           color: "border-purple-300", bg: "bg-purple-50", dot: "bg-purple-500" },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

// ── Lead detail modal ─────────────────────────────────────────

function LeadModal({
  lead: initial,
  onClose,
  onUpdate,
}: {
  lead: Lead;
  onClose: () => void;
  onUpdate: (updated: Lead) => void;
}) {
  const [lead,       setLead]       = useState(initial);
  const [saving,     setSaving]     = useState(false);
  const [newNote,    setNewNote]    = useState("");
  const [nextAction, setNextAction] = useState(initial.next_action ?? "");
  const [nextAt,     setNextAt]     = useState(
    initial.next_action_at ? initial.next_action_at.slice(0, 16) : ""
  );
  const [convertError, setConvertError] = useState<string | null>(null);

  async function moveTo(stage: string) {
    if (!isSupabaseConfigured || saving) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("commercial_leads")
        .update({ pipeline_stage: stage, updated_at: new Date().toISOString() })
        .eq("id", lead.id)
        .select()
        .single();
      if (!error && data) {
        const updated = data as Lead;
        setLead(updated);
        onUpdate(updated);
      }
    } finally { setSaving(false); }
  }

  async function saveNextAction() {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("commercial_leads")
      .update({
        next_action:    nextAction || null,
        next_action_at: nextAt ? new Date(nextAt).toISOString() : null,
        notes:          newNote ? (lead.notes ? `${lead.notes}\n\n${newNote}` : newNote) : lead.notes,
        updated_at:     new Date().toISOString(),
      })
      .eq("id", lead.id)
      .select()
      .single();
    if (!error && data) {
      setLead(data as Lead);
      onUpdate(data as Lead);
      setNewNote("");
    }
  }

  async function markLost() {
    await moveTo("perdido");
  }

  /**
   * LKT (clientes/Supabase) -- o botão "Converter em cliente" só movia
   * pipeline_stage pra "fechado" (gap confirmado na auditoria: nenhum
   * registro em `clients` era criado). Lógica real extraída pra
   * src/lib/commercial-leads/convert-to-client.ts (testável com fake-db).
   */
  async function convertToClient() {
    if (!isSupabaseConfigured || saving) return;
    setConvertError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const result = await convertLeadToClient(supabase, lead, user?.id ?? null);
      if (!result.ok) { setConvertError(result.message); return; }
      setLead(result.lead as Lead);
      onUpdate(result.lead as Lead);
    } finally {
      setSaving(false);
    }
  }

  const stage = PIPELINE_STAGES.find((s) => s.key === lead.pipeline_stage);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-gray-900">{lead.company_name}</h2>
            {lead.contact_name && <p className="text-xs text-gray-400 mt-0.5">{lead.contact_name}</p>}
            {stage && (
              <span className={cn("text-[10px] font-bold mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border", stage.color, stage.bg)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", stage.dot)} />
                {stage.label}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Contacts */}
          <div className="flex flex-wrap gap-2">
            {lead.contact_phone && (
              <a href={`tel:${lead.contact_phone}`} className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1.5 rounded-xl hover:bg-gray-100">
                <Phone className="w-3 h-3" />{lead.contact_phone}
              </a>
            )}
            {lead.contact_email && (
              <a href={`mailto:${lead.contact_email}`} className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1.5 rounded-xl hover:bg-gray-100">
                <Mail className="w-3 h-3" />{lead.contact_email}
              </a>
            )}
            {lead.contact_phone && (
              <a
                href={`https://wa.me/55${lead.contact_phone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl hover:bg-emerald-100"
              >
                <MessageCircle className="w-3 h-3" />WhatsApp
              </a>
            )}
          </div>

          {/* Brief */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {lead.origin   && <div><span className="text-gray-400">Origem: </span><span className="font-medium text-gray-700">{lead.origin}</span></div>}
            {lead.interest && <div><span className="text-gray-400">Interesse: </span><span className="font-medium text-gray-700">{lead.interest}</span></div>}
            <div><span className="text-gray-400">Criado: </span><span className="font-medium text-gray-700">{fmtDate(lead.created_at)}</span></div>
          </div>

          {/* Notes history */}
          {lead.notes && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Observações</p>
              <p className="text-xs text-gray-600 leading-relaxed bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100 whitespace-pre-wrap">
                {lead.notes}
              </p>
            </div>
          )}

          {/* Next action */}
          {isSupabaseConfigured && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Próxima ação</p>
              <input
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="Ex: Ligar para fechar proposta..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-400 bg-white"
              />
              <input
                type="datetime-local"
                value={nextAt}
                onChange={(e) => setNextAt(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-400 bg-white"
              />
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Registrar contato, nota ou observação..."
                rows={2}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-400 resize-none bg-white"
              />
              <button
                onClick={saveNextAction}
                disabled={saving}
                className="w-full text-xs font-bold py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "Salvar"}
              </button>
            </div>
          )}

          {/* Stage quick-move */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Mover para etapa</p>
            <div className="flex flex-wrap gap-1.5">
              {PIPELINE_STAGES.filter((s) => s.key !== lead.pipeline_stage && s.key !== "perdido").map((s) => (
                <button
                  key={s.key}
                  onClick={() => moveTo(s.key)}
                  disabled={saving || !isSupabaseConfigured}
                  className={cn("text-[10px] font-medium px-2.5 py-1 rounded-full border transition-colors", s.color, s.bg, "hover:opacity-80 disabled:opacity-50")}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex gap-2 px-5 pb-5 pt-2 border-t border-gray-50 flex-shrink-0 flex-wrap">
          <button
            onClick={() => { alert("Agendar reunião — funcionalidade disponível em Reuniões."); }}
            className="flex items-center gap-1 text-xs font-medium px-3 py-2 border border-violet-200 text-violet-700 bg-violet-50 rounded-xl hover:bg-violet-100 transition-colors"
          >
            <CalendarDays className="w-3.5 h-3.5" />Reunião
          </button>
          <button
            onClick={() => { alert("Criar proposta — funcionalidade disponível em Propostas."); }}
            className="flex items-center gap-1 text-xs font-medium px-3 py-2 border border-amber-200 text-amber-700 bg-amber-50 rounded-xl hover:bg-amber-100 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />Proposta
          </button>
          <button
            onClick={markLost}
            disabled={saving || lead.pipeline_stage === "perdido" || !isSupabaseConfigured}
            className="flex items-center gap-1 text-xs font-medium px-3 py-2 border border-red-200 text-red-600 bg-red-50 rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />Perdido
          </button>
          {lead.pipeline_stage !== "fechado" && (
            <button
              onClick={convertToClient}
              disabled={saving || !isSupabaseConfigured}
              className="flex items-center gap-1 text-xs font-bold px-3 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 ml-auto"
            >
              <ArrowRightCircle className="w-3.5 h-3.5" />Converter em cliente
            </button>
          )}
        </div>
        {lead.client_id && (
          <p className="px-5 pb-3 text-[11px] text-emerald-600 font-medium -mt-2">✓ Já convertido em cliente</p>
        )}
        {convertError && (
          <p className="px-5 pb-3 text-[11px] text-red-600 -mt-2">{convertError}</p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function PipelineContent({ leads: initial, isDemo }: { leads: Lead[]; isDemo?: boolean }) {
  const [leads,     setLeads]     = useState<Lead[]>(initial);
  const [openLead,  setOpenLead]  = useState<Lead | null>(null);

  const byStage = (key: string) => leads.filter((l) => l.pipeline_stage === key);

  const handleUpdate = (updated: Lead) => {
    setLeads((prev) => prev.map((l) => l.id === updated.id ? updated : l));
    if (openLead?.id === updated.id) setOpenLead(updated);
  };

  const totalActive = leads.filter((l) => !["fechado", "perdido"].includes(l.pipeline_stage)).length;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-black text-gray-900 flex items-center gap-2">
          <KanbanSquare className="w-5 h-5 text-blue-600" />
          Pipeline comercial
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {totalActive} lead{totalActive !== 1 ? "s" : ""} ativo{totalActive !== 1 ? "s" : ""}
          {isDemo && <span className="ml-2 text-amber-600 text-xs">· modo demonstração</span>}
        </p>
      </div>

      {/* Horizontal scroll kanban */}
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        {PIPELINE_STAGES.map((stage) => {
          const stageLeads = byStage(stage.key);
          return (
            <div
              key={stage.key}
              className={cn("flex-shrink-0 w-56 rounded-2xl border-2 p-3", stage.color, stage.bg)}
            >
              <div className="flex items-center gap-1.5 mb-3">
                <span className={cn("w-2 h-2 rounded-full", stage.dot)} />
                <span className="text-xs font-bold text-gray-700">{stage.label}</span>
                <span className="ml-auto text-[10px] font-bold text-gray-400 bg-white px-1.5 py-0.5 rounded-full">
                  {stageLeads.length}
                </span>
              </div>

              <div className="space-y-2 min-h-[60px]">
                {stageLeads.length === 0 ? (
                  <div className="text-center py-4 text-[10px] text-gray-300">
                    Vazio
                  </div>
                ) : (
                  stageLeads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => setOpenLead(lead)}
                      className="w-full bg-white rounded-xl border border-gray-100 p-3 text-left hover:shadow-sm transition-shadow"
                    >
                      <p className="text-xs font-bold text-gray-900 truncate">{lead.company_name}</p>
                      {lead.contact_name && (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">{lead.contact_name}</p>
                      )}
                      {lead.interest && (
                        <p className="text-[10px] text-gray-500 truncate mt-0.5">↳ {lead.interest}</p>
                      )}
                      {lead.next_action_at && (
                        <p className={cn(
                          "text-[10px] mt-1.5",
                          new Date(lead.next_action_at) < new Date() ? "text-red-500 font-medium" : "text-gray-400"
                        )}>
                          <CalendarDays className="w-3 h-3 inline mr-0.5" strokeWidth={1.5} />{fmtDate(lead.next_action_at)}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>

              {isSupabaseConfigured && stage.key === "novo_lead" && (
                <button className="w-full mt-2 text-[10px] text-gray-400 hover:text-gray-600 flex items-center justify-center gap-1 py-1">
                  <Plus className="w-3 h-3" /> Adicionar
                </button>
              )}
            </div>
          );
        })}
      </div>

      {openLead && (
        <LeadModal
          lead={openLead}
          onClose={() => setOpenLead(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
