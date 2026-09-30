/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/meu-pp/__tests__/meu-pp-foundation.structural.test.ts
 * Meu PP V2 — Fase 0 (docs/meu-pp/README.md). Trava em teste:
 *   - privacidade (sessão do próprio usuário; nunca service role/admin bypass,
 *     Company context, productivity_* ou activity_logs);
 *   - contrato de segurança do SQL 97 (personal_entity_links) e da baseline
 *     Personal Core (service_role/anon revogados);
 *   - reconciliação do legado (sem 93–96 numerados, sem "PROPOSTA — NÃO EXECUTAR");
 *   - navegação de 5 itens com só HOJE ativa;
 *   - validação de aplicação da relação genérica (runtime).
 */
import * as fs from "fs";
import * as path from "path";
import { validatePersonalEntityLink, ACTIVE_ENTITY_TYPES, FUTURE_ENTITY_TYPES } from "../entity-links";
import { MEU_PP_SECTIONS, MEU_PP_ROUTE } from "../navigation";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(root, p));

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const page = read("src/app/admin/meu-pp/page.tsx") + "\n" + read("src/app/admin/meu-pp/_shell.tsx");
const today = read("src/lib/meu-pp/today.ts");
const entityLinks = read("src/lib/meu-pp/entity-links.ts");
const navigation = read("src/lib/meu-pp/navigation.ts");
const meuPpCode = [page, today, entityLinks, navigation].join("\n");
const sidebar = read("src/components/app-sidebar.tsx");
const layoutClient = read("src/app/admin/_layout-client.tsx");
const sql97 = read("docs/supabase/97-personal-entity-links.sql");
const rollback97 = read("docs/supabase/97-personal-entity-links-rollback.sql");
const testPlan97 = read("docs/supabase/97-personal-entity-links-test-plan.sql");
const PERSONAL_CORE = ["tasks", "routines", "gratitude", "events"] as const;

console.log("[test] 1 — privacidade: só a sessão do próprio usuário");
{
  assert(today.includes("createServerSupabaseClient()"), "today.ts lê com a sessão autenticada");
  assert(!/createSupabaseAdminClient|createRequiredSupabaseAdminClient|SERVICE_ROLE|service_role_key/i.test(meuPpCode.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")), "nenhum código do Meu PP usa admin client/service role (fora de comentários)");
  const reads = today.match(/\.from\("[a-z_]+"\)/g) ?? [];
  assert(reads.length > 0 && reads.every((r) => /personal_|gratitude_entries/.test(r)), "today.ts só consulta tabelas pessoais");
  assert((today.match(/\.eq\("user_id", user\.id\)/g) ?? []).length === reads.length, "toda consulta filtra user_id da sessão (defesa em profundidade além do RLS)");
}

console.log("[test] 2 — sem Company, sem productivity_*, sem activity_logs");
{
  const code = meuPpCode.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert(!/resolveCompanyContext|withCompanyContext|readCompanyContextParam|searchParams/.test(code), "Meu PP não lê ?client= nem resolve Company");
  assert(!/productivity_(tasks|meetings)/.test(code), "Meu PP não usa productivity_* (órfãs, visíveis ao admin)");
  assert(!/activity_logs/.test(code), "Meu PP não grava/lê activity_logs (domínio Company/admin)");
  assert(layoutClient.includes("isMeuPpPage") && /isMeuPpPage \? \([\s\S]*?\) : \(\s*<CompanyContextBar \/>/.test(layoutClient), "a barra de Company é ocultada na rota do Meu PP");
}

console.log("[test] 3 — rota e navegação");
{
  assert(MEU_PP_ROUTE === "/admin/meu-pp", "rota canônica /admin/meu-pp");
  assert(!exists("src/app/admin/meu-painel"), "nenhuma rota /admin/meu-painel criada (sem alias nesta fase)");
  assert(MEU_PP_SECTIONS.map((s) => s.label).join(",") === "Hoje,Capital,Mapa,Biblioteca,Revisão", "navegação aprovada: Hoje, Capital, Mapa, Biblioteca, Revisão");
  assert(MEU_PP_SECTIONS.filter((s) => s.active).map((s) => s.id).join(",") === "hoje", "só HOJE ativa na Fase 0");
  assert(MEU_PP_SECTIONS.filter((s) => !s.active).every((s) => s.href === null), "seções inativas não têm rota (sem telas vazias)");
  assert(sidebar.includes('href: "/admin/meu-pp"') && sidebar.includes('tag: "Pessoal"'), "sidebar admin tem Meu PP marcado como Pessoal");
  const scoped = sidebar.match(/const COMPANY_SCOPED_ROUTES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  assert(scoped.length > 0 && !scoped.includes("/admin/meu-pp"), "Meu PP fora de COMPANY_SCOPED_ROUTES (nunca recebe ?client=)");
  assert(!/<button/.test(page), "sem botões mortos no shell da Fase 0");
}

console.log("[test] 4 — SQL 97 personal_entity_links: contrato de segurança");
{
  assert(sql97.includes("REVOKE ALL ON TABLE public.personal_entity_links FROM PUBLIC, anon, authenticated, service_role;"), "REVOKE explícito de PUBLIC/anon/authenticated/service_role");
  assert(sql97.includes("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_entity_links TO authenticated;"), "GRANT só para authenticated");
  assert(!/GRANT[^;]*TO[^;]*(service_role|anon)/.test(sql97), "nenhum GRANT para service_role/anon");
  assert(sql97.includes("ALTER TABLE public.personal_entity_links ENABLE ROW LEVEL SECURITY"), "RLS habilitada");
  assert(/USING \(user_id = \(select auth\.uid\(\)\)\)\s*WITH CHECK \(user_id = \(select auth\.uid\(\)\)\)/.test(sql97), "policy do dono em USING e WITH CHECK");
  assert(!/source_id\s+UUID[^,\n]*REFERENCES|target_id\s+UUID[^,\n]*REFERENCES/.test(sql97) && sql97.includes("FK POLIMÓRFICA"), "sem FK fingida em source_id/target_id; limitação documentada");
  assert(sql97.includes("user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE"), "user_id obrigatório e ligado a auth.users");
  assert(!/personal_tasks|personal_routines|gratitude_entries|personal_events/.test(sql97.replace(/--[^\n]*/g, "")), "SQL 97 não altera nenhuma tabela Personal Core");
  const rbExec = rollback97.replace(/--[^\n]*/g, "");
  assert(rbExec.includes("DROP TABLE IF EXISTS public.personal_entity_links;") && !/personal_tasks|personal_routine|gratitude_entries|personal_events|set_updated_at/.test(rbExec), "rollback derruba só a tabela nova");
  assert(/service_role/.test(testPlan97) && /anon/.test(testPlan97) && /other_id/.test(testPlan97) && /RAISE EXCEPTION 'PERSONAL_ENTITY_LINKS_TEST/.test(testPlan97), "test plan cobre owner/outro/anon/service_role e sempre desfaz");
}

console.log("[test] 5 — legado Personal Core reconciliado");
{
  const numbered = fs.readdirSync(path.join(root, "docs/supabase")).filter((f) => /^9[3-6]-personal-core/.test(f));
  assert(numbered.length === 0, "nenhum arquivo 93–96 personal-core numerado na main (colisão resolvida)");
  for (const name of PERSONAL_CORE) {
    const f = `docs/supabase/legacy/personal-core-${name}.sql`;
    const sql = exists(f) ? read(f) : "";
    assert(sql.includes("LEGACY BASELINE") && sql.includes("APLICADA EM PRODUÇÃO EM 13/08/2026 — NÃO REEXECUTAR"), `${f}: cabeçalho de baseline aplicada`);
    assert(!sql.includes("PROPOSTA — NÃO EXECUTAR"), `${f}: sem o status histórico desmentido pelo ledger`);
    assert(/REVOKE ALL ON TABLE public\.[a-z_]+ FROM PUBLIC, anon, authenticated, service_role;/.test(sql), `${f}: preserva o REVOKE de service_role/anon`);
  }
  assert(!fs.readdirSync(path.join(root, "docs/supabase/legacy")).some((f) => f.includes("rollback")), "rollbacks destrutivos do legado NÃO foram trazidos");
}

console.log("[test] 6 — validação de aplicação da relação genérica");
{
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  assert(validatePersonalEntityLink({ sourceType: "task", sourceId: a, targetType: "client_project", targetId: b }).ok, "task → client_project (referência) é válido");
  assert(validatePersonalEntityLink({ sourceType: "event", sourceId: a, targetType: "task", targetId: b, relationType: "supports" }).ok, "event → task com relação conhecida é válido");
  assert(!validatePersonalEntityLink({ sourceType: "deal", sourceId: a, targetType: "task", targetId: b }).ok, "tipo futuro (deal) recusado na Fase 0");
  assert(!validatePersonalEntityLink({ sourceType: "task", sourceId: a, targetType: "task", targetId: a }).ok, "auto-relação recusada");
  assert(!validatePersonalEntityLink({ sourceType: "client_project", sourceId: a, targetType: "task", targetId: b }).ok, "client_project nunca é origem");
  assert(!validatePersonalEntityLink({ sourceType: "task", sourceId: "x", targetType: "task", targetId: b }).ok, "id que não é UUID recusado");
  assert(!validatePersonalEntityLink({ sourceType: "task", sourceId: a, targetType: "event", targetId: b, relationType: "owns" }).ok, "relation_type desconhecida recusada");
  assert(!validatePersonalEntityLink({ sourceType: "Task", sourceId: a, targetType: "event", targetId: b }).ok, "tipo fora do formato do banco recusado");
  assert(!ACTIVE_ENTITY_TYPES.some((t) => (FUTURE_ENTITY_TYPES as readonly string[]).includes(t)), "tipos ativos e futuros não se sobrepõem");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
