/**
 * Ciclo de vida do token OAuth da Meta (somente servidor).
 *
 * Por que existe: o callback salvava o token de curta duração devolvido pela
 * troca do `code` (vale ~1-2h) sem registrar validade nem permissões. As
 * conexões ficavam "active" no banco mesmo já inutilizáveis.
 *
 * Fluxo oficial (developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived):
 *  1. code → token de usuário de curta duração
 *  2. fb_exchange_token → token de usuário de longa duração (~60 dias)
 *  3. debug_token (com app access token) → escopos concedidos, expiração e
 *     expiração do acesso a dados (data_access_expires_at, ~90 dias)
 *
 * Nunca registra o token em log nem o devolve ao navegador.
 */
import { resolveMetaApiVersion } from "./graph-version";

type FetchLike = (input: string) => Promise<{ json(): Promise<unknown> }>;

export interface TokenInspection {
  isValid: boolean;
  scopes: string[];
  /** null = a Meta informou que não expira (ex.: token de Página derivado de token longo). */
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  type: string | null;
}

export interface LongLivedResult {
  accessToken: string;
  /** Token longo obtido? Se false, ficou o token curto (e a validade reflete isso). */
  exchanged: boolean;
  expiresAt: Date | null;
}

interface GraphError { error?: { message?: string; code?: number } }

function graphUrl(path: string, params: Record<string, string>, version: string): string {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function epochToDate(value: unknown): Date | null {
  return typeof value === "number" && value > 0 ? new Date(value * 1000) : null;
}

export async function exchangeForLongLivedToken(
  shortToken: string,
  appId: string,
  appSecret: string,
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<LongLivedResult> {
  try {
    const res = await fetchImpl(graphUrl("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    }, resolveMetaApiVersion()));
    const body = (await res.json()) as GraphError & { access_token?: string; expires_in?: number };
    if (!body.error && typeof body.access_token === "string" && body.access_token.length > 0) {
      const expiresAt = typeof body.expires_in === "number" ? new Date(now.getTime() + body.expires_in * 1000) : null;
      return { accessToken: body.access_token, exchanged: true, expiresAt };
    }
  } catch { /* cai no token curto */ }
  return { accessToken: shortToken, exchanged: false, expiresAt: null };
}

export async function inspectToken(
  token: string,
  appId: string,
  appSecret: string,
  fetchImpl: FetchLike = fetch,
): Promise<TokenInspection | null> {
  try {
    const res = await fetchImpl(graphUrl("debug_token", {
      input_token: token,
      access_token: `${appId}|${appSecret}`,
    }, resolveMetaApiVersion()));
    const body = (await res.json()) as GraphError & { data?: Record<string, unknown> };
    const data = body.data;
    if (body.error || !data) return null;
    const scopes = Array.isArray(data.scopes) ? data.scopes.filter((s): s is string => typeof s === "string") : [];
    return {
      isValid: data.is_valid === true,
      scopes,
      // expires_at = 0 significa "não expira".
      expiresAt: epochToDate(data.expires_at),
      dataAccessExpiresAt: epochToDate(data.data_access_expires_at),
      type: typeof data.type === "string" ? data.type : null,
    };
  } catch {
    return null;
  }
}

/** Permissões que o app pode pedir no OAuth. Qualquer outra é descartada. */
export const META_BASE_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_insights",
  "business_management",
] as const;

/**
 * Extras opt-in via META_OAUTH_EXTRA_SCOPES (Vercel). Pedir permissão ainda
 * não aprovada na Revisão do App quebra o diálogo para quem não tem papel no
 * app; por isso nada aqui é padrão. ads_read = leitura de campanhas/Insights;
 * ads_management = criar/editar (só depois de aprovado e autorizado).
 */
export const META_OPTIONAL_SCOPES = [
  "ads_read",
  "ads_management",
  "pages_manage_posts",
  "instagram_content_publish",
] as const;

export function resolveOAuthScopes(extraRaw: string | undefined = process.env.META_OAUTH_EXTRA_SCOPES): string[] {
  const allowed = new Set<string>(META_OPTIONAL_SCOPES);
  const extras = (extraRaw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => allowed.has(s));
  return Array.from(new Set<string>([...META_BASE_SCOPES, ...extras]));
}
