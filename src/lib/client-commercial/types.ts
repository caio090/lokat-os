/**
 * Retomada do produto, seção 5/19 — Reunião e Proposta para uma
 * Company JÁ FECHADA (upsell, QBR, revisão), distinto do pipeline de
 * negociação (commercial_leads/commercial_meetings.lead_id /
 * commercial_proposals.lead_id, que continuam intocados). Depende de
 * SQL 99 (DB MIGRATION PENDING em Production no momento em que este
 * código foi escrito) ter adicionado commercial_meetings.client_id /
 * commercial_proposals.client_id.
 */
export type ClientMeetingStatus = "agendada" | "realizada" | "cancelada" | "remarcada";
export type ClientProposalStatus = "rascunho" | "enviada" | "visualizada" | "aceita" | "recusada" | "expirada";

export interface ClientMeeting {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  durationMin: number | null;
  meetLink: string | null;
  status: ClientMeetingStatus;
  notes: string | null;
  createdAt: string;
}

export interface ClientProposal {
  id: string;
  companyId: string;
  title: string;
  value: number | null;
  recurrence: string | null;
  services: string[];
  status: ClientProposalStatus;
  validUntil: string | null;
  createdAt: string;
}

export type ClientCommercialFetchReason = "schema_not_applied" | "internal_error";
export type ClientCommercialFetchResult<T> =
  | { status: "unavailable"; reason: ClientCommercialFetchReason }
  | { status: "available"; data: T };
export type ClientCommercialWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: ClientCommercialFetchReason | "validation_error" };
