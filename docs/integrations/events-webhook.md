# Ponte de Eventos do LOKAT OS — `POST /api/integrations/events`

FASE 1B da retomada do produto. Endpoint INBOUND genérico: qualquer
sistema externo (Cérebro Tayannara, um agente n8n, um futuro produto
conectado) usa o MESMO contrato — nunca uma rota exclusiva por cliente.

Status: **código completo, DB MIGRATION PENDING**. Não deployado como
integração externa funcional até:
- `docs/supabase/99-company-decisions-and-relationship-links.sql` aplicado;
- `docs/supabase/100-integration-events-and-client-external-links.sql` aplicado;
- segredo real configurado (ver "Configuração" abaixo);
- cadastro real da Company (Tayannara) persistido e vinculada via `client_external_links`.

## Endpoint

```
POST https://www.lokat.com.br/api/integrations/events
Content-Type: application/json
```

## Headers obrigatórios

| Header | Descrição |
|---|---|
| `x-lokat-source` | `source_system` registrado (ex.: `tayannara-brain`) |
| `x-lokat-timestamp` | epoch segundos (string) do momento do envio |
| `x-lokat-signature` | hex(HMAC-SHA256(segredo, `"${timestamp}.${rawBody}"`)) |

## Algoritmo de assinatura

```
signature = hex( HMAC_SHA256(secret, timestamp + "." + rawRequestBody) )
```

- `rawRequestBody` é o corpo **exatamente como enviado** (a mesma string de bytes, antes de qualquer parse/reserialização).
- `timestamp` precisa estar dentro de ±5 minutos do horário do servidor (proteção contra replay) — fora disso, `401`.
- Comparação feita com `crypto.timingSafeEqual` (nunca `===`).

## Contrato do evento (corpo da requisição)

```ts
interface IntegrationEventPayload {
  event_id: string;                 // único por source_system (idempotência)
  event_type: IntegrationEventType; // ver tabela abaixo
  occurred_at: string;              // ISO 8601
  source_system: string;            // precisa bater com x-lokat-source
  client_external_id: string;       // id estável no sistema externo -- nunca o UUID interno do LOKAT
  project_external_id?: string;
  entity_type?: string;
  entity_id?: string;
  title: string;                    // até 200 caracteres
  description?: string;             // até 4000 caracteres
  priority?: "low" | "normal" | "high" | "urgent";
  requested_by?: string;
  metadata?: Record<string, unknown>;
  source_reference?: string;
}
```

`client_external_id` nunca precisa ser o UUID interno do LOKAT OS — o
sistema externo manda um identificador estável do seu próprio lado
(ex.: `"tayannara-carvalho"`), e o LOKAT resolve internamente via
`client_external_links` (tabela nova, SQL 100).

## Tipos de evento suportados e política de cada um

Webhook **nunca** significa execução automática (seção 7 do brief de
retomada). Cada `event_type` tem uma política FIXA (`src/lib/integration-events/policies.ts`):

| event_type | Política | O que acontece |
|---|---|---|
| `DECISION_CREATED` | `CREATE_DECISION` | Registra em Decisões (`company_decisions`, origin=`client`) |
| `APPROVAL_REQUESTED` | `REQUIRE_HUMAN_REVIEW` | Só notifica — nenhuma entidade criada sozinha |
| `BLOCKER_CREATED` | `CREATE_NOTIFICATION` | Só notifica |
| `UPSELL_INTERESTED` | `CREATE_OPPORTUNITY` | Vira Oportunidade (`client_requests`) |
| `MEETING_REQUESTED` | `CREATE_MEETING_REQUEST` | Vira solicitação de reunião (`client_requests`, nunca fabrica uma data) |
| `SCOPE_CHANGE_REQUESTED` | `CREATE_OPPORTUNITY` | Vira Oportunidade — mudança de escopo nunca executa sozinha |
| `EXTRA_CONTENT_REQUESTED` | `CREATE_OPPORTUNITY` | Vira Oportunidade |
| `PROJECT_STATUS_CHANGED` | `UPDATE_PROJECT` | **Limitação desta fase**: resolução de `project_external_id` ainda não existe — só grava na timeline, não atualiza `client_projects` |
| `CLIENT_PENDING_CREATED` | `REQUIRE_HUMAN_REVIEW` | Só notifica |
| `TEAM_ACTION_REQUIRED` | `CREATE_TASK` | **Limitação desta fase**: `operational_tasks` não tem hoje um caminho de criação manual auditado — só notifica, não insere tarefa |

Todo evento processado, independente da política, grava uma linha na
**Timeline** da Company (`activity_logs`). Eventos nas políticas
`CREATE_NOTIFICATION`/`REQUIRE_HUMAN_REVIEW`, mais
`MEETING_REQUESTED`/`UPSELL_INTERESTED`/`APPROVAL_REQUESTED`/`BLOCKER_CREATED`/`TEAM_ACTION_REQUIRED`
(seção 10 do brief), também notificam os admins.

## Idempotência

`event_id` é único **por `source_system`** — a chave real gravada no
banco é `"{source_system}:{event_id}"`, aproveitando o `UNIQUE` já
existente (global) na coluna `idempotency_key` de
`integration_webhook_events` (SQL 86), sem precisar alterar essa
constraint. O mesmo evento reenviado 1, 10 ou 1000 vezes nunca cria uma
segunda oportunidade/decisão/solicitação — a segunda chamada em diante
sempre responde `200 { duplicate: true }`.

## Respostas

| Situação | Status | Corpo |
|---|---|---|
| Evento novo, processado | `202` | `{ accepted: true, event_id, status: "processed", policy }` |
| Evento duplicado | `200` | `{ accepted: true, duplicate: true, event_id }` |
| `client_external_id` não vinculado a nenhuma Company | `422` | `{ accepted: true, event_id, status: "ignored", reason: "client_external_id_not_linked" }` (o evento FICA registrado para auditoria, só não é roteado) |
| Assinatura ausente/inválida/timestamp fora da janela | `401` | `{ accepted: false, error }` |
| Payload inválido | `400` | `{ accepted: false, error }` |
| `source_system` desconhecido | `403` | `{ accepted: false, error }` |
| `source_system` conhecido mas sem segredo configurado ainda | `403` | `{ accepted: false, error, code: "SOURCE_NOT_CONFIGURED" }` |
| Migration pendente (SQL 99/100 ainda não aplicadas) | `503` | `{ accepted: false, error, code: "DB_MIGRATION_PENDING" }` |
| Erro interno/falha no roteamento | `500` | `{ accepted: false, error }` (nunca expõe detalhe interno) |

## Retry policy (recomendado para o sistema externo)

- Em `5xx` ou timeout: retry com backoff exponencial (ex.: 1s, 5s, 30s, 2min), até ~5 tentativas.
- Em `401`/`400`/`403`: **nunca** fazer retry automático sem corrigir a causa (assinatura/segredo/payload) — reenviar sem corrigir só vai repetir o mesmo erro.
- Em `422` (`client_external_id_not_linked`): não adianta retry — o vínculo precisa ser criado do lado do LOKAT primeiro (`client_external_links`).
- Em `200`/`202`: sucesso, nunca reenviar o mesmo `event_id` de propósito (idempotência cobre reenvio acidental, mas não é um mecanismo de "enviar de novo para garantir").

## Configuração (Tayannara — primeiro caso real)

```bash
# .env.local / variáveis de ambiente de Production -- NUNCA no código, NUNCA no client/browser
LOKAT_INTEGRATION_SECRET_TAYANNARA_BRAIN=<segredo real, gerado quando a integração for ativada de verdade>
```

Status hoje: **pendente** (`src/lib/integration-events/sources.ts` reporta `"pending"` enquanto a env var não existir — a rota recusa com `403 SOURCE_NOT_CONFIGURED`, nunca processa sem conseguir verificar a assinatura).

Depois de gerar o segredo e configurá-lo, vincular a Company real:

```sql
-- Via client_external_links (depois de SQL 100 aplicado e da Tayannara cadastrada via docs/seeds/tayannara-carvalho-NOT-APPLIED.sql)
INSERT INTO public.client_external_links (client_id, source_system, external_id)
VALUES ('<client_id real da TAYANNARA>', 'tayannara-brain', 'tayannara-carvalho');
```

### Exemplo de payload — `UPSELL_INTERESTED`

```json
{
  "event_id": "evt_example_001",
  "event_type": "UPSELL_INTERESTED",
  "occurred_at": "2026-10-07T14:30:00Z",
  "source_system": "tayannara-brain",
  "client_external_id": "tayannara-carvalho",
  "title": "Interesse em vídeos adicionais",
  "priority": "normal",
  "metadata": { "service": "video", "quantity": 2 }
}
```

### Exemplo de payload — `MEETING_REQUESTED`

```json
{
  "event_id": "evt_example_002",
  "event_type": "MEETING_REQUESTED",
  "occurred_at": "2026-10-07T14:35:00Z",
  "source_system": "tayannara-brain",
  "client_external_id": "tayannara-carvalho",
  "title": "Reunião sobre o Evento Metas 2027",
  "description": "Quer alinhar escopo e orçamento antes de aprovar."
}
```

### Exemplo de payload — `DECISION_CREATED`

```json
{
  "event_id": "evt_example_003",
  "event_type": "DECISION_CREATED",
  "occurred_at": "2026-10-07T14:40:00Z",
  "source_system": "tayannara-brain",
  "client_external_id": "tayannara-carvalho",
  "title": "Decidido adiar o Podcast para dezembro",
  "description": "Prioridade ficou para o Outlet neste trimestre."
}
```

## Outbound (projetado, NÃO implementado nesta fase)

Tipos já definidos em `src/lib/integration-events/types.ts`
(`OutboundEventType`) para a próxima fase construir em cima, sem
nenhum mecanismo de envio real ainda:

- `MEETING_CONFIRMED`
- `PROPOSAL_CREATED`
- `UPSELL_IN_REVIEW`
- `REQUEST_RESOLVED`
- `PROJECT_STATUS_UPDATED`

## Limitações conhecidas desta fase (documentadas, não escondidas)

1. `TEAM_ACTION_REQUIRED` não cria uma tarefa real em `operational_tasks` — essa tabela não tem hoje um caminho de criação manual auditado (confirmado pela auditoria da retomada do produto: o botão "+ Nova tarefa" da UI é um link morto). Só notifica.
2. `PROJECT_STATUS_CHANGED` não atualiza `client_projects` — a resolução `project_external_id -> client_projects.id` ainda não foi construída (só a resolução a nível de Company existe, via `client_external_links`). Só grava na timeline.
3. Outbound (LOKAT OS → sistema externo) é só contrato de tipos, nenhum envio real.
4. Notificação é broadcast para `recipient_role="admin"` — ainda não existe um lookup de "qual admin é responsável por esta Company específica".
