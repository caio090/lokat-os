/**
 * Fluxo rascunho → revisão → aprovação → publicação → veiculação.
 *
 * Espelha o trigger mkt_guard_publication_workflow (migração 105) para a UI
 * e o servidor saberem ANTES de tentar o que é permitido. O banco continua
 * sendo a fonte da verdade (defesa em profundidade).
 *
 * Regras de negócio:
 *  - Publicar = criar na plataforma SEMPRE com status PAUSED. Nunca gera gasto.
 *  - Veicular (ACTIVE) exige autorização humana específica e registrada.
 */
import type { WorkflowStatus } from "./types";

export type WorkflowActor = "equipe" | "aprovador" | "servidor";

const HUMAN_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  rascunho: ["em_revisao", "arquivada"],
  em_revisao: ["rascunho", "aprovada", "arquivada"],
  aprovada: ["rascunho", "arquivada"],
  publicada: ["pausada", "encerrada"],
  pausada: ["encerrada", "arquivada"],
  encerrada: ["arquivada"],
  arquivada: [],
};

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
}

export function canTransition(from: WorkflowStatus, to: WorkflowStatus, actor: WorkflowActor): TransitionCheck {
  if (from === to) return { allowed: true };
  if (to === "publicada") {
    if (actor !== "servidor") return { allowed: false, reason: "Publicação só acontece pelo servidor, depois da aprovação." };
    if (from !== "aprovada") return { allowed: false, reason: "Só é publicado o que foi aprovado." };
    return { allowed: true };
  }
  if (actor === "servidor") return { allowed: true };
  if (to === "aprovada" && actor !== "aprovador") return { allowed: false, reason: "Só admin/super_admin aprova." };
  if (!HUMAN_TRANSITIONS[from].includes(to)) return { allowed: false, reason: `Transição ${from} → ${to} não permitida.` };
  return { allowed: true };
}

export interface ActivationInput {
  status: WorkflowStatus;
  platformStatus: string | null;
  activationAuthorizedAt: string | null;
  /** Autorização explícita NESTA execução (ex.: confirmação na tela). */
  explicitConfirmation: boolean;
}

/** Ativar veiculação (gasto de mídia). Todas as condições precisam ser verdadeiras. */
export function canActivateDelivery(input: ActivationInput): TransitionCheck {
  if (input.status !== "publicada" && input.status !== "pausada") {
    return { allowed: false, reason: "A campanha precisa estar publicada (pausada na plataforma)." };
  }
  if (!input.activationAuthorizedAt) {
    return { allowed: false, reason: "Falta autorização de veiculação registrada por admin/super_admin." };
  }
  if (!input.explicitConfirmation) {
    return { allowed: false, reason: "Falta confirmação explícita nesta execução." };
  }
  return { allowed: true };
}

/** Status inicial obrigatório na plataforma ao publicar. */
export const PLATFORM_STATUS_ON_PUBLISH = "PAUSED" as const;
