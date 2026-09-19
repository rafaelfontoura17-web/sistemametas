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
export function isBandAchieved(goal: GoalLike, band: GoalRange): boolean {
  if (goal.real_value == null) return false
  switch (goal.direction) {
    case 'maior_melhor':
    case 'binario':
      return goal.real_value >= band.target_value
    case 'menor_melhor':
    case 'cronologico':
      return goal.real_value <= band.target_value
    case 'percentual_por_mes':
      return (
        goal.real_value <= (band.target_month ?? Infinity) &&
        (goal.real_value_pct ?? -Infinity) >= band.target_value
      )
    default:
      return false
  }
}
