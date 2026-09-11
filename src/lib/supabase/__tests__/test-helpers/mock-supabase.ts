/**
 * Helper compartilhado pelos testes comportamentais de rota (PROMPT 04E,
 * Fase 6-11): um mock mínimo e reutilizável do client Supabase (session e
 * admin), sem framework externo -- só o suficiente para os handlers reais
 * de admin/clients, meta/assets/link e olaclick/connect rodarem de ponta a
 * ponta com dependências externas substituídas, nunca a lógica da própria
 * rota.
 */

type AnyResult = { data?: unknown; error?: unknown };

function makeThenable(result: AnyResult) {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  builder.eq = passthrough;
  builder.is = passthrough;
  builder.in = passthrough;
  builder.order = passthrough;
  builder.limit = passthrough;
  builder.select = passthrough;
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  builder.then = (resolve: (v: AnyResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

type ResultOrQueue = AnyResult | AnyResult[];

function nextResult(queueState: Map<string, number>, key: string, value: ResultOrQueue): AnyResult {
  if (!Array.isArray(value)) return value;
  const i = queueState.get(key) ?? 0;
  queueState.set(key, Math.min(i + 1, value.length - 1));
  return value[Math.min(i, value.length - 1)] ?? { data: null, error: null };
}

export interface MockSupabaseOptions {
  user?: { id: string; email?: string } | null;
  profileRole?: string | null;
  /** fn name -> resultado fixo, fila de resultados (consumida em ordem), ou função(args) -> resultado */
  rpcResults?: Record<string, ResultOrQueue | ((args: Record<string, unknown>) => AnyResult)>;
  /** table -> { select?, update?, delete?, insert?, upsert? } cada um fixo ou fila */
  fromResults?: Record<string, Partial<Record<"select" | "update" | "delete" | "insert" | "upsert", ResultOrQueue>>>;
}

export interface RpcCall { fn: string; args: Record<string, unknown> }
export interface FromCall { table: string; op: "select" | "update" | "delete" | "insert" | "upsert"; payload?: unknown }

export function makeMockSupabaseClient(opts: MockSupabaseOptions = {}) {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: FromCall[] = [];
  const queueState = new Map<string, number>();

  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.user ?? null } }),
    },
    from(table: string) {
      return {
        select() {
          fromCalls.push({ table, op: "select" });
          const cfg = opts.fromResults?.[table]?.select;
          const fallback: AnyResult = { data: table === "profiles" ? { role: opts.profileRole ?? null } : null, error: null };
          return makeThenable(cfg ? nextResult(queueState, `${table}.select`, cfg) : fallback);
        },
        update(payload: unknown) {
          fromCalls.push({ table, op: "update", payload });
          const cfg = opts.fromResults?.[table]?.update;
          return makeThenable(cfg ? nextResult(queueState, `${table}.update`, cfg) : { error: null });
        },
        delete() {
          fromCalls.push({ table, op: "delete" });
          const cfg = opts.fromResults?.[table]?.delete;
          return makeThenable(cfg ? nextResult(queueState, `${table}.delete`, cfg) : { error: null });
        },
        insert(payload: unknown) {
          fromCalls.push({ table, op: "insert", payload });
          const cfg = opts.fromResults?.[table]?.insert;
          return makeThenable(cfg ? nextResult(queueState, `${table}.insert`, cfg) : { data: null, error: null });
        },
        upsert(payload: unknown) {
          fromCalls.push({ table, op: "upsert", payload });
          const cfg = opts.fromResults?.[table]?.upsert;
          return makeThenable(cfg ? nextResult(queueState, `${table}.upsert`, cfg) : { data: null, error: null });
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      const entry = opts.rpcResults?.[fn];
      const result: AnyResult = typeof entry === "function" ? entry(args) : (entry ? nextResult(queueState, `rpc.${fn}`, entry) : { data: null, error: null });
      return makeThenable(result);
    },
  };

  return { client, rpcCalls, fromCalls };
}

export const DENIED = { data: null, error: { code: "P0001", message: "permission_denied: sem acesso a este client_id" } };
export const RPC_MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function public.foo in the schema cache" } };
export const UNKNOWN_DB_ERROR = { data: null, error: { code: "XX000", message: "connection reset by peer" } };
export const OK = (data: unknown = null) => ({ data, error: null });
