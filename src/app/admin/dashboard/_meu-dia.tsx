"use client";
import { useState } from "react";
import { CheckSquare, Clock, AlertTriangle } from "lucide-react";
import type { OnboardingAttentionItem } from "@/lib/client-onboarding/types";

interface Approval {
  id: string;
  content_items: { title: string | null }[] | null;
}

interface Props {
  pendingApprovals: Approval[];
  /** FASE 1C, seção 12 -- onboardings parados de qualquer Company da agência. DB MIGRATION PENDING (SQL 101) -- [] enquanto a migration não aplicada. */
  onboardingAttentionItems?: OnboardingAttentionItem[];
}

export function MeuDiaBlock({ pendingApprovals, onboardingAttentionItems = [] }: Props) {
  const [taskModalOpen,    setTaskModalOpen]    = useState(false);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);

  // Prevent unused-var warnings — modals will be implemented with the SQL 38 rollout
  void taskModalOpen;
  void meetingModalOpen;

  return (
    <div className="mb-8 bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center">
            <Clock className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-800">Meu Dia</p>
            <p className="text-xs text-gray-400">Tarefas, reuniões e pendências de hoje</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTaskModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition-colors"
          >
            <CheckSquare className="w-3.5 h-3.5" /> Criar tarefa
          </button>
          <button
            onClick={() => setMeetingModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl transition-colors"
          >
            <Clock className="w-3.5 h-3.5" /> Agendar reunião
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Próximas tarefas</p>
          <div className="text-center py-3">
            <p className="text-xs text-gray-400">Nenhuma tarefa hoje.</p>
            <p className="text-[10px] text-gray-300 mt-0.5">Módulo de produtividade em preparação.</p>
          </div>
        </div>
        <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Reuniões</p>
          <div className="text-center py-3">
            <p className="text-xs text-gray-400">Nenhuma reunião agendada.</p>
            <p className="text-[10px] text-gray-300 mt-0.5">Integração com agenda em breve.</p>
          </div>
        </div>
        <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-100">
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2">Pendências urgentes</p>
          {pendingApprovals.length > 0 || onboardingAttentionItems.length > 0 ? (
            <div className="space-y-1.5">
              {pendingApprovals.slice(0, 2).map((a) => (
                <a key={a.id} href="/admin/contentos/aprovacoes" className="flex items-center gap-1.5 text-xs text-amber-700 hover:underline">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{a.content_items?.[0]?.title ?? "Aprovação pendente"}</span>
                </a>
              ))}
              {onboardingAttentionItems.slice(0, 2).map((o) => (
                <a key={o.itemId} href={`/admin/empresa?client=${encodeURIComponent(o.companyId)}`} className="flex items-center gap-1.5 text-xs text-amber-700 hover:underline">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{o.message}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-600 py-3 text-center">Nenhuma pendência urgente.</p>
          )}
        </div>
      </div>
    </div>
  );
}
