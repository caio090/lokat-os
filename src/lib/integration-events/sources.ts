/**
 * FASE 1B — registro de source_systems autorizados a enviar eventos.
 * Cada integração tem seu PRÓPRIO segredo (nunca um segredo global),
 * lido de uma variável de ambiente -- nunca hardcoded, nunca no
 * client/browser (este arquivo só é importado por código server-side:
 * src/app/api/integrations/events/route.ts).
 *
 * Seção 8 do brief -- Tayannara é o primeiro caso real, mas é só mais
 * uma entrada deste registro genérico, igual a qualquer futuro agente
 * n8n ou produto conectado. Nenhum código específico de "tayannara" em
 * nenhum outro arquivo desta camada.
 */

export interface IntegrationSourceConfig {
  sourceSystem: string;
  label: string;
  /** Nome da variável de ambiente que guarda o segredo HMAC -- nunca o valor em si. */
  secretEnvVar: string;
  /** true só quando a env var correspondente está de fato configurada (ver isSourceConfigured()). */
  status: "configured" | "pending";
}

/**
 * Registro estático de QUAIS source_systems existem -- "configured"/
 * "pending" é resolvido em runtime por isSourceConfigured(), nunca
 * hardcoded aqui (senão divergiria do .env real).
 */
const REGISTERED_SOURCES: Omit<IntegrationSourceConfig, "status">[] = [
  { sourceSystem: "tayannara-brain", label: "Cérebro Tayannara", secretEnvVar: "LOKAT_INTEGRATION_SECRET_TAYANNARA_BRAIN" },
];

function isSourceConfigured(secretEnvVar: string): boolean {
  return !!process.env[secretEnvVar]?.trim();
}

export function getIntegrationSource(sourceSystem: string): IntegrationSourceConfig | null {
  const found = REGISTERED_SOURCES.find((s) => s.sourceSystem === sourceSystem);
  if (!found) return null;
  return { ...found, status: isSourceConfigured(found.secretEnvVar) ? "configured" : "pending" };
}

export function getIntegrationSourceSecret(sourceSystem: string): string | null {
  const found = REGISTERED_SOURCES.find((s) => s.sourceSystem === sourceSystem);
  if (!found) return null;
  const secret = process.env[found.secretEnvVar];
  return secret?.trim() ? secret : null;
}

/** Para a UI de status (platform-modules.ts) e documentação -- nunca expõe o valor do segredo. */
export function listIntegrationSources(): IntegrationSourceConfig[] {
  return REGISTERED_SOURCES.map((s) => ({ ...s, status: isSourceConfigured(s.secretEnvVar) ? "configured" : "pending" }));
}
