import { notFound } from "next/navigation";
import { ContentosSubNavServer } from "../../../_contentos-subnav-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveCompanyContext } from "@/lib/company-context/resolve";
import { getCreativeSeriesWithItems } from "@/lib/rec-os/studio/series/repository";
import { isValidCreativeSeriesRouteId } from "@/lib/rec-os/studio/series/route-identity";
import { getStudioSkills } from "@/lib/rec-os/studio";
import { parseStudioLaunchContext } from "@/lib/rec-os/studio/launch-context";
import type { RawStudioLaunchParams } from "@/lib/rec-os/studio/launch-context";
import { resolveCreativeSeriesWorkspaceBootstrap } from "./workspace-bootstrap";
import { CreativeSeriesWorkspace } from "./_creative-series-workspace";
import type { DesignFormat } from "@/lib/providers/shared/types";

/**
 * Prompt 24 (Dedicated Creative Series Workspace) — workspace canônico
 * de UMA Creative Series existente. Diferente de `/admin/contentos/
 * visual` (porta de entrada -- peça única, nova série, Company
 * selector, Free Mode), esta rota NUNCA tenta "descobrir" qual série
 * mostrar: `params.seriesId` É a identidade (ROUTE IDENTITY), resolvida
 * aqui, sob a sessão real (RLS), na MESMA passada síncrona que resolve
 * o Company scope efetivo -- exatamente como o Prompt 22 já fazia, mas
 * agora a identidade nunca mais compete com o Company Context do
 * cliente reagindo a props que mudam: não existe estado client-side
 * nenhum que possa "esquecer" a série, porque ela nunca foi estado --
 * sempre foi o próprio endereço da página.
 *
 * REGRA CENTRAL: se a rota é /series/ABC, o servidor carrega a série
 * ABC ou devolve not found seguro -- nunca revela se ABC existe mas
 * pertence a outra Company (mesmo 404 genérico pros dois casos, ver
 * workspace-bootstrap.ts).
 */
export default async function CreativeSeriesWorkspacePage({
  params, searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<RawStudioLaunchParams>;
}) {
  const { seriesId } = await params;
  if (!isValidCreativeSeriesRouteId(seriesId)) notFound();

  const rawParams = await searchParams;
  const db = await createServerSupabaseClient();

  const bootstrap = await resolveCreativeSeriesWorkspaceBootstrap(
    {
      fetchSeriesById: (id) => getCreativeSeriesWithItems(db, id),
      checkCompanyAuthorized: async (clientId) => (await resolveCompanyContext(clientId)).valid,
    },
    seriesId,
  );
  if (!bootstrap.ok) notFound();

  const { series, clientId } = bootstrap;
  const companyName = clientId ? (await resolveCompanyContext(clientId)).context?.companyName ?? null : null;
  const launchContext = parseStudioLaunchContext({ ...rawParams, client: clientId ?? undefined });
  const skills = getStudioSkills();
  const skillId = skills[0]?.id ?? "vidigal_png";
  const format: DesignFormat = (series.series.format as DesignFormat | null) ?? "carousel";

  return (
    <>
      <ContentosSubNavServer initialClientId={clientId ?? undefined} />
      <CreativeSeriesWorkspace
        series={series.series}
        initialItems={series.items}
        clientId={clientId}
        companyName={companyName}
        launchContext={launchContext}
        skillId={skillId}
        format={format}
      />
    </>
  );
}
