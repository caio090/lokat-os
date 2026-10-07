/**
 * FASE 1B — notificação para a central de atenção do LOKAT OS (seção
 * 10). Reaproveita a tabela `notifications` já existente e já escrita
 * por outras rotas (ex.: src/app/api/webhooks/payments/asaas/route.ts),
 * mesmo shape (recipient_role/type/title/message/is_read) -- nenhuma
 * tabela nova. Broadcast para role="admin" (ainda não existe, no
 * código atual, um lookup de "qual admin é responsável por esta
 * Company" -- fica documentado como simplificação desta fase, não um
 * limite do schema).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function notifyAdminsOfIntegrationEvent(
  adminDb: SupabaseClient,
  params: { title: string; message: string; companyId: string | null },
): Promise<boolean> {
  try {
    const { error } = await adminDb.from("notifications").insert({
      recipient_id: null,
      recipient_role: "admin",
      type: "integration_event",
      title: params.title,
      message: params.message,
      is_read: false,
    });
    return !error;
  } catch (err) {
    console.error("[integration-events] falha ao notificar (best-effort, nunca derruba o processamento do evento)", { error: err instanceof Error ? err.message : err });
    return false;
  }
}
