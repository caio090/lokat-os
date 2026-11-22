/**
 * Catálogo de indicadores. Cada um declara fórmula, período, fonte e
 * limitações. Nenhum traz meta universal: benchmark só existe por cliente
 * (mkt_metric_benchmarks), com fonte declarada.
 *
 * Divisão por zero devolve null ("sem dado"), nunca 0 nem Infinity.
 */

export type MetricKey =
  | "cpm" | "ctr" | "ctr_link" | "cpc" | "cpc_link" | "frequency"
  | "cpl" | "lead_rate" | "stage_conversion" | "cac" | "roas" | "ticket_medio"
  | "win_rate" | "ltv_simples" | "ltv_cac";

export interface MetricDefinition {
  key: MetricKey;
  name: string;
  formula: string;
  period: string;
  source: string;
  limitations: string[];
  direction: "maior_melhor" | "menor_melhor" | "contexto";
  unit: "moeda" | "percentual" | "razao" | "numero";
}

const ATTRIBUTION_WARNING = "Conversões reportadas pela plataforma seguem a janela de atribuição da conta; não somar com números do CRM nem comparar períodos com janelas diferentes.";
const CURRENCY_WARNING = "Valores na moeda da conta de anúncios; converter antes de comparar contas em moedas diferentes.";
const TIMEZONE_WARNING = "Dias seguem o fuso da conta de anúncios, que pode diferir do fuso do CRM.";

export const METRICS: Record<MetricKey, MetricDefinition> = {
  cpm: { key: "cpm", name: "CPM", formula: "investimento ÷ impressões × 1000", period: "mesmo intervalo de datas para numerador e denominador", source: "plataforma de anúncios (Insights)", limitations: [CURRENCY_WARNING, "Varia por leilão, público e época; não indica resultado sozinho."], direction: "contexto", unit: "moeda" },
  ctr: { key: "ctr", name: "CTR (todos os cliques)", formula: "cliques ÷ impressões", period: "mesmo intervalo", source: "plataforma de anúncios", limitations: ["Inclui cliques que não levam ao destino (curtir, expandir); para tráfego prefira CTR de link."], direction: "maior_melhor", unit: "percentual" },
  ctr_link: { key: "ctr_link", name: "CTR de link", formula: "cliques no link ÷ impressões", period: "mesmo intervalo", source: "plataforma de anúncios", limitations: ["Clique no link não garante visita: a página pode não carregar."], direction: "maior_melhor", unit: "percentual" },
  cpc: { key: "cpc", name: "CPC (todos os cliques)", formula: "investimento ÷ cliques", period: "mesmo intervalo", source: "plataforma de anúncios", limitations: [CURRENCY_WARNING], direction: "menor_melhor", unit: "moeda" },
  cpc_link: { key: "cpc_link", name: "CPC de link", formula: "investimento ÷ cliques no link", period: "mesmo intervalo", source: "plataforma de anúncios", limitations: [CURRENCY_WARNING], direction: "menor_melhor", unit: "moeda" },
  frequency: { key: "frequency", name: "Frequência", formula: "impressões ÷ alcance", period: "intervalo fechado (alcance não é somável dia a dia)", source: "plataforma de anúncios", limitations: ["Alcance é deduplicado no período: somar alcance diário superestima; buscar o período inteiro de uma vez."], direction: "contexto", unit: "razao" },
  cpl: { key: "cpl", name: "Custo por lead", formula: "investimento ÷ leads", period: "mesmo intervalo; dizer se o lead vem da plataforma ou do CRM", source: "plataforma (leads atribuídos) ou CRM (leads recebidos)", limitations: [ATTRIBUTION_WARNING, TIMEZONE_WARNING, "Lead da plataforma pode não chegar ao CRM (formulário, duplicado, inválido)."], direction: "menor_melhor", unit: "moeda" },
  lead_rate: { key: "lead_rate", name: "Taxa de captura", formula: "leads ÷ visitas na página (ou cliques no link)", period: "mesmo intervalo", source: "analytics do site/CRM + plataforma", limitations: ["Visitas e cliques vêm de ferramentas diferentes e não batem 1:1."], direction: "maior_melhor", unit: "percentual" },
  stage_conversion: { key: "stage_conversion", name: "Conversão entre etapas", formula: "entradas na etapa N+1 ÷ entradas na etapa N", period: "coorte (quem entrou na etapa N no período) ou fluxo (contagens do período) — declarar qual", source: "mkt_conversion_events / CRM", limitations: ["Por fluxo, quem entrou na etapa N no fim do período ainda pode avançar depois: a taxa do período corrente sai subestimada."], direction: "maior_melhor", unit: "percentual" },
  cac: { key: "cac", name: "CAC", formula: "(mídia + custos de aquisição declarados) ÷ novos clientes", period: "mesmo intervalo; declarar quais custos entram", source: "plataforma + financeiro + CRM (vendas ganhas)", limitations: ["Só mídia ≠ CAC completo; dizer o que foi incluído.", "Ciclo de venda longo desloca vendas para outro período.", TIMEZONE_WARNING], direction: "menor_melhor", unit: "moeda" },
  roas: { key: "roas", name: "ROAS", formula: "receita atribuída ÷ investimento em mídia", period: "mesmo intervalo e mesma janela de atribuição", source: "plataforma (valor de conversão) ou CRM (vendas ganhas ligadas à campanha)", limitations: [ATTRIBUTION_WARNING, CURRENCY_WARNING, TIMEZONE_WARNING, "Receita não é lucro: ROAS acima de 1 pode dar prejuízo dependendo da margem."], direction: "maior_melhor", unit: "razao" },
  ticket_medio: { key: "ticket_medio", name: "Ticket médio", formula: "receita ÷ número de vendas", period: "mesmo intervalo", source: "CRM / financeiro", limitations: ["Poucas vendas distorcem; mostrar a contagem junto."], direction: "contexto", unit: "moeda" },
  win_rate: { key: "win_rate", name: "Taxa de fechamento", formula: "oportunidades ganhas ÷ oportunidades encerradas (ganhas + perdidas)", period: "oportunidades encerradas no período", source: "CRM (mkt_opportunities)", limitations: ["Oportunidades abertas ficam fora; não usar total criado como denominador."], direction: "maior_melhor", unit: "percentual" },
  ltv_simples: { key: "ltv_simples", name: "LTV simples", formula: "ticket médio × compras por cliente no horizonte declarado", period: "horizonte explícito (ex.: 12 meses)", source: "CRM / financeiro", limitations: ["Estimativa; sem histórico suficiente é projeção, não dado."], direction: "maior_melhor", unit: "moeda" },
  ltv_cac: { key: "ltv_cac", name: "LTV ÷ CAC", formula: "LTV ÷ CAC", period: "mesmos horizontes declarados", source: "derivado", limitations: ["Herda as limitações de LTV e CAC; usar margem em vez de receita quando houver."], direction: "maior_melhor", unit: "razao" },
};

export function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export interface MediaTotals {
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks?: number | null;
  reach?: number | null;
}

/** Métricas de mídia básicas a partir de totais de um mesmo período e conta. */
export function computeMediaMetrics(t: MediaTotals) {
  return {
    cpm: (() => { const r = safeRatio(t.spend, t.impressions); return r == null ? null : r * 1000; })(),
    ctr: safeRatio(t.clicks, t.impressions),
    ctr_link: safeRatio(t.linkClicks ?? null, t.impressions),
    cpc: safeRatio(t.spend, t.clicks),
    cpc_link: safeRatio(t.spend, t.linkClicks ?? null),
    frequency: safeRatio(t.impressions, t.reach ?? null),
  };
}

export interface Benchmark {
  metricKey: MetricKey;
  targetValue: number;
  direction: "maior_melhor" | "menor_melhor";
  source: string;
}

/** Compara com benchmark DO CLIENTE. Sem benchmark → "sem_referencia", nunca um número genérico. */
export function compareWithBenchmark(value: number | null, benchmark: Benchmark | undefined):
  { status: "sem_dado" | "sem_referencia" | "dentro" | "fora"; source?: string } {
  if (value == null) return { status: "sem_dado" };
  if (!benchmark) return { status: "sem_referencia" };
  const ok = benchmark.direction === "maior_melhor" ? value >= benchmark.targetValue : value <= benchmark.targetValue;
  return { status: ok ? "dentro" : "fora", source: benchmark.source };
}
