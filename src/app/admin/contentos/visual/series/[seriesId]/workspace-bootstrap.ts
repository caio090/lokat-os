/**
 * Prompt 24 (Dedicated Creative Series Workspace) — decisão de
 * bootstrap do workspace canônico de uma Creative Series, extraída pra
 * um módulo `.ts` puro (mesmo motivo do Prompt 22's page-bootstrap.ts:
 * `page.tsx` é JSX, e o harness de teste deste projeto nunca registrou
 * transformação de JSX -- toda decisão real precisa morar num módulo
 * importável sem React pra ser testável de verdade).
 *
 * REGRA CENTRAL (Prompt 24): "Se a rota é /series/ABC, o servidor
 * precisa carregar Series ABC ou retornar not found/forbidden seguro.
 * O Company Context do frontend NÃO decide se ABC existe." Esta função
 * é essa regra: recebe o seriesId JÁ VALIDADO como UUID (route-
 * identity.ts, checado pelo chamador antes de chegar aqui) e um
 * `fetchSeriesById` que o chamador já amarrou ao client Supabase da
 * SESSÃO (RLS real -- nunca admin/service role). Não existe
 * `findRecentCreativeSeries()`/heurística "recente" aqui (FASE 09): a
 * rota já escolheu qual série é, ponto final.
 *
 * FASE 05 -- fail closed: série inexistente e série de Company não
 * autorizada pra esta sessão produzem o MESMO resultado observável
 * (`{ ok: false }`) -- RLS já garante isso (a query não vê a linha nos
 * dois casos), então esta função não precisa (nem pode) distinguir os
 * dois further.
 */
import type { CreativeSeriesWithItems } from "@/lib/rec-os/studio/series/repository";

export interface CreativeSeriesWorkspaceBootstrapDeps {
  /** SEMPRE já amarrado ao client Supabase da sessão pelo chamador (RLS real). Nunca lança -- erros viram null. */
  fetchSeriesById: (seriesId: string) => Promise<CreativeSeriesWithItems | null>;
  /** Segunda camada de defesa (mesmo padrão do Prompt 16/22 na rota genérica) -- reconfirma a Company além de RLS antes de servir Feed DNA/Social Profile. Só chamado quando a série tem `client_id`. */
  checkCompanyAuthorized: (clientId: string) => Promise<boolean>;
}

export type CreativeSeriesWorkspaceBootstrapResult =
  | { ok: true; series: CreativeSeriesWithItems; clientId: string | null }
  | { ok: false };

export async function resolveCreativeSeriesWorkspaceBootstrap(
  deps: CreativeSeriesWorkspaceBootstrapDeps,
  seriesId: string,
): Promise<CreativeSeriesWorkspaceBootstrapResult> {
  let series: CreativeSeriesWithItems | null;
  try {
    series = await deps.fetchSeriesById(seriesId);
  } catch {
    series = null;
  }
  if (!series) return { ok: false };

  const clientId = series.series.clientId;
  if (clientId) {
    let authorized: boolean;
    try {
      authorized = await deps.checkCompanyAuthorized(clientId);
    } catch {
      authorized = false;
    }
    // FASE 05 -- mesmo resultado observável de "não existe": nunca
    // revela que a série existe mas pertence a uma Company não
    // autorizada pra esta sessão.
    if (!authorized) return { ok: false };
  }

  return { ok: true, series, clientId };
}
