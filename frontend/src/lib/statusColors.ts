/**
 * Mapeamento único de status de apuração → cor/rótulo.
 * Este é o padrão validado no painel-metas original — NÃO é o mapeamento
 * "óbvio" (crítico=vermelho, atingido=verde são intuitivos, mas o meio-termo
 * é invertido de propósito): atingida parcialmente = AZUL, aguardando
 * apuração = AMARELO. Qualquer tela que mostrar status de meta deve importar
 * daqui, nunca inventar cores próprias — é o que a StatusLegend também usa,
 * então as duas ficam sempre consistentes entre si.
 */
export type GoalStatus = 'atingido' | 'parcial' | 'critico' | 'pendente'

interface StatusStyle {
  label: string
  badgeClassName: string
  dotClassName: string
}

export const STATUS_STYLES: Record<GoalStatus, StatusStyle> = {
  atingido: {
    label: 'Meta atingida ou superada',
    badgeClassName: 'bg-emerald-100 text-emerald-700',
    dotClassName: 'bg-emerald-500',
  },
  parcial: {
    label: 'Atingida parcialmente',
    badgeClassName: 'bg-blue-100 text-blue-700',
    dotClassName: 'bg-blue-500',
  },
  critico: {
    label: 'Abaixo do mínimo',
    badgeClassName: 'bg-red-100 text-red-700',
    dotClassName: 'bg-red-500',
  },
  pendente: {
    label: 'Aguardando apuração',
    badgeClassName: 'bg-amber-100 text-amber-700',
    dotClassName: 'bg-amber-400',
  },
}

/** Rótulo curto usado em badges pequenos de card (a legenda usa o `label` completo). */
export const STATUS_SHORT_LABEL: Record<GoalStatus, string> = {
  atingido: 'Atingida',
  parcial: 'Atingida parcialmente',
  critico: 'Abaixo do mínimo',
  pendente: 'Aguardando apuração',
}

/** Deriva o status de uma Área a partir dos contadores da view v_area_results
 * (que não tem uma coluna "status" própria, só contagens por categoria). */
export function areaStatus(counts: {
  total_metas: number
  metas_pendentes: number
  metas_criticas: number
  resultado_ponderado: number
}): GoalStatus {
  if (counts.metas_pendentes > 0) return 'pendente'
  if (counts.resultado_ponderado < 80 || counts.metas_criticas > 0) return 'critico'
  if (counts.resultado_ponderado < 100) return 'parcial'
  return 'atingido'
}
