/**
 * Prompt 24 (Dedicated Creative Series Workspace) — FASE 02: o route
 * param `seriesId` de `/admin/contentos/visual/series/[seriesId]`
 * precisa ser validado como UUID ANTES de qualquer consulta ao banco
 * (nunca deixa um valor arbitrário da URL chegar a uma query
 * `.eq("id", seriesId)` sem essa checagem mínima de formato -- barato,
 * determinístico, e evita erro genérico de driver virar 500 em vez de
 * um 404 previsível).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidCreativeSeriesRouteId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
