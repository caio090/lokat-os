/**
 * Prompt 24 (Dedicated Creative Series Workspace) — PARTE F (FASE
 * 21-24): `/admin/contentos/visual?series_id=ABC` era, até este prompt,
 * a identidade OPERACIONAL da série (resolvida no cliente ou, a partir
 * do Prompt 22, no servidor mas ainda dentro da rota genérica). Ela
 * agora é só uma ENTRADA LEGADA: uma série tem endereço próprio
 * (`/admin/contentos/visual/series/[seriesId]`, ver
 * `../series/[seriesId]/page.tsx`), e a rota genérica nunca mais tenta
 * carregar/hidratar uma série existente.
 *
 * Decisão extraída como função PURA (nenhum `redirect()` do Next.js
 * aqui dentro -- isso lançaria uma exceção especial `NEXT_REDIRECT` que
 * só faz sentido dentro do runtime real de uma Server Component) pelo
 * mesmo motivo do Prompt 22 (`scope-resolution.ts`): a decisão "para
 * onde redirecionar" precisa ser testável de verdade, sem depender do
 * runtime do Next.js. `page.tsx` só chama esta função e, se o
 * resultado não for null, chama `redirect(resultado)`.
 *
 * FASE 22 -- "validação mínima necessária" antes de redirecionar é
 * checar que `series_id` tem FORMATO de UUID (route-identity.ts) --
 * nunca uma consulta ao banco aqui (isso já é responsabilidade da rota
 * de destino, sob RLS real). Um `series_id` malformado nunca gera um
 * redirect quebrado: cai de volta pro comportamento normal da rota
 * genérica (ignora o parâmetro, Free Mode/Company Mode seguem normais).
 */
import { isValidCreativeSeriesRouteId } from "@/lib/rec-os/studio/series/route-identity";
import { buildSeriesWorkspaceUrl } from "@/lib/rec-os/studio/launch-context";
import type { RawStudioLaunchParams } from "@/lib/rec-os/studio/launch-context";
import { parseStudioLaunchContext } from "@/lib/rec-os/studio/launch-context";

export interface LegacySeriesRedirectParams extends RawStudioLaunchParams {
  series_id?: string;
}

/**
 * Retorna a URL canônica do workspace quando a rota genérica recebeu um
 * `series_id` bem formado -- null quando não há nada a redirecionar
 * (sem `series_id`, ou malformado). FASE 23 -- preserva apenas
 * `content_id`/`campaign_id`/`social_profile_id`/`source_format`/
 * `return_to` (referências/IDs, nunca briefing/copy); nunca preserva
 * `client` (a Company do workspace vem do servidor, ver FASE 12).
 */
export function resolveLegacySeriesRedirectTarget(rawParams: LegacySeriesRedirectParams): string | null {
  if (!isValidCreativeSeriesRouteId(rawParams.series_id)) return null;
  const launchContext = parseStudioLaunchContext(rawParams);
  return buildSeriesWorkspaceUrl(rawParams.series_id, launchContext);
}
