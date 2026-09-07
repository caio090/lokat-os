/**
 * Prompt 13 (REC OS Core Experience) — Fase 04: StudioLaunchContext.
 *
 * Resolve a duplicidade conceitual Criar x Studio (Fase 03): Criar é o
 * workflow (objetivo, briefing, aprovação, publicação); Studio é o
 * motor de produção visual. Quando o usuário está dentro do fluxo Criar
 * e chega na etapa de produção visual, ele deve poder abrir o Studio
 * SEM recomeçar do zero e sem que o Studio precise reimplementar
 * objetivo/briefing/aprovação.
 *
 * Mesma regra já aplicada ao handoff Criar -> EditorOS
 * (rec-os-workflow/editor-handoff.ts): a URL carrega só IDs/referências
 * canônicas, NUNCA o conteúdo do briefing/copy inteiro -- o servidor
 * (StudioPage) resolve os dados reais a partir do `clientId` (já
 * existente) e agora também do `contentId` opcional.
 */

export interface StudioLaunchContext {
  clientId: string | null;
  contentId: string | null;
  campaignId: string | null;
  socialProfileId: string | null;
  /** Formato livre vindo do brief Criar (ContentFormat) -- Studio mapeia pro seu próprio DesignFormat quando reconhece, nunca força um valor. */
  format: string | null;
  returnRoute: string;
}

/** Constrói a URL do Studio a partir de um contexto de lançamento -- nunca concatenação solta. */
export function buildStudioLaunchUrl(base: string, context: StudioLaunchContext): string {
  const params = new URLSearchParams();
  if (context.clientId) params.set("client", context.clientId);
  if (context.contentId) params.set("content_id", context.contentId);
  if (context.campaignId) params.set("campaign_id", context.campaignId);
  if (context.socialProfileId) params.set("social_profile_id", context.socialProfileId);
  if (context.format) params.set("source_format", context.format);
  params.set("return_to", context.returnRoute);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Prompt 24 (Dedicated Creative Series Workspace) — constrói a URL do
 * workspace canônico de uma série (`/admin/contentos/visual/series/
 * [seriesId]`). Mesma disciplina de `buildStudioLaunchUrl` (só
 * IDs/referências na URL, nunca briefing/copy) -- mas nunca inclui
 * `client`: a identidade de Company do workspace vem do
 * `series.client_id` resolvido pelo servidor (FASE 12), nunca de um
 * query param que o usuário poderia divergir da série real.
 */
export function buildSeriesWorkspaceUrl(seriesId: string, context: StudioLaunchContext): string {
  const params = new URLSearchParams();
  if (context.contentId) params.set("content_id", context.contentId);
  if (context.campaignId) params.set("campaign_id", context.campaignId);
  if (context.socialProfileId) params.set("social_profile_id", context.socialProfileId);
  if (context.format) params.set("source_format", context.format);
  params.set("return_to", context.returnRoute);
  const qs = params.toString();
  const base = `/admin/contentos/visual/series/${seriesId}`;
  return qs ? `${base}?${qs}` : base;
}

export interface RawStudioLaunchParams {
  client?: string;
  content_id?: string;
  campaign_id?: string;
  social_profile_id?: string;
  source_format?: string;
  return_to?: string;
}

/** Nunca lança em entrada adulterada -- parâmetro ausente/inválido vira `null` (mesmo princípio de parseEditorAssetHandoff). */
export function parseStudioLaunchContext(params: RawStudioLaunchParams): StudioLaunchContext {
  return {
    clientId: params.client ?? null,
    contentId: params.content_id ?? null,
    campaignId: params.campaign_id ?? null,
    socialProfileId: params.social_profile_id ?? null,
    format: params.source_format ?? null,
    returnRoute: params.return_to ?? "/admin/contentos/criar",
  };
}

/** Verdadeiro quando o Studio foi aberto A PARTIR do fluxo Criar (compact mode) -- nunca assumido, sempre checado. */
export function isStudioLaunchedFromCreate(context: StudioLaunchContext): boolean {
  return Boolean(context.contentId);
}
