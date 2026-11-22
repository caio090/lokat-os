/**
 * Análise de gargalo do funil: onde a passagem entre etapas mais perde
 * gente, COMPARADA COM O PRÓPRIO HISTÓRICO DO CLIENTE (ou benchmark do
 * cliente com fonte). Sem histórico nem benchmark, o resultado diz que não
 * há referência — nunca inventa uma taxa "normal".
 */
import { safeRatio } from "./metrics";

export interface StageCount {
  stageKey: string;
  name: string;
  /** Entradas na etapa no período (mesma coorte ou mesmo fluxo para todas). */
  count: number;
}

export interface StageTransition {
  fromKey: string;
  toKey: string;
  label: string;
  rate: number | null;
  previousRate: number | null;
  /** Variação relativa vs. período anterior (−0.25 = caiu 25%). */
  change: number | null;
  /** Amostra do denominador; abaixo de MIN_SAMPLE a leitura é fraca. */
  sample: number;
  weakSample: boolean;
}

export interface FunnelDiagnosis {
  transitions: StageTransition[];
  bottleneck: StageTransition | null;
  basis: "historico_do_cliente" | "sem_referencia";
  notes: string[];
}

export const MIN_SAMPLE = 30;

export function analyzeFunnel(current: StageCount[], previous?: StageCount[]): FunnelDiagnosis {
  const notes: string[] = [];
  const prevByKey = new Map((previous ?? []).map((s) => [s.stageKey, s.count]));
  const transitions: StageTransition[] = [];

  for (let i = 0; i < current.length - 1; i++) {
    const from = current[i];
    const to = current[i + 1];
    const rate = safeRatio(to.count, from.count);
    const prevFrom = prevByKey.get(from.stageKey);
    const prevTo = prevByKey.get(to.stageKey);
    const previousRate = safeRatio(prevTo ?? null, prevFrom ?? null);
    const change = rate != null && previousRate != null && previousRate > 0 ? (rate - previousRate) / previousRate : null;
    if (to.count > from.count) notes.push(`${to.name} tem mais entradas que ${from.name}: provável evento faltando ou contado em dobro.`);
    transitions.push({
      fromKey: from.stageKey, toKey: to.stageKey, label: `${from.name} → ${to.name}`,
      rate, previousRate, change, sample: from.count, weakSample: from.count < MIN_SAMPLE,
    });
  }

  const comparable = transitions.filter((t) => t.change != null && !t.weakSample);
  if (comparable.length === 0) {
    notes.push("Sem histórico comparável (ou amostra pequena): o gargalo não pode ser apontado com segurança. Registrar um período de referência ou benchmark do cliente com fonte.");
    return { transitions, bottleneck: null, basis: "sem_referencia", notes };
  }
  const bottleneck = comparable.reduce((worst, t) => ((t.change as number) < (worst.change as number) ? t : worst));
  if ((bottleneck.change as number) >= 0) {
    notes.push("Nenhuma passagem piorou em relação ao período anterior.");
    return { transitions, bottleneck: null, basis: "historico_do_cliente", notes };
  }
  return { transitions, bottleneck, basis: "historico_do_cliente", notes };
}
