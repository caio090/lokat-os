/**
 * FASE 1C, seção 15/16 — "o comercial não termina com contrato
 * assinado". Estrutura simples de relacionamento (nunca CS completo
 * ainda -- seção 16 é explícita: "não precisa construir CS completo
 * agora"). 100% agregação de leitura sobre domínios já existentes
 * (client-commercial, client-opportunities, client-timeline) -- nenhuma
 * tabela nova.
 */
export interface ClientHealthSnapshot {
  lastContactAt: string | null;
  lastMeetingAt: string | null;
  nextMeetingAt: string | null;
  nextMeetingTitle: string | null;
  openOpportunitiesCount: number;
  pendingApprovalsCount: number;
}

export type ClientHealthFetchReason = "schema_not_applied" | "internal_error";
export type ClientHealthFetchResult =
  | { status: "unavailable"; reason: ClientHealthFetchReason }
  | { status: "available"; data: ClientHealthSnapshot };
