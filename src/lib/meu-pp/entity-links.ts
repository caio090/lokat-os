/**
 * Meu PP V2 — Fase 0: vocabulário da relação genérica entre objetos pessoais
 * (public.personal_entity_links, docs/supabase/97-personal-entity-links.sql).
 *
 * O banco só garante o FORMATO dos tipos (slug minúsculo) — o vocabulário
 * permitido vive AQUI e é validado na aplicação, para poder evoluir sem
 * migration de ENUM. source_id/target_id são polimórficos (sem FK): a
 * existência/propriedade do objeto é conferida pela camada que grava,
 * sempre com a sessão do próprio usuário (sob RLS das tabelas de origem).
 *
 * Só tipos com tabela real ficam ATIVOS. Os demais estão listados como
 * FUTUROS para documentação — `isAllowedEntityType` os recusa até a fase
 * correspondente ativá-los. Fase 1 ativou capture/reflection/decision e o
 * pseudo-tipo `operator` (o próprio dono: source_id = user_id), usado só em
 * `operator → in_focus → client_project` (projeto em foco em HOJE).
 */

/** Tipos com tabela real hoje (Personal Core + client_project por referência). */
export const ACTIVE_ENTITY_TYPES = [
  "task", // personal_tasks
  "routine", // personal_routines
  "routine_entry", // personal_routine_entries
  "gratitude", // gratitude_entries
  "event", // personal_events
  "client_project", // public.client_projects — SÓ o id; nunca copiar nome/status/cliente/financeiro
  // Fase 1
  "capture", // personal_quick_captures
  "reflection", // personal_reflections
  "decision", // personal_decisions
  "operator", // o próprio dono (source_id = user_id) — só como origem de in_focus
] as const;

/** Tipos planejados (docs/meu-pp/README.md) — ainda sem tabela; recusados na Fase 0. */
export const FUTURE_ENTITY_TYPES = [
  "personal_project",
  "capital",
  "deal",
  "thesis",
  "scenario",
  "risk",
  "milestone",
  "document",
  "knowledge",
] as const;

export const RELATION_TYPES = [
  "related_to",
  "derived_from",
  "supports",
  "changed",
  "supersedes",
  "references",
  "applies_to",
  "documented_by",
  "influenced",
  // Fase 1
  "resulted_in", // reflexão/decisão → tarefa que nasceu dela
  "in_focus", // operator → client_project (projeto em foco)
] as const;

/** Relações que a Fase 1 realmente grava — centralizadas aqui, nunca strings soltas em JSX. */
export const REL = {
  derivedFrom: "derived_from", // objeto → captura que o originou (gravado por personal_confirm_capture)
  supersedes: "supersedes", // decisão nova → decisão anterior (personal_supersede_decision)
  changed: "changed", // reflexão → decisão sobre a qual mudou de ideia
  relatedTo: "related_to", // reflexão → decisões tomadas no dia
  resultedIn: "resulted_in",
  inFocus: "in_focus",
} as const satisfies Record<string, (typeof RELATION_TYPES)[number]>;

export type ActiveEntityType = (typeof ACTIVE_ENTITY_TYPES)[number];
export type FutureEntityType = (typeof FUTURE_ENTITY_TYPES)[number];
export type PersonalRelationType = (typeof RELATION_TYPES)[number];

/** Mesmo formato do CHECK do banco — nunca aceitar algo que o banco recusaria. */
export const ENTITY_SLUG_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Limite do CHECK de metadata no banco (pg_column_size <= 4096). Folga para o overhead do jsonb. */
const METADATA_MAX_JSON_CHARS = 3000;

export const isAllowedEntityType = (t: string): t is ActiveEntityType => (ACTIVE_ENTITY_TYPES as readonly string[]).includes(t);
export const isAllowedRelationType = (t: string): t is PersonalRelationType => (RELATION_TYPES as readonly string[]).includes(t);

export type PersonalEntityLinkInput = {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType?: string;
  metadata?: Record<string, unknown>;
};

export type LinkValidation = { ok: true } | { ok: false; errors: string[] };

/**
 * Validação de aplicação (formato + vocabulário + regras do banco). Não
 * consulta o banco: a checagem de existência/propriedade do objeto é feita
 * por quem grava, com a sessão do usuário. `user_id` nunca vem do cliente —
 * é sempre o id da sessão autenticada.
 */
export function validatePersonalEntityLink(input: PersonalEntityLinkInput): LinkValidation {
  const errors: string[] = [];
  const relation = input.relationType ?? "related_to";
  for (const [label, type] of [["source_type", input.sourceType], ["target_type", input.targetType]] as const) {
    if (!ENTITY_SLUG_PATTERN.test(type)) errors.push(`${label} fora do formato`);
    else if (!isAllowedEntityType(type)) errors.push(`${label} "${type}" não está ativo nesta fase`);
  }
  if (!isAllowedRelationType(relation)) errors.push(`relation_type "${relation}" desconhecido`);
  if (!UUID_PATTERN.test(input.sourceId)) errors.push("source_id não é um UUID");
  if (!UUID_PATTERN.test(input.targetId)) errors.push("target_id não é um UUID");
  if (input.sourceType === input.targetType && input.sourceId.toLowerCase() === input.targetId.toLowerCase()) errors.push("um objeto não se relaciona consigo mesmo");
  if (input.sourceType === "client_project") errors.push("client_project só pode ser alvo (referência), nunca origem de uma relação pessoal");
  if (input.targetType === "operator") errors.push("operator só pode ser origem");
  if ((input.sourceType === "operator") !== (relation === "in_focus")) errors.push("operator só se usa em in_focus (e in_focus só parte do operator)");
  if (input.metadata !== undefined) {
    if (input.metadata === null || typeof input.metadata !== "object" || Array.isArray(input.metadata)) errors.push("metadata deve ser um objeto");
    else if (JSON.stringify(input.metadata).length > METADATA_MAX_JSON_CHARS) errors.push("metadata grande demais");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
