/**
 * Versão da Graph API / Marketing API da Meta usada pelo app.
 *
 * META_API_VERSION (Vercel) tem prioridade. O padrão acompanha a versão
 * corrente conferida na documentação oficial em 2026-11-22: v26.0
 * (https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/).
 * O padrão anterior (v21.0) já saiu do período de suporte. Chamadas sem
 * versão são inválidas na Marketing API, por isso nunca omitir.
 */
export const DEFAULT_META_API_VERSION = "v26.0";

const VERSION_PATTERN = /^v\d{2,3}\.0$/;

export function resolveMetaApiVersion(raw: string | undefined = process.env.META_API_VERSION): string {
  const value = raw?.trim();
  return value && VERSION_PATTERN.test(value) ? value : DEFAULT_META_API_VERSION;
}
