export const MESES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export interface GoalRange {
  attainment_percentage: number
  target_value: number
  target_month: number | null
}

export interface GoalLike {
  direction: string
  unidade: string | null
  real_value: number | null
  real_value_pct: number | null
}

export interface ApprovalItems {
  real_value?: { previous: string | null; requested: string }
  real_value_pct?: { previous: string | null; requested: string }
  weight?: { previous: string | null; requested: string }
}

/** Formata o valor de um item de solicitação (texto bruto, como vem de
 * approval_request_items) — não confundir com formatReal, que espera o
 * shape numérico de v_goal_details. Usado nas telas de Aprovações e
 * Solicitações, onde os valores chegam como texto dentro de "items". */
export function formatApprovalValue(
  direction: string,
  unidade: string | null,
  real: string | null | undefined,
  pct: string | null | undefined
): string {
  if (real == null && pct == null) return '—'
  if (direction === 'binario') return real === '1' ? 'Sim' : 'Não'
  if (direction === 'cronologico') return MESES[Number(real)] ?? '—'
  if (direction === 'percentual_por_mes') {
    return `${pct != null ? (Number(pct) * 100).toFixed(0) : '?'}% em ${MESES[Number(real)] ?? '?'}`
  }
  if (unidade === '%') return `${(Number(real) * 100).toFixed(1)}%`
  return `${real} ${unidade ?? ''}`
}

export function formatReal(goal: GoalLike): string {
  if (goal.real_value == null && goal.real_value_pct == null) return '—'
  if (goal.direction === 'binario') return goal.real_value === 1 ? 'Sim' : 'Não'
  if (goal.direction === 'cronologico') return MESES[goal.real_value ?? 0]
  if (goal.direction === 'percentual_por_mes') {
    return `${((goal.real_value_pct ?? 0) * 100).toFixed(0)}% em ${MESES[goal.real_value ?? 0]}`
  }
  if (goal.unidade === '%') return `${((goal.real_value ?? 0) * 100).toFixed(1)}%`
  return `${goal.real_value} ${goal.unidade ?? ''}`
}

export function formatCriterio(direction: string, unidade: string | null, band: GoalRange): string {
  const isPct = unidade === '%'
  const val = isPct ? `${(band.target_value * 100).toFixed(0)}%` : `${band.target_value} ${unidade ?? ''}`
  switch (direction) {
    case 'maior_melhor':
      return `≥ ${val}`
    case 'menor_melhor':
      return `≤ ${val}`
    case 'binario':
      return 'Concluído'
    case 'cronologico':
      return `até ${MESES[band.target_value]}`
    case 'percentual_por_mes':
      return `${(band.target_value * 100).toFixed(0)}% até ${MESES[band.target_month ?? 0]}`
    default:
      return val
  }
}

/** A faixa que foi de fato atingida — a mesma lógica do motor de cálculo
 * (fn_calc_attainment): a maior faixa cujo critério o Real satisfaz. Usada
 * só pra destacar visualmente qual faixa bateu, nunca pra recalcular nada
 * (o attainment_percentage que vem do banco é sempre a fonte de verdade). */
/** Toda faixa cujo percentual seja menor ou igual ao atingimento real da
 * meta acende em verde — em cascata (ex.: atingimento 110% acende 80%,
 * 90%, 100% e 110%, não só a mais alta). Esse é o comportamento correto
 * e intencional (confirmado com o usuário) — usa direto o
 * attainment_percentage que o banco já calculou, sem reconferir critério
 * de faixa nenhum aqui (evita qualquer chance de divergir do cálculo real). */
export function isBandAchieved(
  goal: { attainment_percentage: number | null },
  band: GoalRange
): boolean {
  return goal.attainment_percentage != null && band.attainment_percentage <= goal.attainment_percentage
}
