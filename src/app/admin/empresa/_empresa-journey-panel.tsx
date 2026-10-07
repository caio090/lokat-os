"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, Circle, Dot, Loader2, AlertCircle, Plus, Users, Clock, CalendarClock, Target, Phone,
} from "lucide-react";
import type { ClientJourneyFetchResult } from "@/lib/client-journey/types";
import type { OnboardingFetchResult, OnboardingSummary, ClientOnboardingItem, OnboardingTemplate, OnboardingItemStatus } from "@/lib/client-onboarding/types";
import { ONBOARDING_ITEM_STATUSES } from "@/lib/client-onboarding/types";
import type { ClientHealthFetchResult } from "@/lib/client-health/types";

/**
 * FASE 1C — Jornada do Cliente (seção 10/11/12/15/16). Visão macro
 * (Comercial/Contrato/Onboarding/Kickoff/Operação/Acompanhamento) +
 * resumo de onboarding (progresso, aguardando cliente/LOKAT, bloqueios,
 * próxima ação, próxima reunião) + saúde do relacionamento. Onboarding
 * inteiro depende de SQL 101 (DB MIGRATION PENDING) -- degrada
 * honestamente com um banner, nunca finge que existe.
 */

type JourneyStepState = "done" | "active" | "pending";
const STEP_LABELS = ["Comercial", "Contrato", "Onboarding", "Kickoff", "Operação", "Acompanhamento"] as const;

function computeSteps(stage: string, onboardingStatus: string | null): JourneyStepState[] {
  const preClose = ["LEAD", "QUALIFICACAO", "DIAGNOSTICO_COMERCIAL", "PROPOSTA", "NEGOCIACAO"];
  const comercial: JourneyStepState = preClose.includes(stage) ? "active" : "done";
  const contrato: JourneyStepState = stage === "CLIENTE_GANHO" ? "active" : preClose.includes(stage) ? "pending" : "done";
  const onboarding: JourneyStepState = stage === "ONBOARDING" ? "active" : (stage === "ATIVO" || stage === "PAUSADO" || stage === "INADIMPLENTE" || stage === "ENCERRADO") ? "done" : "pending";
  const kickoff: JourneyStepState = onboardingStatus === "COMPLETED" ? "done" : onboardingStatus === "READY_FOR_KICKOFF" ? "active" : "pending";
  const operacao: JourneyStepState = stage === "ATIVO" ? "active" : (stage === "PAUSADO" || stage === "INADIMPLENTE" || stage === "ENCERRADO") ? "done" : "pending";
  // Acompanhamento -- deliberadamente sempre "pending": nenhum sinal real distingue hoje "ativo recente" de "em acompanhamento" (ver nota em client-journey/types.ts). Nunca fabricado.
  return [comercial, contrato, onboarding, kickoff, operacao, "pending"];
}

function StepIcon({ state }: { state: JourneyStepState }) {
  if (state === "done") return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  if (state === "active") return <Dot className="w-5 h-5 text-indigo-600" />;
  return <Circle className="w-3.5 h-3.5 text-gray-300" />;
}

const RESPONSIBLE_LABEL: Record<string, string> = { CLIENT: "Cliente", LOKAT: "LOKAT", SHARED: "Compartilhado" };
const ONBOARDING_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Não iniciado", IN_PROGRESS: "Em andamento", WAITING_CLIENT: "Aguardando cliente", WAITING_INTERNAL: "Aguardando LOKAT",
  BLOCKED: "Bloqueado", READY_FOR_KICKOFF: "Pronto para kickoff", COMPLETED: "Concluído", CANCELLED: "Cancelado",
};
const ITEM_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente", REQUESTED: "Solicitado", RECEIVED: "Recebido", IN_REVIEW: "Em revisão",
  APPROVED: "Aprovado", NOT_REQUIRED: "Não necessário", BLOCKED: "Bloqueado", COMPLETED: "Concluído",
};

export function EmpresaJourneyPanel({
  companyId, journeyResult, onboardingSummaryResult, onboardingItemsResult, onboardingTemplatesResult, healthResult,
}: {
  companyId: string;
  journeyResult: ClientJourneyFetchResult;
  onboardingSummaryResult: OnboardingFetchResult<OnboardingSummary | null>;
  onboardingItemsResult: OnboardingFetchResult<ClientOnboardingItem[]> | null;
  onboardingTemplatesResult: OnboardingFetchResult<OnboardingTemplate[]>;
  healthResult: ClientHealthFetchResult;
}) {
  const router = useRouter();

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 space-y-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Jornada</h2>

      {journeyResult.status === "available" && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {computeSteps(journeyResult.data.stage, journeyResult.data.onboardingStatus).map((state, i) => (
            <div key={STEP_LABELS[i]} className="flex items-center gap-1 flex-shrink-0">
              <div className="flex flex-col items-center gap-1">
                <StepIcon state={state} />
                <span className={`text-[10px] font-bold ${state === "pending" ? "text-gray-300" : state === "active" ? "text-indigo-600" : "text-emerald-600"}`}>{STEP_LABELS[i]}</span>
              </div>
              {i < STEP_LABELS.length - 1 && <div className="w-6 h-px bg-gray-200 mb-4" />}
            </div>
          ))}
        </div>
      )}
      {journeyResult.status === "unavailable" && (
        <p className="text-xs text-red-600">Não foi possível calcular a jornada agora.</p>
      )}

      {/* FASE 1C.1 -- conta já ATIVA + onboarding adicional em andamento (expansão/novo serviço) nunca regride a jornada geral; aparece aqui como um eixo separado, nunca escondido. */}
      {journeyResult.status === "available" && journeyResult.data.stage === "ATIVO" && journeyResult.data.onboardingStatus
        && journeyResult.data.onboardingStatus !== "COMPLETED" && journeyResult.data.onboardingStatus !== "CANCELLED" && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Conta: ATIVA</span>
          <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">Onboarding adicional: {ONBOARDING_STATUS_LABEL[journeyResult.data.onboardingStatus] ?? journeyResult.data.onboardingStatus}</span>
        </div>
      )}

      {/* Saúde do relacionamento (seção 15/16) -- nunca um CS completo, só o que já alimenta ação real. */}
      {healthResult.status === "available" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <HealthChip icon={Phone} label="Último contato" value={healthResult.data.lastContactAt ? new Date(healthResult.data.lastContactAt).toLocaleDateString("pt-BR") : "—"} />
          <HealthChip icon={Users} label="Última reunião" value={healthResult.data.lastMeetingAt ? new Date(healthResult.data.lastMeetingAt).toLocaleDateString("pt-BR") : "—"} />
          <HealthChip icon={CalendarClock} label="Próxima reunião" value={healthResult.data.nextMeetingAt ? new Date(healthResult.data.nextMeetingAt).toLocaleDateString("pt-BR") : "Nenhuma agendada"} />
          <HealthChip icon={Target} label="Oportunidades abertas" value={String(healthResult.data.openOpportunitiesCount)} />
        </div>
      )}

      {/* Onboarding (seção 11) */}
      <OnboardingSection
        companyId={companyId}
        summaryResult={onboardingSummaryResult}
        itemsResult={onboardingItemsResult}
        templatesResult={onboardingTemplatesResult}
        onChanged={() => router.refresh()}
      />
    </section>
  );
}

function HealthChip({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl px-2.5 py-2">
      <p className="flex items-center gap-1 text-gray-400 font-bold uppercase tracking-wide text-[9px]"><Icon className="w-3 h-3" /> {label}</p>
      <p className="text-gray-700 font-medium mt-0.5">{value}</p>
    </div>
  );
}

function OnboardingSection({
  companyId, summaryResult, itemsResult, templatesResult, onChanged,
}: {
  companyId: string;
  summaryResult: OnboardingFetchResult<OnboardingSummary | null>;
  itemsResult: OnboardingFetchResult<ClientOnboardingItem[]> | null;
  templatesResult: OnboardingFetchResult<OnboardingTemplate[]>;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (summaryResult.status === "unavailable") {
    if (summaryResult.reason === "schema_not_applied") {
      return <PendingBanner label="O processo de Onboarding" />;
    }
    return <p className="text-xs text-red-600">Não foi possível carregar o onboarding agora.</p>;
  }

  if (!summaryResult.data) {
    // Nenhum onboarding ainda -- estado honesto, nunca escondido (seção 3: iniciar via handoff comercial ou manualmente).
    return (
      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-500 mb-2">Esta Company ainda não tem um onboarding iniciado.</p>
        {templatesResult.status === "available" && templatesResult.data.length > 0 ? (
          <>
            <button type="button" onClick={() => setCreating((v) => !v)} className="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Iniciar onboarding
            </button>
            {creating && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {templatesResult.data.map((t) => (
                    <button key={t.code} type="button"
                      onClick={() => setSelectedTemplates((prev) => prev.includes(t.code) ? prev.filter((c) => c !== t.code) : [...prev, t.code])}
                      className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg ${selectedTemplates.includes(t.code) ? "bg-indigo-600 text-white" : "bg-gray-50 text-gray-500"}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <button type="button" disabled={selectedTemplates.length === 0 || saving}
                  onClick={async () => {
                    setSaving(true); setError(null);
                    const res = await fetch(`/api/admin/clients/${encodeURIComponent(companyId)}/onboarding`, {
                      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateCodes: selectedTemplates, createdFrom: "manual" }),
                    });
                    const data = await res.json().catch(() => null);
                    setSaving(false);
                    if (!res.ok) { setError(data?.error ?? "Erro ao iniciar onboarding."); return; }
                    setCreating(false); onChanged();
                  }}
                  className="text-[11px] font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg disabled:bg-gray-200 disabled:text-gray-400 flex items-center gap-1.5">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Criar onboarding
                </button>
                {error && <p className="text-[10px] text-red-600">{error}</p>}
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-gray-400">Nenhum template de onboarding cadastrado ainda.</p>
        )}
      </div>
    );
  }

  const summary = summaryResult.data;
  return (
    <div className="border-t border-gray-100 pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800">Onboarding · {summary.progress}%</p>
        {summary.readyForKickoff && summary.onboarding.status !== "COMPLETED" && (
          <OnboardingStatusAction companyId={companyId} onboardingId={summary.onboarding.id}
            status={summary.onboarding.status === "READY_FOR_KICKOFF" ? "COMPLETED" : "READY_FOR_KICKOFF"} onChanged={onChanged} />
        )}
        {summary.onboarding.status === "COMPLETED" && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Kickoff concluído</span>}
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-600" style={{ width: `${summary.progress}%` }} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <HealthChip icon={Clock} label="Aguardando cliente" value={String(summary.waitingOnClientCount)} />
        <HealthChip icon={Clock} label="Aguardando LOKAT" value={String(summary.waitingOnLokatCount)} />
        <HealthChip icon={AlertCircle} label="Bloqueios" value={String(summary.blockedCount)} />
        <HealthChip icon={Target} label="Próxima ação" value={summary.nextAction ? summary.nextAction.label : "Nenhuma"} />
      </div>
      {summary.nextMeeting && (
        <p className="text-[11px] text-gray-500">Próxima reunião: <span className="font-medium text-gray-700">{summary.nextMeeting.title}</span> em {new Date(summary.nextMeeting.scheduledAt).toLocaleString("pt-BR")}</p>
      )}
      {!summary.readyForKickoff && summary.missingForKickoff.length > 0 && (
        <p className="text-[11px] text-amber-600">Faltam para o kickoff: {summary.missingForKickoff.join(", ")}</p>
      )}

      {itemsResult?.status === "available" && itemsResult.data.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {itemsResult.data.map((item) => <OnboardingItemRow key={item.id} companyId={companyId} item={item} onChanged={onChanged} />)}
        </div>
      )}
    </div>
  );
}

const STATUS_ACTION_LABEL: Record<string, string> = { READY_FOR_KICKOFF: "Marcar pronto para kickoff", COMPLETED: "Concluir kickoff" };

function OnboardingStatusAction({ companyId, onboardingId, status, onChanged }: { companyId: string; onboardingId: string; status: "READY_FOR_KICKOFF" | "COMPLETED"; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <button type="button" disabled={saving}
      onClick={async () => {
        setSaving(true);
        await fetch(`/api/admin/clients/${encodeURIComponent(companyId)}/onboarding`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboardingId, status }),
        });
        setSaving(false);
        onChanged();
      }}
      className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full disabled:opacity-50 flex items-center gap-1">
      {saving && <Loader2 className="w-2.5 h-2.5 animate-spin" />} {STATUS_ACTION_LABEL[status]}
    </button>
  );
}

function OnboardingItemRow({ companyId, item, onChanged }: { companyId: string; item: ClientOnboardingItem; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  async function updateStatus(status: OnboardingItemStatus) {
    setSaving(true);
    await fetch(`/api/admin/clients/${encodeURIComponent(companyId)}/onboarding/items/${encodeURIComponent(item.id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    setSaving(false);
    onChanged();
  }
  return (
    <div className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-700 truncate">{item.label}{item.isRequiredForKickoff && <span className="text-amber-600"> *</span>}</p>
        <p className="text-[10px] text-gray-400">{RESPONSIBLE_LABEL[item.responsibleSide]}</p>
      </div>
      <select value={item.status} disabled={saving} onChange={(e) => void updateStatus(e.target.value as OnboardingItemStatus)}
        className="text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white disabled:opacity-50">
        {ONBOARDING_ITEM_STATUSES.map((s) => <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>)}
      </select>
    </div>
  );
}

function PendingBanner({ label }: { label: string }) {
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
      <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-amber-700"><span className="font-bold">Migration pendente (SQL 101).</span> {label} depende de uma migration ainda não aplicada em Production. O código já está pronto.</p>
    </div>
  );
}
