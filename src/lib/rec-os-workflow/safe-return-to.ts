/**
 * Prompt 26 (Dedicated Series Workspace Completion) — FASE 17/37: "Não
 * aceitar redirect aberto arbitrário... nunca redirecionar pra URL
 * externa controlada por query string." O EditorOS já tinha essa
 * checagem localmente (`sanitizeReturnTo`, editor-os/page.tsx) mas só
 * pro PRÓPRIO destino; o Studio (`launch-context.ts`, usado tanto pelo
 * fluxo de peça única quanto pelo novo workspace de série) nunca
 * sanitizava `return_to` antes de usá-lo em `router.push()` — gap
 * pré-existente descoberto ao implementar "Usar no conteúdo"/"Abrir no
 * EditorOS" do workspace dedicado. Extraído aqui como utilitário
 * compartilhado (mesma lista de prefixos bloqueados do EditorOS) em vez
 * de duplicar a lógica ou inventar um segundo mecanismo.
 */
const ALLOWED_INTERNAL_PREFIX = "/admin/";
const BLOCKED_PREFIXES = ["http://", "https://", "//", "javascript:", "data:"];

/**
 * Nunca lança. Um `raw` ausente, vazio, ou que não aponte pra uma rota
 * interna `/admin/...` sempre devolve `fallback` (que o chamador
 * garante ser uma rota interna segura) — nunca deixa passar uma URL
 * externa/protocolo perigoso controlado por query string.
 */
export function sanitizeInternalReturnTo(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (BLOCKED_PREFIXES.some((p) => decoded.startsWith(p))) return fallback;
  if (!decoded.startsWith(ALLOWED_INTERNAL_PREFIX)) return fallback;
  return decoded;
}
