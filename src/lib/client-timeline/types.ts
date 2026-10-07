/**
 * Retomada do produto, seção 32 — "Histórico Único": activity_logs já
 * existe em produção (desde o schema inicial) mas, confirmado pela
 * auditoria, só é ESCRITO (3 call sites, fire-and-forget) -- nenhum
 * código lia de volta. Este domínio é só a LEITURA; os call sites de
 * escrita existentes (onboarding, aprovações) continuam exatamente
 * como estão, nenhum touch.
 */
export interface ClientTimelineEntry {
  id: string;
  companyId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type TimelineFetchReason = "schema_not_applied" | "internal_error";
export type TimelineFetchResult<T> =
  | { status: "unavailable"; reason: TimelineFetchReason }
  | { status: "available"; data: T };
