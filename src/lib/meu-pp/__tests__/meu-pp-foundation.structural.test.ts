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
import { addDays, buildCapturePreview, dayBounds, isRoutineApplicable, orderSuggestions, suggestCaptureType, weekdayOf } from "../domain";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(root, p));

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const page = read("src/app/admin/meu-pp/page.tsx") + "\n" + read("src/app/admin/meu-pp/_shell.tsx");
const today = read("src/lib/meu-pp/today.ts");
const entityLinks = read("src/lib/meu-pp/entity-links.ts");
const navigation = read("src/lib/meu-pp/navigation.ts");
const serverLib = read("src/lib/meu-pp/server.ts");
const domainLib = read("src/lib/meu-pp/domain.ts");
const API_ROUTES = ["tasks", "events", "routines", "captures", "decisions", "day", "focus", "history"] as const;
const apiFiles = Object.fromEntries(API_ROUTES.map((r) => [r, read(`src/app/api/admin/meu-pp/${r}/route.ts`)])) as Record<(typeof API_ROUTES)[number], string>;
const COMPONENTS = fs.readdirSync(path.join(root, "src/app/admin/meu-pp/_components")).filter((f) => f.endsWith(".tsx"));
const ui = COMPONENTS.map((f) => read(`src/app/admin/meu-pp/_components/${f}`)).join("\n");
const meuPpCode = [page, today, entityLinks, navigation, serverLib, domainLib, ui, ...Object.values(apiFiles)].join("\n");
const sql98 = read("docs/supabase/98-personal-brain-phase1.sql");
const rollback98 = read("docs/supabase/98-personal-brain-phase1-rollback.sql");
const testPlan98 = read("docs/supabase/98-personal-brain-phase1-test-plan.sql");
const stripComments = (c: string) => c.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
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
  const personalReads = reads.filter((r) => /personal_|gratitude_entries/.test(r));
  const otherReads = reads.filter((r) => !/personal_|gratitude_entries/.test(r));
  assert(personalReads.length > 0 && otherReads.every((r) => r === '.from("client_projects")') && otherReads.length <= 1, "today.ts só consulta tabelas pessoais (+ client_projects do projeto em foco, pela sessão)");
  assert((today.match(/\.eq\("user_id", uid\)/g) ?? []).length === personalReads.length, "toda consulta pessoal filtra user_id da sessão (defesa em profundidade além do RLS)");
  assert(/const uid = user\.id/.test(today) || /uid = user\.id/.test(today), "uid vem de auth.getUser() da sessão");
}

console.log("[test] 2 — sem Company, sem productivity_*, sem activity_logs");
{
  const code = meuPpCode.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert(!/resolveCompanyContext|withCompanyContext|readCompanyContextParam|searchParams\.get\("client"\)/.test(code) && !/searchParams/.test(stripComments(page)), "Meu PP não lê ?client= nem resolve Company");
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
  assert(!/<button/.test(page), "shell server sem botões (interação só nos componentes client)");
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
  assert(!validatePersonalEntityLink({ sourceType: "deal", sourceId: a, targetType: "task", targetId: b }).ok, "tipo futuro (deal) recusado");
  assert(validatePersonalEntityLink({ sourceType: "operator", sourceId: a, targetType: "client_project", targetId: b, relationType: "in_focus" }).ok, "operator → in_focus → client_project válido (Fase 1)");
  assert(!validatePersonalEntityLink({ sourceType: "task", sourceId: a, targetType: "client_project", targetId: b, relationType: "in_focus" }).ok, "in_focus só parte do operator");
  assert(!validatePersonalEntityLink({ sourceType: "operator", sourceId: a, targetType: "task", targetId: b }).ok, "operator só em in_focus");
  assert(!validatePersonalEntityLink({ sourceType: "task", sourceId: a, targetType: "task", targetId: a }).ok, "auto-relação recusada");
  assert(!validatePersonalEntityLink({ sourceType: "client_project", sourceId: a, targetType: "task", targetId: b }).ok, "client_project nunca é origem");
  assert(!validatePersonalEntityLink({ sourceType: "task", sourceId: "x", targetType: "task", targetId: b }).ok, "id que não é UUID recusado");
  assert(!validatePersonalEntityLink({ sourceType: "task", sourceId: a, targetType: "event", targetId: b, relationType: "owns" }).ok, "relation_type desconhecida recusada");
  assert(!validatePersonalEntityLink({ sourceType: "Task", sourceId: a, targetType: "event", targetId: b }).ok, "tipo fora do formato do banco recusado");
  assert(!ACTIVE_ENTITY_TYPES.some((t) => (FUTURE_ENTITY_TYPES as readonly string[]).includes(t)), "tipos ativos e futuros não se sobrepõem");
}

console.log("[test] 7 — Fase 1: API pessoal (sessão própria, sem Company, mutações protegidas)");
{
  assert(/auth\.getUser\(\)/.test(serverLib) && serverLib.includes("createServerSupabaseClient()"), "personalSession usa a sessão autenticada");
  for (const r of API_ROUTES) {
    const code = stripComments(apiFiles[r]);
    assert(code.includes("personalSession()"), `${r}: autentica com personalSession`);
    assert(!/createSupabaseAdminClient|createRequiredSupabaseAdminClient|SERVICE_ROLE|service_role/i.test(code), `${r}: sem admin client/service role`);
    assert(!/resolveCompanyContext|withCompanyContext|readCompanyContextParam|searchParams\.get\("client"\)/.test(code), `${r}: sem Company context`);
    assert(!/productivity_|activity_logs|finance_|billing_/.test(code), `${r}: sem productivity_*/activity_logs/finance_*/billing_*`);
    const mutations = code.match(/export (async function|const) (POST|PATCH|PUT|DELETE)\b/g) ?? [];
    assert(mutations.every((m) => code.includes(`${m.split(" ").pop()} = withMutationProtection`) || new RegExp(`export const ${m.split(" ").pop()} = withMutationProtection`).test(code)), `${r}: toda mutação passa por withMutationProtection`);
    assert(!/export async function (POST|PATCH|PUT|DELETE)\b/.test(code), `${r}: nenhuma mutação exportada sem proteção`);
  }
  const froms = Object.values(apiFiles).flatMap((c) => stripComments(c).match(/\.from\("[a-z_]+"\)/g) ?? []);
  assert(froms.every((f) => /personal_|gratitude_entries|client_projects/.test(f)), "API só toca tabelas pessoais (+ leitura de client_projects para o foco)");
  assert(!/\.from\("client_projects"\)\.(insert|update|delete|upsert)/.test(Object.values(apiFiles).join("\n")), "client_projects nunca é escrito pelo Meu PP");
  assert(/rpc\("personal_confirm_capture"/.test(apiFiles.captures), "captura confirmada é atômica (RPC)");
  assert(/rpc\("personal_supersede_decision"/.test(apiFiles.decisions), "mudar de ideia é atômico (RPC) e nunca edita a decisão anterior");
  assert(!/\.from\("personal_decisions"\)\.update\([^)]*decision:/.test(apiFiles.decisions), "API não reescreve o conteúdo de uma decisão");
  assert(/MAX_PRIORITIES/.test(apiFiles.tasks) && /"limit"/.test(apiFiles.tasks), "limite de 3 prioridades validado na API");
}

console.log("[test] 8 — Fase 1: SQL 98 (reflexo, decisões, captura)");
{
  for (const t of ["personal_quick_captures", "personal_reflections", "personal_decisions"]) {
    assert(sql98.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`), `${t}: RLS habilitada`);
    assert(sql98.includes(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated, service_role;`), `${t}: REVOKE explícito (inclui service_role)`);
  }
  assert(!/GRANT[^;]*TO[^;]*(service_role|anon)/.test(sql98), "nenhum GRANT para service_role/anon");
  assert(!/SECURITY DEFINER/.test(sql98.replace(/--[^\n]*/g, "")), "funções são SECURITY INVOKER (RLS do dono vale dentro delas)");
  assert(/forbid_personal_decision_rewrite/.test(sql98) && /24 hours|interval '24/.test(sql98), "decisão imutável depois de 24h (trigger)");
  assert(/WHERE kind = 'daily'/.test(sql98), "um reflexo diário por dia (índice único parcial)");
  assert(!/embedding|vector\(/i.test(sql98), "sem embeddings nesta fase");
  assert(/DROP TABLE IF EXISTS public\.personal_decisions/.test(rollback98) && !/DROP TABLE IF EXISTS public\.(personal_tasks|personal_events|personal_routines|gratitude_entries|personal_entity_links)\b/.test(rollback98), "rollback derruba só objetos do SQL 98");
  assert(/service_role/.test(testPlan98) && /anon/.test(testPlan98) && /RAISE EXCEPTION 'PERSONAL_BRAIN_PHASE1_TEST/.test(testPlan98), "test plan cobre outro/anon/service_role e sempre desfaz");
}

console.log("[test] 9 — Fase 1: UI da HOJE");
{
  const uiCode = stripComments(ui);
  assert(!/fetch\([^)]*supabase|createBrowserClient|@supabase/.test(uiCode), "componentes client não falam direto com o Supabase (só /api/admin/meu-pp)");
  assert(/useJarvisVoice/.test(uiCode) && !/\/api\/jarvis\/(chat|agent|actions)/.test(uiCode), "voz reusa só a transcrição do Jarvis (sem ampliar o escopo)");
  assert(ui.includes("Nada é salvo antes de você confirmar."), "captura deixa explícito que nada é salvo sem confirmação");
  assert(ui.includes("Um espaço para organizar o que você pensa, decide, aprende e constrói.") && /Começar meu dia/i.test(ui), "primeiro uso: frase e CTA COMEÇAR MEU DIA");
  assert(!/streak|\bxp\b|badge|conquista|humor|mood|pontua[cç][aã]o/i.test(uiCode.replace(/Sem streak, sem pontuação|sem humor/gi, "")), "sem gamificação nem score emocional");
  assert(!/Capital|Deals|Thesis|Mapa Vivo|Open Finance|cota[cç][aã]o/.test(uiCode), "sem módulos fora do escopo da Fase 1");
  assert(/<dialog/.test(ui) && /aria-labelledby|aria-label/.test(ui), "sheets usam <dialog> nativo com rótulo acessível");
}

console.log("[test] 10 — Fase 1: domínio (datas Fortaleza, rotinas, sugestões, captura)");
{
  assert(addDays("2026-02-28", 1) === "2026-03-01" && addDays("2026-12-31", 1) === "2027-01-01", "addDays atravessa mês/ano");
  assert(dayBounds("2026-09-30").startIso === "2026-09-30T00:00:00-03:00" && dayBounds("2026-09-30").endIso === "2026-10-01T00:00:00-03:00", "limites do dia em -03:00 (nunca UTC)");
  assert(weekdayOf("2026-09-30") === 3, "weekdayOf (quarta = 3)");
  const base = { days_of_week: null, day_of_month: null, active: true };
  assert(isRoutineApplicable({ ...base, frequency_type: "daily" }, "2026-09-30"), "rotina diária vale hoje");
  assert(!isRoutineApplicable({ ...base, frequency_type: "daily", active: false }, "2026-09-30"), "rotina arquivada não aparece");
  assert(isRoutineApplicable({ ...base, frequency_type: "specific_days", days_of_week: [1, 3] }, "2026-09-30") && !isRoutineApplicable({ ...base, frequency_type: "specific_days", days_of_week: [1] }, "2026-09-30"), "dias específicos");
  assert(isRoutineApplicable({ ...base, frequency_type: "monthly", day_of_month: 31 }, "2026-09-30"), "mensal dia 31 cai no último dia de mês curto");
  const t = (id: string, priority: "high" | "medium" | "low" | null, due_at: string | null) => ({ id, priority, sort_order: 0, due_at, created_at: "2026-09-01T12:00:00Z" });
  const ordered = orderSuggestions([t("later", "high", null), t("today", "low", "2026-09-30T15:00:00-03:00"), t("late", "low", "2026-09-29T10:00:00-03:00")], "2026-09-30").map((x) => x.id).join(",");
  assert(ordered === "late,today,later", "sugestões: atrasada → vence hoje → resto");
  assert(suggestCaptureType("Ligar para o contador amanhã") === "task", "cenário B: tarefa sugerida");
  assert(suggestCaptureType("Decidi não aceitar o projeto porque o prazo é curto") === "decision", "cenário C: decisão sugerida");
  assert(suggestCaptureType("Hoje percebi que trabalho melhor de manhã") === "reflection", "reflexão sugerida");
  assert(suggestCaptureType("Reunião com a Ana às 10h") === "event", "evento sugerido");
  assert(suggestCaptureType("ideia: app de receitas") === "note", "sem sinal claro → nota");
  const task = buildCapturePreview("Ligar para o contador amanhã", "task", "2026-09-30");
  assert(task.title === "Ligar para o contador" && task.dueDate === "2026-10-01", "preview de tarefa tira 'amanhã' do título e vira prazo");
  const dec = buildCapturePreview("Decidi não aceitar o projeto porque o prazo é curto.", "decision", "2026-09-30");
  assert(dec.title === "Não aceitar o projeto" && dec.rationale === "o prazo é curto", "preview de decisão separa decisão e porquê");
  const ev = buildCapturePreview("Dentista amanhã às 15h", "event", "2026-09-30");
  assert(ev.title === "Dentista" && ev.date === "2026-10-01" && ev.time === "15:00", "preview de evento extrai dia e hora");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
