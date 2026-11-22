/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/marketing-ops/__tests__/marketing-ops.structural.test.ts
 *
 * Garantias estruturais: o domínio não chama rede; o cliente Meta não faz
 * POST nem ativa veiculação; nenhum token é logado; a migração 105 cobre
 * RLS em todas as tabelas, FKs compostas e o fluxo de publicação; enums do
 * TypeScript batem com os CHECKs do SQL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_STATUSES, FUNNEL_STAGE_KINDS, LAUNCH_MODELS, CONVERSION_SOURCES, FUNNEL_FRAMEWORKS } from "../types";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

// Rodar da raiz do repositório (o executor é ES module, sem __dirname).
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const domain = ["types.ts", "workflow.ts", "metrics.ts", "frameworks.ts", "funnel-analysis.ts"].map((f) => read(`src/lib/marketing-ops/${f}`)).join("\n");
const marketingApi = read("src/lib/meta/marketing-api.ts");
const tokenLife = read("src/lib/meta/token-lifecycle.ts");
const sql = read("docs/supabase/105-marketing-operations-NOT-APPLIED.sql");
const callback = read("src/app/api/meta/callback/route.ts");
const assets = read("src/app/api/meta/assets/route.ts");

assert(!/\bfetch\(|graph\.facebook\.com|createSupabase/.test(domain), "1. domínio marketing-ops é puro (sem rede/banco)");
assert(!/method:\s*["']POST["']\s*}\s*\)|fetchImpl\([^)]*,\s*\{\s*method/.test(marketingApi) && !/"ACTIVE"/.test(marketingApi), "2. cliente Marketing API não envia POST nem usa ACTIVE");
const semComentarios = (src: string) => src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
assert(!/console\.(log|warn|error)\([^;]*\b(accessToken|access_token|token)\b/i.test(semComentarios(marketingApi + tokenLife + callback)), "3. nenhum token em log");
assert(/token_expires_at:/.test(callback) && /scopes:/.test(callback) && /exchangeForLongLivedToken/.test(callback), "4. callback grava validade e escopos e troca por token longo");
assert(/createSupabaseAdminClient\(\)/.test(assets.split("Busca token ativo")[0]), "5. /api/meta/assets lê token pelo servidor");

const tables = Array.from(sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(mkt_[a-z_]+)/g)).map((m) => m[1]);
const rlsBlock = sql.slice(sql.indexOf("── 11. RLS"));
assert(tables.length === 14 && tables.every((t) => rlsBlock.includes(`'${t}'`)), "6. as 14 tabelas mkt_* entram no bloco de RLS");
assert(tables.filter((t) => t !== "mkt_metric_benchmarks").every((t) => new RegExp(`${t}[\\s\\S]*?client_id\\s+uuid NOT NULL`).test(sql)), "7. toda tabela tem client_id NOT NULL");
assert((sql.match(/REFERENCES public\.mkt_[a-z_]+ \(id, client_id\)/g) ?? []).length >= 20, "8. vínculos entre tabelas por FK composta (id, client_id)");
assert(/can_access_client_company\(client_id\)/.test(sql) && !/USING \(true\)/i.test(sql), "9. leitura pelo helper único de ownership, sem policy aberta");
assert(!/access_token|refresh_token/.test(sql.replace(/--.*$/gm, "")), "10. nenhuma coluna de token nas tabelas novas");
assert(sql.includes("ESTADO: NÃO APLICADA"), "11. migração marcada como não aplicada");

const checkList = (col: string) => { const m = sql.match(new RegExp(`${col}[^\\n]*\\n?[^\\n]*CHECK \\(${col} IN \\(([^)]*)\\)`)); return m ? m[1].replace(/'/g, "").split(",").map((s) => s.trim()) : []; };
const same = (a: readonly string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
assert(same(WORKFLOW_STATUSES, checkList("status").length === 7 ? checkList("status") : (sql.match(/CHECK \(status IN \(('rascunho', 'em_revisao'[^)]*)\)\)/)?.[1] ?? "").replace(/'/g, "").split(",").map((s) => s.trim())), "12. status do TS = CHECK do SQL");
assert(same(FUNNEL_STAGE_KINDS, checkList("kind")), "13. tipos de etapa TS = SQL");
assert(same(LAUNCH_MODELS, checkList("launch_model")), "14. modelos de lançamento TS = SQL");
assert(same(CONVERSION_SOURCES, checkList("source").length ? checkList("source") : []), "15. fontes de conversão TS = SQL");
assert(same(FUNNEL_FRAMEWORKS, checkList("framework")), "16. frameworks TS = SQL");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
