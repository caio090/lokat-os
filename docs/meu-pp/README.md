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

Esses contratos (incluindo a API e a UI da Fase 1) estão travados em `src/lib/meu-pp/__tests__/meu-pp-foundation.structural.test.ts`.

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
- A captura ("O que está na sua cabeça?") fica sempre acessível, fora da navegação: no topo da HOJE e, no celular, num atalho flutuante que aparece quando a caixa sai da tela.
- Na Fase 0 e na Fase 1 só **HOJE** está ativa. As demais aparecem como "em breve", sem rota nem tela vazia.

## 6. Banco

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

### 6.3 Cérebro pessoal — SQL 98 (Fase 1) [FATO]
- Arquivos: `docs/supabase/98-personal-brain-phase1.sql`, `-rollback.sql` e `-test-plan.sql`. Aplicado em 30/09/2026 (ledger `20260930142105 personal_brain_phase1`).
- Test plan executado ao vivo: **PASS 33/33** (fluxos de captura, decisão e substituição, imutabilidade, outro usuário, anon, service_role), com rollback automático e nenhuma linha persistida.
- Mesmo padrão de segurança da seção 3: RLS do dono, GRANT só para `authenticated`, REVOKE de PUBLIC/anon/service_role em tabelas **e funções**. Funções são SECURITY INVOKER.

| Objeto | Papel |
|---|---|
| `personal_tasks.focus_date` | "prioridade do dia": tarefa existente destacada para um dia. Sem tabela nova, sem duplicar conteúdo. Máximo de 3 por dia, validado na API |
| `personal_quick_captures` | registro da captura **confirmada** (`raw_text`, `source` text/voice, tipo sugerido e tipo confirmado). "Ideia/nota" fica `inbox` até virar tarefa ou ser descartada (`dismissed`, mantida; sem auto delete) |
| `personal_reflections` | reflexo do dia: o que mudou, aprendizado, o que ficou aberto, próxima ação, mudança de visão, texto livre. Um `daily` por dia (índice único parcial) |
| `personal_decisions` | Decision Ledger: decisão, porquê, contexto, alternativas, premissas, riscos aceitos, gatilho e data de revisão, `status` active/superseded, `supersedes_decision_id` |
| `personal_confirm_capture(...)` | captura confirmada → objeto real + captura + link `derived_from`, numa transação |
| `personal_supersede_decision(...)` | "eu pensava → agora penso": nova decisão + antiga `superseded` + link `supersedes`, numa transação |

Regras de memória:
- **Decisão é histórica.** O conteúdo só pode ser corrigido nas primeiras **24h** (erro de digitação). Depois disso, mudar de posição é uma **nova decisão** que substitui a anterior (trigger `forbid_personal_decision_rewrite`). A cadeia é linear: cada decisão é substituída no máximo uma vez, e uma decisão substituída não volta a ser ativa.
- **Captura nunca grava sozinha.** Analisar, sugerir o tipo e montar o preview acontecem no cliente. Descartar antes de confirmar não grava nada.
- Gratidão continua em `gratitude_entries` e virou um bloco opcional do fechamento do dia.
- Projeto em foco não ganhou tabela: é um link `operator —in_focus→ client_project` em `personal_entity_links` (só o id). Título e status são lidos de `client_projects` com a sessão, sob o RLS de Company. Se o acesso sumir, a HOJE mostra "Projeto indisponível".
- Novos tipos ativos em `entity-links.ts`: `capture`, `reflection`, `decision`, `operator` (este só como origem e só com `in_focus`). Novas relações: `resulted_in`, `in_focus`. `client_project` nunca é origem.

## 7. Código

### 7.1 Fase 0

| Caminho | Papel |
|---|---|
| `src/app/admin/meu-pp/page.tsx` | shell (server component): cabeçalho, 5 seções, HOJE com estado vazio honesto |
| `src/lib/meu-pp/today.ts` | contagens de HOJE: tarefas em aberto, agenda do dia (fuso America/Fortaleza), rotinas ativas. Só sessão do usuário, `user_id` explícito |
| `src/lib/meu-pp/navigation.ts` | seções (a prévia textual da Fase 0 saiu na Fase 1) |
| `src/lib/meu-pp/entity-links.ts` | vocabulário e validação da relação genérica |
| `src/components/app-sidebar.tsx` | item "Meu PP" com etiqueta **Pessoal**; fora de `COMPANY_SCOPED_ROUTES` |
| `src/app/admin/_layout-client.tsx` | na rota do Meu PP, troca a barra de Company pelo selo "Pessoal · privado" |

- Nenhum dado é semeado nem inventado.

### 7.2 Fase 1

| Caminho | Papel |
|---|---|
| `src/lib/meu-pp/today.ts` | snapshot da HOJE: prioridades, sugestões, agenda, rotinas que valem hoje, decisões para revisar (≤ 3), projeto em foco, caixa de notas, reflexo e gratidão do dia. Consultas em paralelo, todas com `user_id` da sessão |
| `src/lib/meu-pp/domain.ts` | regras puras: dia civil America/Fortaleza (`-03:00`, nunca UTC), rotinas aplicáveis, ordem das sugestões (regra legada "3 prioridades"), sugestão local do tipo de captura e preview |
| `src/lib/meu-pp/server.ts` | `personalSession()` (401/503), validadores e mapeamento de erros do banco |
| `src/app/api/admin/meu-pp/{tasks,events,routines,captures,decisions,day,focus,history}` | API pessoal. Toda mutação passa por `withMutationProtection` |
| `src/app/admin/meu-pp/_shell.tsx` | cabeçalho e navegação (server) |
| `src/app/admin/meu-pp/_components/*` | HOJE interativa (client): captura, prioridades, agenda, decisões, continuar, rotinas, notas, fechar o dia, histórico |

### 7.3 Fluxos da Fase 1
1. **Primeiro uso** (nenhum dado pessoal): "Um espaço para organizar o que você pensa, decide, aprende e constrói." → **Começar meu dia** → guia curto (escolha até 3 prioridades · veja sua agenda · capture algo).
2. **Captura:** texto ou voz → "Continuar" → tipo sugerido (Tarefa, Reflexão, Decisão, Evento, Ideia/nota), sempre trocável → preview editável → **Confirmar**. "Nada é salvo antes de você confirmar."
   - Tarefa: "amanhã/hoje" vira prazo; pode entrar direto nas prioridades de hoje (respeitando o limite de 3).
   - Decisão: "… porque …" separa decisão e porquê.
   - Evento: "às 15h" vira horário; sem hora = dia todo.
   - Reflexão: entra no reflexo do dia.
3. **Prioridades:** até 3 por dia; concluir, reabrir, reordenar, tirar do dia. Sugestões seguem a regra legada (atrasada → vence hoje → resto).
4. **Decisões para revisar** (revisão vencida, até 3): *Mantenho* · *Rever em 30 dias* · *Mudei de ideia* (abre "Eu pensava", grava a nova e substitui a antiga).
5. **Continuar:** um projeto em foco, escolhido entre os `client_projects` que a sessão enxerga.
6. **Rotinas de hoje:** feito · adiar · desfazer. Sem streak, sem pontuação.
7. **Fechar o dia:** perguntas opcionais (o que mudou, aprendizado, o que ficou aberto, atenção amanhã, texto livre), decisões do dia ligadas ao reflexo, "mudei de ideia sobre…" e gratidão opcional. Resultado: "Dia registrado."
8. **Histórico simples:** reflexos recentes e decisões recentes ("Eu pensava (data) / Agora penso").

### 7.4 Decisões de UX
- Uma pergunta por tela: "O que importa hoje?". Mobile em uma coluna com a captura no topo; desktop em duas colunas (fazer à esquerda, pensar à direita) e o fechamento do dia no fim.
- Folhas (`<dialog>` nativo) em vez de páginas novas: folha inferior no celular, centralizada no desktop, Esc fecha.
- Alvos de toque ≥ 44px e inputs com 16px no celular (sem zoom no iOS). Sem animações obrigatórias (respeita `prefers-reduced-motion`).
- Sem gamificação (streak, XP, badges) e sem humor ou score emocional. Linguagem sóbria.
- Sem fontes novas, sem design system novo, sem dependências novas.

### 7.5 Voz
Reusa `useJarvisVoice` → `/api/jarvis/transcribe` (autenticado; áudio só em memória, devolve só o texto e registra só metadados). O texto transcrito passa pelo **mesmo** fluxo de confirmação. O escopo do Jarvis **não** foi ampliado: nada do Meu PP vai para o chat, as ações ou o contexto do Jarvis.

### 7.6 Fora da Fase 1
Capital, Deals, Teses, Cenários, Mapa Vivo, Documentos/PDF, Biblioteca/Knowledge, Framework Registry, Jarvis pessoal, Open Finance, cotação, financeiro pessoal, IA financeira, classificação por LLM e embeddings. A sugestão de tipo da captura é **local, por palavras-chave**, e sempre confirmada pelo dono.

## 8. Entidades (modelo conceitual V2 — sem SQL até a fase correspondente)

| Onda | Entidades |
|---|---|
| Existentes | PersonalTask, PersonalRoutine (+Entry), GratitudeEntry (vira bloco do fechamento diário), PersonalEvent, PersonalEntityLink |
| Fase 1 (entregue) | QuickCapture (sugestão → **confirmação humana** → objeto real; nunca grava sozinha), Reflection, Decision (ledger, só acréscimo, `supersedes`). PersonalProject foi **adiado**: o "continuar projeto" usa um link `in_focus` para `client_project` (só id) |
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
| 1 | HOJE + CAPTURA + REFLEXO DO DIA (com gratidão) + DECISÕES + continuar projeto | **concluída** (uso real antes da Fase 2) |
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
