# Operação de marketing no LOKAT OS

Base para relacionar diagnóstico, funil, campanhas, criativos, eventos de
conversão, CRM, resultados e decisões — para a Lokat e para cada cliente,
com dados separados por cliente.

Estado: **fundação**. Schema (migração 105) e regras de domínio prontos e
testados; nada aplicado em produção; sem telas ainda.

## Peças

| Peça | Onde | Estado |
|---|---|---|
| Schema (14 tabelas `mkt_*`, RLS, FKs compostas, fluxo de publicação) | `docs/supabase/105-marketing-operations-NOT-APPLIED.sql` (+ rollback e plano de testes) | não aplicada |
| Endurecimento de leitura do token Meta | `docs/supabase/106-meta-connections-token-column-hardening-NOT-APPLIED.sql` | não aplicada; depende do deploy |
| Tipos, fluxo, métricas, referências de funil/lançamento, gargalo | `src/lib/marketing-ops/` | pronto, testado |
| Leitura da Marketing API (contas, Insights) e rascunho de campanha | `src/lib/meta/marketing-api.ts` | pronto, testado com fetch falso; sem uso em rota ainda |
| Token de longa duração + escopos/validade no OAuth | `src/lib/meta/token-lifecycle.ts`, `src/app/api/meta/callback` | pronto; vale para conexões novas após deploy |
| Versão da API | `src/lib/meta/graph-version.ts` | padrão v26.0; `META_API_VERSION` tem prioridade |

## Como as coisas se ligam

```
cliente ─┬─ projeto (client_projects)
         ├─ diagnóstico (company_diagnostics) ──┐
         └─ funil (mkt_funnels: framework, oferta, público, objetivo, posição na escada)
              └─ etapas (mkt_funnel_stages: tipo, evento de entrada, canal)
                    ▲                                   ▲
   lançamento (mkt_launches: modelo, fases, carrinho)   │
                    │                                   │
   campanha (mkt_campaigns: canal, conta, etapa que alimenta, orçamento, status)
     └─ conjunto (mkt_ad_sets: público, otimização, evento)
          └─ anúncio (mkt_ads) ── criativo (mkt_creatives: texto, mídia por link, UTMs)

   lead (mkt_leads: origem, UTMs, campanha/anúncio do 1º toque, etapa atual)
     └─ oportunidade (mkt_opportunities: valor, estágio, ganha/perdida)

   evento de conversão (mkt_conversion_events: Pixel, CAPI, site, WhatsApp, CRM;
     dedupe por event_id; liga lead, oportunidade, campanha, anúncio e etapa)

   desempenho diário (mkt_performance_daily: dia no fuso da conta, moeda da conta,
     configuração de atribuição; importado da plataforma)

   decisão (company_decisions, migração 99) ← mkt_decision_links (objeto + evidência)
   benchmark do cliente (mkt_metric_benchmarks: valor, direção, fonte)
```

- `commercial_leads` continua sendo o CRM comercial da **própria Lokat**
  (não segmentado por cliente). Um `mkt_leads` pode apontar para ele.
- Um filho nunca aponta para pai de outro cliente: FK composta
  `(id, client_id)` em todos os vínculos.
- Leitura: `can_access_client_company`. Escrita: `mkt_can_manage` (acesso +
  papel admin, super_admin, agency ou gestor_trafego). Cliente lê, não escreve.

## Fluxo de publicação (garantido no banco por trigger)

`rascunho` → `em_revisao` → `aprovada` (só admin/super_admin) → `publicada`
(só servidor; nasce **PAUSED** na plataforma) → veiculação só com
`activation_authorized_*` preenchido por admin/super_admin **e**
confirmação explícita na execução. Editar orçamento/datas/nome/objetivo de
algo aprovado devolve para rascunho.

## Métricas

Catálogo em `src/lib/marketing-ops/metrics.ts`: cada indicador tem fórmula,
período, fonte e limitações. Nenhuma meta universal; comparação só com
benchmark do próprio cliente (com fonte). Gargalo (`funnel-analysis.ts`) só
é apontado contra o histórico do cliente e com amostra mínima.

## Referências de funil e lançamento

`src/lib/marketing-ops/frameworks.ts`: escada de valor e tipos de funil
(Russell Brunson) e modelos de lançamento (Érico Rocha, adaptação do
Product Launch Formula de Jeff Walker), com origem, quando considerar e
quando evitar. Skills correspondentes no skill-LKT: `escada-de-valor-e-funil`,
`planejar-lancamento`, `desenhar-funil`, `analisar-conversao`.

## Para ativar (ordem)

1. Revisar e aplicar a 105 num ambiente de teste; rodar o plano de testes.
2. Deploy do código (callback com token longo; `/api/meta/assets` lendo pelo servidor).
3. Aplicar a 106.
4. No app da Meta: adicionar o caso de uso de anúncios e, para ler
   campanhas, pedir `ads_read` (`META_OAUTH_EXTRA_SCOPES=ads_read` na
   Vercel). Contas de clientes exigem Advanced Access (Revisão do App).
5. Reconectar a conta Meta da Lokat para gravar token longo, escopos e validade.
6. Criar a rota de sincronização de Insights (usa `fetchDailyInsights`) e as telas.
