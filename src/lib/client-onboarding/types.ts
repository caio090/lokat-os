/**
 * FASE 1C — Entidade Onboarding (seção 4/5/6/8/13). Espelha
 * docs/supabase/101-client-onboarding-and-project-journey.sql
 * (DB MIGRATION PENDING em Production no momento em que este código
 * foi escrito). Zero-drift SQL/TypeScript, mesmo princípio de
 * company-diagnostic/types.ts e company-decisions/types.ts.
 */
export const ONBOARDING_STATUSES = [
  "NOT_STARTED", "IN_PROGRESS", "WAITING_CLIENT", "WAITING_INTERNAL", "BLOCKED", "READY_FOR_KICKOFF", "COMPLETED", "CANCELLED",
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const ONBOARDING_ITEM_STATUSES = [
  "PENDING", "REQUESTED", "RECEIVED", "IN_REVIEW", "APPROVED", "NOT_REQUIRED", "BLOCKED", "COMPLETED",
] as const;
export type OnboardingItemStatus = (typeof ONBOARDING_ITEM_STATUSES)[number];

/** Um item conta como "resolvido" para fins de kickoff/progresso quando está em um destes três estados -- nunca "RECEIVED"/"IN_REVIEW" sozinhos (ainda não confirmados). */
export const RESOLVED_ITEM_STATUSES: ReadonlySet<OnboardingItemStatus> = new Set(["APPROVED", "NOT_REQUIRED", "COMPLETED"]);
/** Estados que contam como "aguardando" alguém -- usado no resumo da seção 11. */
export const BLOCKED_ITEM_STATUSES: ReadonlySet<OnboardingItemStatus> = new Set(["BLOCKED"]);

export type OnboardingResponsibleSide = "CLIENT" | "LOKAT" | "SHARED";
export const ONBOARDING_RESPONSIBLE_SIDES: OnboardingResponsibleSide[] = ["CLIENT", "LOKAT", "SHARED"];

/** Seção 13 -- o que cada lado pode ver. INTERNAL_ONLY nunca aparece numa visão de cliente. */
export type OnboardingItemVisibility = "INTERNAL_ONLY" | "CLIENT_VISIBLE" | "CLIENT_ACTION_REQUIRED" | "CLIENT_APPROVAL_REQUIRED";
export const ONBOARDING_ITEM_VISIBILITIES: OnboardingItemVisibility[] = ["INTERNAL_ONLY", "CLIENT_VISIBLE", "CLIENT_ACTION_REQUIRED", "CLIENT_APPROVAL_REQUIRED"];

export type OnboardingCreatedFrom = "commercial_handoff" | "manual";

export interface ClientOnboarding {
  id: string;
  companyId: string;
  status: OnboardingStatus;
  templateCodes: string[];
  startedAt: string | null;
  targetCompletionAt: string | null;
  completedAt: string | null;
  ownerId: string | null;
  progress: number;
  createdFrom: OnboardingCreatedFrom;
  commercialOpportunityId: string | null;
  contractId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientOnboardingItem {
  id: string;
  onboardingId: string;
  itemKey: string | null;
  category: string | null;
  label: string;
  responsibleSide: OnboardingResponsibleSide;
  status: OnboardingItemStatus;
  visibility: OnboardingItemVisibility;
  isRequiredForKickoff: boolean;
  dueDate: string | null;
  notes: string | null;
  referenceUrl: string | null;
  accessHolder: string | null;
  dependsOnItemId: string | null;
  /** FASE 1C.1 -- quais templates originaram este item quando ele foi mesclado de uma combinação (ver mergeTemplateItems). [] quando o onboarding tem só 1 template ou o item foi criado fora do fluxo de templates. */
  sourceTemplates: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingTemplate {
  code: string;
  label: string;
  description: string | null;
}

export interface OnboardingTemplateItem {
  id: string;
  templateCode: string;
  itemKey: string;
  category: string | null;
  label: string;
  responsibleSide: OnboardingResponsibleSide;
  defaultVisibility: OnboardingItemVisibility;
  isRequiredForKickoff: boolean;
  sortOrder: number;
}

/** Seção 11 -- resumo pronto pra UI, nunca um dashboard decorativo (cada campo aponta pra uma ação real). */
export interface OnboardingSummary {
  onboarding: ClientOnboarding;
  progress: number;
  waitingOnClientCount: number;
  waitingOnLokatCount: number;
  blockedCount: number;
  nextAction: { itemId: string; label: string; responsibleSide: OnboardingResponsibleSide } | null;
  nextMeeting: { id: string; title: string; scheduledAt: string } | null;
  readyForKickoff: boolean;
  missingForKickoff: string[];
}

/** Seção 12 -- um item de onboarding parado entra na Central do Dia (agência inteira, não só a página de uma Company). "Evitar dashboard decorativo": cada item aqui é uma pendência real com dias de espera reais, nunca uma métrica solta. */
export interface OnboardingAttentionItem {
  companyId: string;
  companyName: string;
  onboardingId: string;
  itemId: string;
  label: string;
  responsibleSide: OnboardingResponsibleSide;
  waitingDays: number;
  message: string;
}

export type OnboardingFetchReason = "schema_not_applied" | "internal_error";
export type OnboardingFetchResult<T> =
  | { status: "unavailable"; reason: OnboardingFetchReason }
  | { status: "available"; data: T };
/** FASE 1C.2 -- "template_conflict": dois ou mais templates escolhidos definem o mesmo item_key com campos estruturalmente incompatíveis (responsible_side/visibility/label/category) -- ver mergeTemplateItems(). Nunca escolhido silenciosamente, sempre reportado. */
export type OnboardingWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: OnboardingFetchReason | "validation_error" | "template_conflict" };
