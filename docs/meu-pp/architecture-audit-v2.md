# RELATÓRIO MEU PP V2 — AUDITORIA + REFLEXO + CAPITAL

Documento de arquitetura, **registro histórico** da auditoria de 29/09/2026, feita só com leitura (arquivos, Git, catálogo e ledger do Supabase `lokat-os`) e sem alterações. O conteúdo abaixo preserva os fatos como foram auditados; o que mudou depois está na seção final, datada.

Documento canônico vivo do módulo: [`README.md`](README.md).

Marcadores:
- **[FATO]**: verificado na auditoria.
- **[ANTIGA]**: decisão registrada no histórico.
- **[PROPOSTA]**: recomendação da auditoria.

---

## 1. Ambiente (no momento da auditoria)
- Repo `~/lokat-os` → `github.com/caio090/lokat-os`, branch `main`, HEAD `006912b`.
- Worktree só o principal. O antigo `lokat-os-personal-strategy-os` **não existe mais**.
- `feat/personal-strategy-os` existe só no remoto: 2 commits exclusivos (`8b26585`, `85f3353`, 13/08/2026), 68 atrás da `main`, nunca mergeada.
- 3 arquivos não rastreados de **outra frente**: `_audit-export/`, `src/lib/ai/image-providers/google-gemini-compat.ts` e seu teste. Não foram tocados.

## 2. Legado
- Rota `/admin/meu-painel`: **AUSENTE** em todas as branches [FATO].
- UI pessoal: **nenhuma** [FATO].
- Banco [FATO, ao vivo]: o ledger de migrations tinha as 4 migrations Personal Core aplicadas em 13/08/2026. Tabelas reais, todas vazias:

  | Tabela | Estado |
  |---|---|
  | `personal_tasks` | REAL (vazio) |
  | `personal_routines` + `personal_routine_entries` | REAL (vazio) |
  | `gratitude_entries` | REAL (vazio) |
  | `personal_events` | REAL (vazio) |
  | `personal_goals` | AUSENTE |
  | `quick_captures` | AUSENTE (só citado como teste futuro de app) |

  - RLS só do dono (`user_id = auth.uid()`).
  - GRANT só para `authenticated`; **`anon` e `service_role` sem acesso** (confirmado com `has_table_privilege`).
- Migrations: SQL 93–96 (+ rollbacks + test plan) só na branch antiga. Aplicados no banco, nunca na `main` [FATO].
- Docs:
  - a navegação antiga HOJE/MAPAS/BIBLIOTECA/ESTRATÉGIA/REVISÃO, o Framework Registry e o Knowledge Item **não estavam em nenhum arquivo do repositório** nem nos históricos de sessão deste Mac; existiam só no briefing do operador [FATO];
  - `platform-modules.ts` cita uma "auditoria de Personal Strategy OS/Content Lab" **ausente do repositório** [FATO].

## 3. O que existia
- **Hoje:** não. `/admin/inicio` é Company e só lê `profiles`.
- **Tasks:** `personal_tasks` (banco, sem código). `productivity_tasks` existe sem código usando, e o admin lê tudo.
- **Rotinas, gratidão, eventos:** tabelas reais, sem código. `productivity_meetings` órfã, admin lê tudo.
- **Capture:** ausente. Peças reaproveitáveis: `smart-start-input`, o contrato de entrada e confirmação do Neural Core, a transcrição do Jarvis.
- **Knowledge:** ausente.
- **Roadmap:** `roadmap_items` é Company.
- **Jarvis Personal:** não existe. O Jarvis é só Company, sem memória própria.
- **Finance pessoal:** não existe. `finance_*`/`billing_*` = cobrança da LOKAT; Meu Negócio = dados de exemplo em memória.
- **Projects:** `client_projects`/`client_project_tasks` (Company).

## 4. Fonte da verdade [PROPOSTA sobre FATO]

| Domínio | Fonte da verdade | Observação |
|---|---|---|
| Personal | `personal_*` (e futuras, mesmo padrão) | — |
| Company | `clients` + `client_context` + diagnóstico | — |
| Project | `client_projects` | referenciado, nunca copiado |
| Finance | `finance_*`/`billing_*` (Company) | Capital pessoal = novo e separado |
| Calendar | pessoal = `personal_events` | `/admin/calendario` é Company |

## 5. Reflexo
- Existia: gratidão diária e o histórico diário das rotinas.
- Faltava: reflexão ligada a contexto, registro de decisões, mudança de opinião, snapshots, mapa.
- Proposta:
  - `Reflection { owner, date, contextType, contextId?, prompt?, text, learning?, changedMind?, nextAction? }`;
  - decisões e teses só com acréscimo (`supersedes`);
  - mudança de opinião derivada de uma nova Decision ou Thesis ligada à anterior.

## 6. Capital
- Nada pessoal existia.
- Reuso: o padrão de segurança do Personal Core, a escala de confiança do Data Hub (`DataConfidence`), a proveniência e os componentes visuais de indicadores.
- Novo: CapitalAccount (ativo/passivo por tipo), CapitalCommitment, ValuationSnapshot (e CashMovement, opcional).
- Cálculos separados: patrimônio líquido, liquidez, capital comprometido, capital disponível.

## 7. Deals
- Nada existia. `commercial_*`/`crm_*` são Company e **não** devem ser reaproveitados.
- Novo: Deal, InvestmentThesis (versões), Assumption, DealScenario, Risk.
- Ciclo: RADAR → ANÁLISE → ESTRUTURAÇÃO → NEGOCIAÇÃO → DECISÃO → EXECUÇÃO → ACOMPANHAMENTO → ENCERRADO, mais DESCARTADO. A qualidade do deal é um campo separado do status.

## 8. Decisões
- Nada existia.
- Proposta: Decision Ledger com data, contexto, objeto, decisão, motivo, alternativas, premissas, riscos aceitos, gatilho de revisão, documentos e próxima revisão. Só acréscimo, com `supersedes`.

## 9. Mapa Vivo
- Reuso possível: roadmap do REC OS, componentes de movimento do Meu Negócio, `kanban-board`.
- Proposta: o Mapa é uma **visão** (sem tabela própria) sobre Milestones, Decisions, Deals, Reflections, Snapshots e Knowledge.
  - "Estamos aqui" = hoje;
  - o futuro é hipótese, não recomendação.

## 10. Documentos
- Upload existente só Company (`client_files`, `operational_attachments`).
- Não havia bucket privado para PDF: `client-visual-assets` só aceita imagens e `rec-videos` é público.
- Proposta: Document pessoal + relações + bucket privado novo.

## 11. Biblioteca
- Nada existia.
- Proposta: KnowledgeItem (campos antigos, status NOVO → DOMINADO); Framework como cadastro em código.

## 12. IA
- Jarvis só Company; Neural Core sem escopo `personal`.
- Reuso: a transcrição (áudio só em memória), o padrão rascunho → confirmação, a proveniência.
- Não criar segundo assistente, memória vetorial, nem leitura pessoal por service role.
- Escopo `personal` do Jarvis só na Fase 8.

## 13. Matriz de reuso

| Capacidade | Existe? | Onde | Fonte da verdade | Ação | Risco |
|---|---|---|---|---|---|
| Tasks pessoais | Sim (vazio) | `personal_tasks` | Personal | REUSAR | relação só `client_project` |
| `productivity_*` | Órfãs | banco | — | DESCARTAR para pessoal | admin lê tudo |
| Rotinas / Gratidão / Events | Sim (vazio) | `personal_*`, `gratitude_entries` | Personal | REUSAR | — |
| Calendar | Company | `/admin/calendario` | Company | não misturar | — |
| Quick Capture | Não | — | — | NOVO | virar depósito |
| Transcrição | Sim | Jarvis | — | REUSAR | — |
| Jarvis | Sim (Company) | `lib/jarvis`, `neural-core` | — | ESTENDER (Fase 8) | vazamento de contexto |
| Projects | Sim | `client_projects` | Company | REFERENCIAR | duplicação |
| Finance | Company | `finance_*`/`billing_*` | Company | NÃO USAR; Capital novo | misturar caixas |
| Knowledge / Framework | Não | — | — | NOVO | — |
| Roadmap | Company | `roadmap_items` | Company | não reusar | — |
| Documents | Company | `client_files` | Company | NOVO + bucket privado | bucket público |
| Activity logs | Sim | `activity_logs` | Company | NÃO USAR | admin lê tudo |
| Proveniência / confiança | Sim | `neural-core` | — | REUSAR | — |

## 14. Contradições encontradas
1. **SQL 93–96:** diziam "proposta — não executar", mas o ledger os mostrava aplicados em 13/08. → Vale o banco; atualizar os cabeçalhos.
2. **Numeração:** 93–96 da branch colidia com `93-identity-links` e `93-studio-visual-assets-storage` da `main`. → Arquivos sem número.
3. **Goals e captura:** o histórico planejava `personal_goals`/`quick_captures`, ausentes no SQL e no banco. → Goal vira Milestone; Capture é NOVO na Fase 1.
4. **Auditoria citada ausente:** `platform-modules` cita uma auditoria que não está no repositório. → Este documento passa a ser a referência.
5. **Sem escopo pessoal no Neural Core/Jarvis.** → Só na Fase 8.
6. **Relação limitada:** `personal_tasks`/`personal_events` só aceitam `client_project`. → Usar uma tabela de relações, não ampliar o CHECK.
7. **Aparência pessoal enganosa:** `productivity_*` parecem pessoais, mas o admin lê tudo. → Descartar.
8. **Navegação:** a antiga (5 itens, só no briefing) diferia da hipótese nova (6 itens). → Resolvido na seção 16.

## 15. Modelo V2
- Fase 1: QuickCapture, Reflection, Decision, PersonalProject, mais as tabelas existentes.
- Fase 2: CapitalAccount, ValuationSnapshot, CapitalCommitment.
- Fase 3: Deal, InvestmentThesis, Assumption, DealScenario, Risk.
- Fase 4: Milestone.
- Fase 5: Document + relações.
- Fase 6: KnowledgeItem.
- Transversal: relações genéricas entre objetos pessoais.
- Descartadas ou adiadas: Learning como tabela, Framework como tabela, CashMovement, Asset e Liability separados, Goal separado.

## 16. Navegação
**HOJE · CAPITAL · MAPA · BIBLIOTECA · REVISÃO** (5 itens).
- Deals dentro de Capital.
- ESTRATÉGIA [ANTIGA] se divide entre Mapa e Deals.
- Decisões em Hoje (pendentes) e Mapa (histórico).
- Captura sempre acessível, fora da navegação.

## 17. Fases
| Fase | Escopo |
|---|---|
| 0 | Reconciliação |
| 1 | Hoje + Captura + Reflexo do dia + Decisões + Continuar projeto |
| 2 | Capital |
| 3 | Deals |
| 4 | Mapa |
| 5 | Documentos |
| 6 | Biblioteca |
| 7 | Revisões + Memo |
| 8 | Jarvis pessoal |
| 9 | Fontes externas |

Dependências: todas dependem da 0; a 3 depende da 2; a 4 da 1 e da 3; a 7 da 1 à 6; a 8 da 1 e de uma política de visibilidade pessoal.

## 18. Primeiro MVP
- **Entra:** HOJE (data, 3 prioridades, eventos, decisões pendentes, continuar projeto), Captura com confirmação humana, Reflexo do dia com gratidão, Decision Ledger, tarefas e rotinas sobre as tabelas existentes.
- **Fica fora:** Capital, Deals, Mapa, PDFs, Biblioteca, IA, Open Finance e qualquer cotação.

## 19. Riscos
- Big-bang.
- Privacidade: `productivity_*`, `activity_logs`, `notifications` e o bucket público `rec-videos`; contexto global do Jarvis.
- Duplicação: tasks, projetos, financeiro.
- Escopo: plataforma financeira cedo demais.
- Complexidade: só-acréscimo desde a primeira tabela; numeração de migrations.

## 20. Estado ao fim da auditoria
`ARCHITECTURE_RECONCILED: SIM` · `READY_FOR_IMPLEMENTATION: NÃO` (aguardava aprovação da navegação, da Fase 0 e da tabela de relações) · `RECOMMENDED_NEXT_PHASE: FASE 0`.

---

## Pós-auditoria — decisões aprovadas e Fase 0 (29/09/2026)
Aprovado pelo operador: navegação de 5 itens; início pela Fase 0; relação genérica em vez de FKs espalhadas; rota canônica `/admin/meu-pp`.

Entregue na Fase 0 (detalhes no README):
- **Baseline legada:** `docs/supabase/legacy/personal-core-*.sql` sem número. Corpo idêntico ao ledger, sem drift, cabeçalho "LEGACY BASELINE — APLICADA EM PRODUÇÃO EM 13/08/2026 — NÃO REEXECUTAR". Rollbacks destrutivos não foram trazidos.
- **SQL 97 `personal_entity_links`:** aplicado (ledger `20260929175139`); test plan ao vivo PASS 20/20.
- **Código:** rota `/admin/meu-pp` (shell com só HOJE ativa), `src/lib/meu-pp/*`, item "Meu PP · Pessoal" na sidebar, barra de Company oculta na rota, teste estrutural de privacidade.
