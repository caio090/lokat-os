/**
 * FASE 1C — resolve a jornada macro computada (nunca persistida).
 * client_onboardings (SQL 101, DB MIGRATION PENDING) é tratado como
 * opcional: se a tabela ainda não existe, o resto da jornada (lead/
 * cliente) continua funcionando normalmente -- "ausente permanece
 * ausente", mesmo princípio de company-diagnostic/adapters.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientJourneyFetchReason, ClientJourneyFetchResult, ClientJourneyStage } from "./types";

function classifyError(table: string, err: unknown): ClientJourneyFetchReason {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null | undefined)?.message ?? "");
  const isSchemaMissing = code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
  if (isSchemaMissing) return "schema_not_applied";
  console.error(`[client-journey] internal_error on "${table}"${code ? ` (code=${code})` : ""}`);
  return "internal_error";
}

const PIPELINE_TO_STAGE: Record<string, ClientJourneyStage> = {
  novo_lead: "LEAD",
  pre_qualificacao: "QUALIFICACAO",
  contato_feito: "QUALIFICACAO",
  reuniao_agendada: "DIAGNOSTICO_COMERCIAL",
  diagnostico_realizado: "DIAGNOSTICO_COMERCIAL",
  proposta_enviada: "PROPOSTA",
  negociacao: "NEGOCIACAO",
  fechado: "CLIENTE_GANHO",
};

/**
 * FASE 1C.1 -- a conta só pode ser EMPURRADA para ONBOARDING pelo
 * onboarding INICIAL (antes da conta nunca ter sido ativada). Uma vez
 * que clients.status já é "ativo"/"active" (ou qualquer outro status
 * "resolvido" -- pausado/inadimplente/encerrado), um onboarding
 * ADICIONAL (expansão, novo serviço, novo projeto) nunca regride a
 * jornada geral de volta para ONBOARDING -- a conta continua no status
 * dela, e o onboarding adicional aparece como um eixo SEPARADO na UI
 * (ClientJourneySnapshot.onboardingStatus continua populado de
 * qualquer forma, mesmo quando não decide o stage). Três eixos
 * continuam independentes -- nenhum enum novo criado.
 */
const ACCOUNT_SETTLED_STATUSES = new Set(["ativo", "active", "pausado", "inadimplente", "encerrado"]);

function computeStage(clientStatus: string, pipelineStage: string | null, onboardingStatus: string | null): ClientJourneyStage {
  const onboardingActive = onboardingStatus !== null && onboardingStatus !== "COMPLETED" && onboardingStatus !== "CANCELLED";
  const accountAlreadySettled = ACCOUNT_SETTLED_STATUSES.has(clientStatus);
  // Onboarding ativo é o sinal mais específico -- mas só enquanto a conta
  // ainda não foi assentada em um status próprio (esse é o onboarding
  // INICIAL). Depois disso, a conta nunca regride por um onboarding novo.
  if (onboardingActive && !accountAlreadySettled) return "ONBOARDING";

  switch (clientStatus) {
    case "encerrado": return "ENCERRADO";
    case "pausado": return "PAUSADO";
    case "inadimplente": return "INADIMPLENTE";
    case "onboarding": return "ONBOARDING";
    case "ativo":
    case "active":
      return "ATIVO";
    case "aguardando_validacao":
      if (pipelineStage && PIPELINE_TO_STAGE[pipelineStage]) return PIPELINE_TO_STAGE[pipelineStage];
      return "LEAD";
    default:
      return "ATIVO";
  }
}

export async function getClientJourney(adminDb: SupabaseClient, companyId: string): Promise<ClientJourneyFetchResult> {
  try {
    const { data: clientRow, error: clientError } = await adminDb.from("clients").select("status").eq("id", companyId).maybeSingle();
    if (clientError) return { status: "unavailable", reason: classifyError("clients", clientError) };
    if (!clientRow) return { status: "unavailable", reason: "internal_error" };

    const { data: leadRow } = await adminDb.from("commercial_leads").select("pipeline_stage").eq("client_id", companyId).order("updated_at", { ascending: false }).limit(1).maybeSingle();

    let onboardingStatus: string | null = null;
    let onboardingId: string | null = null;
    let onboardingProgress: number | null = null;
    try {
      const { data: onboardingRow, error: onboardingError } = await adminDb
        .from("client_onboardings")
        .select("id, status, progress")
        .eq("client_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!onboardingError && onboardingRow) {
        onboardingStatus = onboardingRow.status as string;
        onboardingId = onboardingRow.id as string;
        onboardingProgress = onboardingRow.progress as number;
      }
      // Erro aqui (ex.: schema_not_applied) nunca derruba a jornada inteira -- só onboarding fica ausente.
    } catch {
      // idem -- best-effort, "ausente permanece ausente".
    }

    const pipelineStage = (leadRow?.pipeline_stage as string | undefined) ?? null;
    const clientStatus = clientRow.status as string;
    return {
      status: "available",
      data: {
        stage: computeStage(clientStatus, pipelineStage, onboardingStatus),
        clientStatus, pipelineStage, onboardingStatus, onboardingId, onboardingProgress,
      },
    };
  } catch (err) {
    return { status: "unavailable", reason: classifyError("clients", err) };
  }
}
