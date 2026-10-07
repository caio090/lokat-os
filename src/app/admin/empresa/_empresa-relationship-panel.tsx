"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lightbulb, Scale, Users, FileText, Target, FolderKanban, History, Plus, Loader2, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import type { CompanyDecision } from "@/lib/company-decisions/types";
import type { DecisionFetchResult } from "@/lib/company-decisions/types";
import type { RoadmapItem } from "@/lib/company-diagnostic/types";
import type { SourceFetchResult } from "@/lib/company-diagnostic/types";
import type { ClientTimelineEntry, TimelineFetchResult } from "@/lib/client-timeline/types";
import type { ClientOpportunity, OpportunityFetchResult } from "@/lib/client-opportunities/types";
import type { ClientProject, ClientProjectFetchResult } from "@/lib/client-projects-admin/types";
import type { ClientMeeting, ClientProposal, ClientCommercialFetchResult } from "@/lib/client-commercial/types";

/**
 * Retomada do produto ("cliente como centro do sistema") — painel de
 * relacionamento dentro de /admin/empresa (página central escolhida
 * como canônica nesta fase). Seis blocos novos: Decisões, Próxima
 * Janela, Relacionamento Comercial (reunião/proposta pós-venda),
 * Oportunidades, Projetos do Cliente (escopo) e Timeline.
 *
 * Alguns blocos dependem de docs/supabase/99-company-decisions-and-relationship-links.sql
 * (DB MIGRATION PENDING em Production no momento em que este código
 * foi escrito -- o gate de escrita do conector Supabase recusou a
 * aplicação). Cada bloco mostra um banner "Migration pendente" honesto
 * quando o backend ainda não suporta a operação -- nunca finge que
 * funcionou (mesmo princípio "no hallucination" já usado em
 * company-diagnostic/adapters.ts).
 */

function PendingMigrationBanner({ label }: { label: string }) {
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
      <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-amber-700">
        <span className="font-bold">Migration pendente (SQL 99).</span> {label} depende de uma migration ainda não aplicada em Production. O código já está pronto -- assim que a migration for aplicada, esta seção passa a funcionar sem nenhuma mudança adicional.
      </p>
    </div>
  );
}

function SectionShell({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {title}
      </h2>
      {children}
    </section>
  );
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string; code?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: typeof data?.error === "string" ? data.error : "Erro desconhecido.", code: data?.code };
    return { ok: true };
  } catch {
    return { ok: false, error: "Erro de conexão." };
  }
}

export function EmpresaRelationshipPanel({
  companyId, decisionsResult, roadmapResult, timelineResult, opportunitiesResult, clientProjectsResult, meetingsResult, proposalsResult, activeOnboardingId,
}: {
  companyId: string;
  decisionsResult: DecisionFetchResult<CompanyDecision[]>;
  roadmapResult: SourceFetchResult<RoadmapItem[]>;
  timelineResult: TimelineFetchResult<ClientTimelineEntry[]>;
  opportunitiesResult: OpportunityFetchResult<ClientOpportunity[]>;
  clientProjectsResult: ClientProjectFetchResult<ClientProject[]>;
  meetingsResult: ClientCommercialFetchResult<ClientMeeting[]>;
  proposalsResult: ClientCommercialFetchResult<ClientProposal[]>;
  /** FASE 1C, seção 7 -- quando existe um onboarding ativo, a reunião agendada pode ser marcada como a reunião de alinhamento dele (reaproveita esta mesma entidade de reunião, nunca um sistema paralelo). */
  activeOnboardingId?: string | null;
}) {
  return (
    <>
      <DecisionsSection companyId={companyId} result={decisionsResult} />
      <NextWindowSection companyId={companyId} result={roadmapResult} />
      <CommercialRelationshipSection companyId={companyId} meetingsResult={meetingsResult} proposalsResult={proposalsResult} activeOnboardingId={activeOnboardingId ?? null} />
      <OpportunitiesSection companyId={companyId} result={opportunitiesResult} />
      <ClientProjectsSection companyId={companyId} result={clientProjectsResult} />
      <TimelineSection result={timelineResult} />
    </>
  );
}

// ── Decisões ──────────────────────────────────────────────────

const ORIGIN_LABEL: Record<string, string> = {
  meeting: "Reunião", diagnostic: "Diagnóstico", client: "Cliente", strategy: "Estratégia",
  approval: "Aprovação", project_review: "Revisão de projeto", campaign_result: "Resultado de campanha", manual: "Manual",
};
const VALIDATION_LABEL: Record<string, string> = {
  internal: "Decisão interna", client_view: "Cliente toma ciência", client_approval: "Cliente precisa aprovar",
  client_choice: "Cliente precisa escolher", needs_meeting: "Precisa de reunião",
};

function DecisionsSection({ companyId, result }: { companyId: string; result: DecisionFetchResult<CompanyDecision[]> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [decision, setDecision] = useState("");
  const [origin, setOrigin] = useState("manual");
  const [clientValidation, setClientValidation] = useState("internal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await postJson(`/api/admin/clients/${encodeURIComponent(companyId)}/decisions`, { title, decision, origin, clientValidation });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Erro"); return; }
    setTitle(""); setDecision(""); setOpen(false);
    router.refresh();
  }

  const active = result.status === "available" ? result.data.filter((d) => d.status === "active") : [];
  const superseded = result.status === "available" ? result.data.filter((d) => d.status === "superseded") : [];

  return (
    <SectionShell icon={Scale} title="Decisões">
      {result.status === "unavailable" && result.reason === "schema_not_applied" && <PendingMigrationBanner label="O Decision Ledger da Company" />}
      {result.status === "unavailable" && result.reason === "internal_error" && <p className="text-xs text-red-600">Não foi possível carregar as decisões agora.</p>}
      {result.status === "available" && (
        <div className="space-y-2 mb-3">
          {active.length === 0 && <p className="text-xs text-gray-400">Nenhuma decisão ativa registrada.</p>}
          {active.map((d) => (
            <div key={d.id} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-gray-800">{d.title}</p>
                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{ORIGIN_LABEL[d.origin] ?? d.origin}</span>
              </div>
              <p className="text-xs text-gray-600 mt-1">{d.decision}</p>
              <p className="text-[10px] text-gray-400 mt-1">{VALIDATION_LABEL[d.clientValidation] ?? d.clientValidation} · decidido em {new Date(d.decidedOn).toLocaleDateString("pt-BR")}</p>
            </div>
          ))}
          {superseded.length > 0 && (
            <p className="text-[10px] text-gray-400">{superseded.length} decisão(ões) substituída(s) no histórico.</p>
          )}
        </div>
      )}
      {result.status !== "unavailable" || result.reason !== "schema_not_applied" ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Registrar decisão
        </button>
      ) : null}
      {open && (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" className={inputCls} />
          <textarea value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="O que foi decidido" rows={2} className={inputCls} />
          <div className="flex gap-2">
            <select value={origin} onChange={(e) => setOrigin(e.target.value)} className={inputCls}>
              {Object.entries(ORIGIN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={clientValidation} onChange={(e) => setClientValidation(e.target.value)} className={inputCls}>
              {Object.entries(VALIDATION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <SaveButton onClick={submit} disabled={!title.trim() || !decision.trim()} saving={saving} />
          {error && <p className="text-[10px] text-red-600">{error}</p>}
        </div>
      )}
    </SectionShell>
  );
}

// ── Próxima Janela ────────────────────────────────────────────

const HORIZON_LABEL: Record<string, string> = { retrospective: "Retrospectiva", immediate: "Imediato", next_window: "Próxima janela" };
const PLANNING_STAGE_LABEL: Record<string, string> = {
  idea: "Ideia", pre_planning: "Pré-planejamento", in_analysis: "Em análise",
  awaiting_decision: "Aguardando decisão", approved: "Aprovado", cancelled: "Cancelado",
};

function NextWindowSection({ companyId, result }: { companyId: string; result: SourceFetchResult<RoadmapItem[]> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [horizon, setHorizon] = useState<"retrospective" | "immediate" | "next_window">("next_window");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await postJson(`/api/admin/clients/${encodeURIComponent(companyId)}/roadmap`, { title, horizon });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Erro"); return; }
    setTitle(""); setOpen(false);
    router.refresh();
  }

  const usingHorizon = result.status === "available" && result.data.some((r) => "horizon" in r);
  const byHorizon = result.status === "available"
    ? { retrospective: result.data.filter((r) => r.horizon === "retrospective"), immediate: result.data.filter((r) => r.horizon === "immediate"), next_window: result.data.filter((r) => r.horizon === "next_window") }
    : null;

  return (
    <SectionShell icon={Lightbulb} title="Próxima Janela — planejamento contínuo">
      {result.status === "unavailable" && result.reason === "schema_not_applied" && <PendingMigrationBanner label="O agrupamento por horizonte (retrospectiva/imediato/próxima janela)" />}
      {result.status === "unavailable" && result.reason === "internal_error" && <p className="text-xs text-red-600">Não foi possível carregar o roadmap agora.</p>}
      {result.status === "available" && byHorizon && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {(["retrospective", "immediate", "next_window"] as const).map((h) => (
            <div key={h}>
              <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-1.5">{HORIZON_LABEL[h]}</p>
              <div className="space-y-1.5">
                {byHorizon[h].length === 0 && <p className="text-[11px] text-gray-300">Nada ainda.</p>}
                {byHorizon[h].map((item) => (
                  <div key={item.id} className="border border-gray-100 rounded-lg p-2">
                    <p className="text-xs font-medium text-gray-700">{item.title}</p>
                    <p className="text-[10px] text-gray-400">{PLANNING_STAGE_LABEL[item.planningStage] ?? item.planningStage}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {!usingHorizon && result.status === "available" && result.data.length > 0 && (
        <p className="text-[11px] text-gray-400 mb-2">{result.data.length} item(ns) de roadmap sem horizonte classificado (anteriores a esta fase).</p>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
        <Plus className="w-3 h-3" /> Adicionar ideia
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da ideia" className={inputCls} />
          <select value={horizon} onChange={(e) => setHorizon(e.target.value as typeof horizon)} className={inputCls}>
            {Object.entries(HORIZON_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <SaveButton onClick={submit} disabled={!title.trim()} saving={saving} />
          {error && <p className="text-[10px] text-red-600">{error}</p>}
        </div>
      )}
    </SectionShell>
  );
}

// ── Relacionamento Comercial (reunião/proposta pós-venda) ──────

function CommercialRelationshipSection({
  companyId, meetingsResult, proposalsResult, activeOnboardingId,
}: { companyId: string; meetingsResult: ClientCommercialFetchResult<ClientMeeting[]>; proposalsResult: ClientCommercialFetchResult<ClientProposal[]>; activeOnboardingId: string | null }) {
  const router = useRouter();
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [isAlignmentMeeting, setIsAlignmentMeeting] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitMeeting() {
    setSaving(true);
    setError(null);
    const res = await postJson(`/api/admin/clients/${encodeURIComponent(companyId)}/meetings`, {
      title: meetingTitle, scheduledAt: meetingDate ? new Date(meetingDate).toISOString() : new Date().toISOString(),
      ...(isAlignmentMeeting && activeOnboardingId ? { onboardingId: activeOnboardingId, isAlignmentMeeting: true } : {}),
    });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Erro"); return; }
    setMeetingTitle(""); setMeetingDate(""); setIsAlignmentMeeting(false); setMeetingOpen(false);
    router.refresh();
  }
  async function submitProposal() {
    setSaving(true);
    setError(null);
    const res = await postJson(`/api/admin/clients/${encodeURIComponent(companyId)}/proposals`, { title: proposalTitle });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Erro"); return; }
    setProposalTitle(""); setProposalOpen(false);
    router.refresh();
  }

  const pending = meetingsResult.status === "unavailable" && meetingsResult.reason === "schema_not_applied";

  return (
    <SectionShell icon={Users} title="Relacionamento comercial (reuniões e propostas com esta Company)">
      {pending && <PendingMigrationBanner label="Reuniões e propostas para uma Company já fechada" />}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-1.5">Reuniões</p>
          {meetingsResult.status === "available" && (
            <div className="space-y-1.5 mb-2">
              {meetingsResult.data.length === 0 && <p className="text-[11px] text-gray-300">Nenhuma reunião registrada.</p>}
              {meetingsResult.data.map((m) => (
                <div key={m.id} className="border border-gray-100 rounded-lg p-2">
                  <p className="text-xs font-medium text-gray-700">{m.title}</p>
                  <p className="text-[10px] text-gray-400">{new Date(m.scheduledAt).toLocaleString("pt-BR")} · {m.status}</p>
                </div>
              ))}
            </div>
          )}
          {!pending && (
            <>
              <button type="button" onClick={() => setMeetingOpen((v) => !v)} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Agendar reunião
              </button>
              {meetingOpen && (
                <div className="mt-2 space-y-2">
                  <input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} placeholder="Título (ex.: Revisão mensal)" className={inputCls} />
                  <input type="datetime-local" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className={inputCls} />
                  {activeOnboardingId && (
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <input type="checkbox" checked={isAlignmentMeeting} onChange={(e) => setIsAlignmentMeeting(e.target.checked)} />
                      Esta é a reunião de alinhamento do onboarding
                    </label>
                  )}
                  <SaveButton onClick={submitMeeting} disabled={!meetingTitle.trim()} saving={saving} />
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-1.5">Propostas</p>
          {proposalsResult.status === "available" && (
            <div className="space-y-1.5 mb-2">
              {proposalsResult.data.length === 0 && <p className="text-[11px] text-gray-300">Nenhuma proposta registrada.</p>}
              {proposalsResult.data.map((p) => (
                <div key={p.id} className="border border-gray-100 rounded-lg p-2">
                  <p className="text-xs font-medium text-gray-700">{p.title}</p>
                  <p className="text-[10px] text-gray-400">{p.status}</p>
                </div>
              ))}
            </div>
          )}
          {!pending && (
            <>
              <button type="button" onClick={() => setProposalOpen((v) => !v)} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Nova proposta (upsell/extra)
              </button>
              {proposalOpen && (
                <div className="mt-2 space-y-2">
                  <input value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} placeholder="Título (ex.: 2 vídeos extras)" className={inputCls} />
                  <SaveButton onClick={submitProposal} disabled={!proposalTitle.trim()} saving={saving} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {error && <p className="text-[10px] text-red-600 mt-2">{error}</p>}
    </SectionShell>
  );
}

// ── Oportunidades ─────────────────────────────────────────────

function OpportunitiesSection({ companyId, result }: { companyId: string; result: OpportunityFetchResult<ClientOpportunity[]> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [origin, setOrigin] = useState<"meeting" | "diagnostic" | "client" | "acompanhamento" | "manual">("manual");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await postJson(`/api/admin/clients/${encodeURIComponent(companyId)}/opportunities`, { title, origin });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Erro"); return; }
    setTitle(""); setOpen(false);
    router.refresh();
  }

  return (
    <SectionShell icon={Target} title="Oportunidades">
      {result.status === "unavailable" && result.reason === "schema_not_applied" && <PendingMigrationBanner label="Oportunidades" />}
      {result.status === "unavailable" && result.reason === "internal_error" && <p className="text-xs text-red-600">Não foi possível carregar as oportunidades agora.</p>}
      {result.status === "available" && (
        <div className="space-y-1.5 mb-2">
          {result.data.length === 0 && <p className="text-xs text-gray-400">Nenhuma oportunidade registrada.</p>}
          {result.data.map((o) => (
            <div key={o.id} className="border border-gray-100 rounded-xl p-2.5 flex items-center justify-between gap-2">
              <p className="text-sm text-gray-700">{o.title}</p>
              <span className="text-[10px] font-bold text-gray-400">{o.status}</span>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
        <Plus className="w-3 h-3" /> Registrar oportunidade
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: 2 vídeos adicionais" className={inputCls} />
          <select value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)} className={inputCls}>
            <option value="manual">Manual</option>
            <option value="meeting">Reunião</option>
            <option value="diagnostic">Diagnóstico</option>
            <option value="client">Cliente</option>
            <option value="acompanhamento">Acompanhamento</option>
          </select>
          <SaveButton onClick={submit} disabled={!title.trim()} saving={saving} />
          {error && <p className="text-[10px] text-red-600">{error}</p>}
        </div>
      )}
    </SectionShell>
  );
}

// ── Projetos do Cliente (Escopo) ──────────────────────────────

const SCOPE_LABEL: Record<string, string> = {
  contratado: "Contratado", bonus: "Bônus", planejamento: "Planejamento (sem execução)",
  fora_do_escopo: "Fora do escopo", orcamento_pendente: "Orçamento pendente", extra_aprovado: "Extra aprovado",
};

function ClientProjectsSection({ companyId, result }: { companyId: string; result: ClientProjectFetchResult<ClientProject[]> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [scopeCategory, setScopeCategory] = useState("contratado");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const scopeSupported = result.status === "available" && result.data.some((p) => p.scopeCategory !== null);

  async function submit() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/admin/clients/${encodeURIComponent(companyId)}/projects`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, scopeCategory }),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) { setError(data?.error ?? "Erro"); return; }
    if (data?.scopeCategoryApplied === false) setNotice("Projeto criado. Categoria de escopo será aplicada assim que a migration (SQL 99) estiver em Production.");
    setTitle(""); setOpen(false);
    router.refresh();
  }

  return (
    <SectionShell icon={FolderKanban} title="Projetos do cliente (escopo)">
      {result.status === "unavailable" && result.reason === "internal_error" && <p className="text-xs text-red-600">Não foi possível carregar os projetos agora.</p>}
      {result.status === "available" && (
        <div className="space-y-1.5 mb-2">
          {result.data.length === 0 && <p className="text-xs text-gray-400">Nenhum projeto do cliente registrado ainda.</p>}
          {result.data.map((p) => (
            <div key={p.id} className="border border-gray-100 rounded-xl p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-700 truncate">{p.title}</p>
                  <p className="text-[10px] text-gray-400 flex flex-wrap gap-x-1.5">
                    {p.projectType && <span>{p.projectType}</span>}
                    {p.scopeCategory && <span>{SCOPE_LABEL[p.scopeCategory] ?? p.scopeCategory}</span>}
                    {p.currentPhase && <span>{p.currentPhase}</span>}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-[10px] font-bold text-gray-400">{p.status}</span>
                  <p className="text-[10px] text-gray-400">{p.progress}%</p>
                </div>
              </div>
              {/* FASE 1C, seção 19 -- "não tentar criar um Jira inteiro": só o essencial pra entender onde o projeto está travado. */}
              {(p.nextAction || p.blockedReason || p.clientDependency || p.dueDate) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] pt-1 border-t border-gray-50">
                  {p.nextAction && <span className="text-indigo-600">Próxima ação: {p.nextAction}</span>}
                  {p.blockedReason && <span className="text-red-600">Bloqueio: {p.blockedReason}</span>}
                  {p.clientDependency && <span className="text-amber-600">Depende do cliente: {p.clientDependency}</span>}
                  {p.dueDate && <span className="text-gray-400">Prazo: {new Date(p.dueDate).toLocaleDateString("pt-BR")}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {result.status === "available" && !scopeSupported && (
        <p className="text-[11px] text-amber-600 mb-2">Categoria de escopo ainda não disponível (migration SQL 99 pendente) -- projetos continuam sendo criados normalmente.</p>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
        <Plus className="w-3 h-3" /> Novo projeto
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do projeto" className={inputCls} />
          <select value={scopeCategory} onChange={(e) => setScopeCategory(e.target.value)} className={inputCls}>
            {Object.entries(SCOPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <SaveButton onClick={submit} disabled={!title.trim()} saving={saving} />
          {error && <p className="text-[10px] text-red-600">{error}</p>}
          {notice && <p className="text-[10px] text-amber-600">{notice}</p>}
        </div>
      )}
    </SectionShell>
  );
}

// ── Timeline ──────────────────────────────────────────────────

function TimelineSection({ result }: { result: TimelineFetchResult<ClientTimelineEntry[]> }) {
  const [expanded, setExpanded] = useState(false);
  if (result.status === "unavailable") {
    return (
      <SectionShell icon={History} title="Histórico">
        <p className="text-xs text-red-600">Não foi possível carregar o histórico agora.</p>
      </SectionShell>
    );
  }
  const entries = expanded ? result.data : result.data.slice(0, 8);
  return (
    <SectionShell icon={History} title="Histórico">
      {entries.length === 0 && <p className="text-xs text-gray-400">Nenhuma atividade registrada ainda para esta Company.</p>}
      <div className="space-y-1.5">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center gap-2 text-xs text-gray-600">
            <FileText className="w-3 h-3 text-gray-300 flex-shrink-0" />
            <span className="text-gray-400">{new Date(e.createdAt).toLocaleString("pt-BR")}</span>
            <span>{e.action}</span>
            <span className="text-gray-300">· {e.entityType}</span>
          </div>
        ))}
      </div>
      {result.data.length > 8 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1 mt-2">
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} {expanded ? "Ver menos" : `Ver todas (${result.data.length})`}
        </button>
      )}
    </SectionShell>
  );
}

// ── Shared bits ───────────────────────────────────────────────

const inputCls = "w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-300 bg-white placeholder-gray-400";

function SaveButton({ onClick, disabled, saving }: { onClick: () => void; disabled: boolean; saving: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || saving}
      className="text-[11px] font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg disabled:bg-gray-200 disabled:text-gray-400 flex items-center gap-1.5">
      {saving && <Loader2 className="w-3 h-3 animate-spin" />} Salvar
    </button>
  );
}
