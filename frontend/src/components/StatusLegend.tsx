import { STATUS_STYLES, type GoalStatus } from '../lib/statusColors'

const ORDER: GoalStatus[] = ['atingido', 'parcial', 'critico', 'pendente']

export default function StatusLegend() {
  return (
    <ul className="space-y-2 px-3 py-4">
      {ORDER.map((status) => (
        <li key={status} className="flex items-center gap-2 text-sm text-white/70">
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_STYLES[status].dotClassName}`} />
          {STATUS_STYLES[status].label}
        </li>
      ))}
    </ul>
  )
}
