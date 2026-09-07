import { NextRequest, NextResponse } from "next/server";
import { resolveCompanyContext } from "@/lib/company-context/resolve";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listRecentCreativeSeries } from "@/lib/rec-os/studio/series/repository";

/**
 * Prompt 26 (Dedicated Series Workspace Completion) — FASE 23-28:
 * lista BOUNDED (3-6, nunca uma biblioteca completa) de séries recentes
 * pro Studio root. Mesmo padrão de autorização de `GET /api/rec-os/
 * series` (Company Mode -> resolveCompanyContext(); Free Mode -> só
 * getCurrentUser()) -- rota nova e aditiva, NUNCA modifica o
 * comportamento do `GET /api/rec-os/series` existente (ainda usado
 * pelo fluxo "continuar a série mais recente" da criação).
 */
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 6;

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const clientId = params.get("client_id");
  const contentId = params.get("content_id");
  const requestedLimit = Number(params.get("limit"));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  if (clientId) {
    const resolution = await resolveCompanyContext(clientId);
    if (!resolution.valid || !resolution.context) {
      const unauthorized = resolution.reason === "role_not_supported";
      return NextResponse.json(
        { ok: false, error: unauthorized ? "Sem permissão para ver séries desta Company." : "Contexto de Company necessário.", code: unauthorized ? "SERIES_UNAUTHORIZED" : "SERIES_COMPANY_REQUIRED" },
        { status: unauthorized ? 403 : 401 },
      );
    }
  } else {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, error: "Sessão necessária.", code: "SERIES_COMPANY_REQUIRED" }, { status: 401 });
  }

  const db = await createServerSupabaseClient();
  const series = await listRecentCreativeSeries(db, { clientId, contentId }, limit);
  return NextResponse.json({ ok: true, series });
}
