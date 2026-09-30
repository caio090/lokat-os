# Meu PP (V2)

> Um reflexo digital do operador: memória, pensamento, decisões, projetos,
> aprendizado e capital ao longo do tempo.

Documento técnico **canônico** do módulo. A auditoria que originou esta arquitetura está em [`architecture-audit-v2.md`](architecture-audit-v2.md).

Marcadores usados quando há risco de confusão:
- **[FATO]**: verificado no código ou no banco.
- **[ANTIGA]**: decisão do histórico (Personal Strategy OS / "Meu Painel").
- **[PROPOSTA]**: decisão nova, aprovada para as próximas fases.

---

## 1. Conceito
O Meu PP é o espaço **pessoal e privado** do operador. Não é caderno, dashboard financeiro, lista de tarefas nem "Notion pessoal". É um **reflexo** que precisa responder, hoje e daqui a dois anos:
- quem sou operacionalmente;
- o que estou construindo e aprendendo;
- onde está meu capital;
- quais decisões tomei e por quê;
- o que mudou na minha visão.

Por isso, **estado atual + histórico + evolução**: memória importante nunca é sobrescrita (decisões e teses são só acréscimo; snapshots de capital não se recalculam).

Ciclo mental (não é um workflow obrigatório): capturar → entender → estruturar → decidir → agir → medir → refletir → aprender → reorganizar.

Capital/Deals (investment banking pessoal) é uma **camada dentro** do Meu PP, não o produto inteiro.

**Teste de identidade:**
- sem Capital, ainda é o Meu PP;
- sem reflexão, memória e decisões, deixa de ser.

## 2. Escopo e nome
- Produto: **MEU PP**. Rota canônica: **`/admin/meu-pp`** [PROPOSTA aprovada na Fase 0].
- `/admin/meu-painel` (nome [ANTIGA]) **não** existe e não ganhou alias: não há compatibilidade real a preservar, porque nenhuma rota antiga chegou a existir [FATO].
- Acesso: shell `/admin`, protegido pelo `src/proxy.ts` (sem sessão → `/login`; só `admin`/`super_admin`) [FATO]. Não há segundo login.
- Dono: o usuário autenticado é dono dos próprios dados pessoais. Não existe compartilhamento.

## 3. Privacidade (regras estruturais)
`PERSONAL ≠ COMPANY ≠ PROJECT ≠ WORKSPACE_PRIVATE`. Dado pessoal nunca vaza para portal de cliente, Company, CRM ou contexto empresarial global.

1. **Toda leitura e escrita usa a sessão autenticada do próprio usuário** (`createServerSupabaseClient()`). Nunca `createSupabaseAdminClient()`, service role, bypass de admin, Company context ou contexto global.
2. **Banco — duas camadas independentes** em todas as tabelas pessoais [FATO, verificado ao vivo em 29/09/2026]:
   - GRANT: `anon` e `service_role` revogados; só `authenticated` com SELECT/INSERT/UPDATE/DELETE. Service role tem BYPASSRLS, então o que o barra é o REVOKE;
   - RLS: `user_id = auth.uid()` em USING e WITH CHECK.
3. **Nunca usar** `productivity_tasks` nem `productivity_meetings`: são órfãs no código, e o admin lê as linhas de todos.
4. **Nunca registrar dado pessoal** em `activity_logs` (domínio Company/admin, o admin lê tudo). Histórico pessoal futuro terá mecanismo próprio.
5. Na UI, a rota do Meu PP **oculta a barra de Company** (mostra "Pessoal · privado"). O link na sidebar nunca recebe `?client=`, e a página não lê `?client=`.
6. IA (futura, Fase 8): organiza, resume, conecta, recupera e compara. Nunca diz "compre/venda/aloque", nunca decide.

Esses contratos estão travados em `src/lib/meu-pp/__tests__/meu-pp-foundation.structural.test.ts`.

## 4. Fonte da verdade

| Domínio | Fonte da verdade |
|---|---|
| PERSONAL | `personal_*` + `gratitude_entries` + futuras tabelas pessoais (mesmo padrão de segurança) |
| COMPANY | `clients` / `client_context` / diagnóstico |
| PROJECT | `client_projects`. O Meu PP **referencia só pelo id** (via `personal_entity_links`) e nunca copia nome, status, cliente ou financeiro |
| FINANCE COMPANY | `finance_*` / `billing_*` (a LOKAT cobrando seus clientes) |
| CAPITAL PERSONAL | domínio **novo** (Fase 2). Nunca compartilha autoridade com os caixas Company |
| CALENDAR PERSONAL | `personal_events`. `/admin/calendario` é Company e não se mistura |

## 5. Navegação
**HOJE · CAPITAL · MAPA · BIBLIOTECA · REVISÃO**, no máximo 5 itens (`src/lib/meu-pp/navigation.ts`).
- Deals vivem **dentro de Capital**.
- Decisões aparecem em Hoje (pendentes) e no Mapa (histórico).
- A captura ("O que está na sua cabeça?") fica sempre acessível, fora da navegação (Fase 1).
- Na Fase 0 só **HOJE** está ativa. As demais aparecem como "em breve", sem rota nem tela vazia.

## 6. Banco (estado na Fase 0)

### 6.1 Personal Core — baseline legada [FATO]
Aplicada em produção em **13/08/2026**. Ledger `supabase_migrations.schema_migrations`:

| Versão | Nome | Tabelas | Baseline em `docs/supabase/legacy/` |
|---|---|---|---|
| 20260813200621 | personal_core_tasks | `personal_tasks` | `personal-core-tasks.sql` |
| 20260813200750 | personal_core_routines | `personal_routines`, `personal_routine_entries` | `personal-core-routines.sql` |
| 20260813200856 | personal_core_gratitude | `gratitude_entries` | `personal-core-gratitude.sql` |
| 20260813200949 | personal_core_events | `personal_events` | `personal-core-events.sql` |

- O corpo executável dos arquivos é **idêntico** ao SQL do ledger (hash normalizado), e o schema vivo foi conferido objeto a objeto: **sem drift**. **NÃO REEXECUTAR.**
- Origem: branch `origin/feat/personal-strategy-os` (commit `85f3353`), usada só como fonte histórica, sem merge.
- A numeração antiga 93–96 colidia com a `main` (`93-identity-links`, `93-studio-visual-assets-storage`) e foi abandonada.
- Os rollbacks antigos **não** foram trazidos, porque derrubariam tabelas reais.
- `personal-core-test-plan.sql` preserva o roteiro manual de verificação.
- Os `COMMENT ON` gravados no banco ainda citam "SQL 93"; leia como `legacy/personal-core-tasks.sql`.
- Campos legados `related_entity_type`/`related_entity_id` em `personal_tasks`/`personal_events` (CHECK só `client_project`): **mantidos compatíveis e não ampliados**. Novas relações usam `personal_entity_links`, e a migração futura desses campos será planejada à parte.

### 6.2 `personal_entity_links` — SQL 97 (Fase 0) [FATO]
- Arquivos: `docs/supabase/97-personal-entity-links.sql`, `-rollback.sql` e `-test-plan.sql`. Aplicado em 29/09/2026 (ledger `20260929175139 personal_entity_links`).
- Número 97: próximo slot livre real (93–96 não são reutilizados).
- Modelo: `user_id → (source_type, source_id) —relation_type→ (target_type, target_id)` + `metadata` (objeto ≤ 4 KB).
- Tipos sem ENUM. O banco valida só o formato (slug); o vocabulário vive em `src/lib/meu-pp/entity-links.ts`:
  - ativos na Fase 0: `task`, `routine`, `routine_entry`, `gratitude`, `event`, `client_project` (esta última só como alvo, só o id);
  - futuros: `capture`, `reflection`, `decision`, `personal_project`, `capital`, `deal`, `thesis`, `scenario`, `risk`, `milestone`, `document`, `knowledge`;
  - relações: `related_to`, `derived_from`, `supports`, `changed`, `supersedes`, `references`, `applies_to`, `documented_by`, `influenced`.
- **Limitação documentada:** `source_id`/`target_id` são polimórficos e **não têm FK**. Integridade e propriedade do objeto são validadas na aplicação, com a sessão do usuário (sob RLS das tabelas de origem). Links órfãos são tolerados.
- Segurança: mesmo padrão da baseline. Test plan executado ao vivo: **PASS 20/20** (owner CRUD, outro usuário isolado, anon e service_role sem acesso, constraints), com rollback automático e nenhuma linha persistida.

## 7. Código (Fase 0)

| Caminho | Papel |
|---|---|
| `src/app/admin/meu-pp/page.tsx` | shell (server component): cabeçalho, 5 seções, HOJE com estado vazio honesto |
| `src/lib/meu-pp/today.ts` | contagens de HOJE: tarefas em aberto, agenda do dia (fuso America/Fortaleza), rotinas ativas. Só sessão do usuário, `user_id` explícito |
| `src/lib/meu-pp/navigation.ts` | seções e prévia textual da Fase 1 |
| `src/lib/meu-pp/entity-links.ts` | vocabulário e validação da relação genérica |
| `src/components/app-sidebar.tsx` | item "Meu PP" com etiqueta **Pessoal**; fora de `COMPANY_SCOPED_ROUTES` |
| `src/app/admin/_layout-client.tsx` | na rota do Meu PP, troca a barra de Company pelo selo "Pessoal · privado" |

- Nenhum dado é semeado nem inventado.
- O estado vazio mostra "Ainda não há nada aqui." e a prévia textual da Fase 1, sem botões mortos. O botão "Começar meu dia" fica para a Fase 1, quando houver ação real.

## 8. Entidades (modelo conceitual V2 — sem SQL até a fase correspondente)

| Onda | Entidades |
|---|---|
| Existentes | PersonalTask, PersonalRoutine (+Entry), GratitudeEntry (vira bloco do fechamento diário), PersonalEvent, PersonalEntityLink |
| Fase 1 | QuickCapture (sugestão → **confirmação humana** → objeto real; nunca grava sozinha), Reflection, Decision (ledger, só acréscimo, `supersedes`), PersonalProject (pode apontar para `client_project` só por id) |
| Fase 2 | CapitalAccount (ativos e passivos por tipo, extensível), ValuationSnapshot, CapitalCommitment |
| Fase 3 | Deal (RADAR → … → ENCERRADO / DESCARTADO; qualidade ≠ status), InvestmentThesis (versões), Assumption (válida/mudou/invalidada), DealScenario (conservador/base/otimista, só com premissas), Risk |
| Fase 4 | Milestone. O Mapa é uma **visão** montada a partir das datas (passado sólido, "estamos aqui", futuro como hipótese) |
| Fase 5 | Document + bucket **privado novo** (os atuais: `client-visual-assets` só aceita imagens e `rec-videos` é público) |
| Fase 6 | KnowledgeItem (status NOVO → DOMINADO, sem gamificação); Framework como cadastro em código |

Descartadas ou adiadas:
- Learning como tabela (vira campo de Reflection e status de Knowledge);
- Asset e Liability separados;
- Goal (vira Milestone);
- CashMovement (adiado);
- Framework como tabela.

## 9. Reuso

| Capacidade | Ação |
|---|---|
| `personal_*`, `gratitude_entries` | **REUSAR** |
| Relações entre objetos | **NOVO**: `personal_entity_links` (em vez de FKs espalhadas) |
| Transcrição de voz (`/api/jarvis/transcribe`, áudio só em memória) | **REUSAR** na captura |
| Jarvis / Neural Core (escopos só `global/company/project/module/item`) | **ESTENDER** só na Fase 8, com escopo `personal` e política de visibilidade própria, sem misturar com Company |
| Proveniência e confiança (`neural-core/provenance`) | **REUSAR** |
| `productivity_*`, `activity_logs`, `client_files`, `roadmap_items`, `finance_*` | **NÃO usar** para dado pessoal |

## 10. Fases

| Fase | Escopo | Estado |
|---|---|---|
| 0 | Reconciliação: baseline legada na `main`, `personal_entity_links`, rota, privacidade, docs | **concluída** |
| 1 | HOJE + CAPTURA + REFLEXO DO DIA (com gratidão) + DECISÕES + continuar projeto | próxima |
| 2 | Capital | — |
| 3 | Deals + tese + premissas + cenários | — |
| 4 | Mapa Vivo + mudança de opinião | — |
| 5 | Documentos / PDF | — |
| 6 | Biblioteca + Frameworks | — |
| 7 | Revisões semanal e mensal, "Meu Reflexo de <mês>", Investment Memo (sem inventar nada) | — |
| 8 | Jarvis com escopo pessoal | — |
| 9 | Fontes externas / automações | — |

Fora do escopo até decisão explícita: Open Finance, corretora, cotação em tempo real, recomendação financeira, contabilidade e imposto, ERP, novo CRM, novo assistente.

## 11. Riscos
- **Big-bang:** entregar em fases de no máximo 4–5 entidades.
- **Privacidade:** qualquer caminho por service role, admin client, `activity_logs`, `productivity_*`, bucket público ou contexto global do Jarvis vaza dado pessoal. As regras da seção 3 e o teste estrutural são obrigatórios.
- **Duplicação:** tasks, projetos e financeiro têm fontes da verdade fixas (seção 4).
- **Escopo:** Capital/Deals não podem virar plataforma de investimentos antes de o núcleo pessoal estar em uso.
- **Numeração de migrations:** já colidiu uma vez (93–96). Antes de cada SQL novo, conferir o próximo slot livre real da `main`.
- **FK polimórfica:** `personal_entity_links` depende de validação de aplicação; links órfãos precisam ser tolerados na leitura.
