import { STATUS_STYLES, type GoalStatus } from '../lib/statusColors'

const RING_COLOR: Record<GoalStatus, string> = {
  atingido: '#10b981',
  parcial: '#3b82f6',
  critico: '#ef4444',
  pendente: '#fbbf24',
}

export default function ProgressRing({
  percent,
  status,
  size = 56,
}: {
  percent: number
  status: GoalStatus
  size?: number
}) {
  const stroke = size * 0.14
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(120, percent))
  const offset = circumference * (1 - Math.min(clamped, 100) / 100)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={STATUS_STYLES[status].label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={RING_COLOR[status]} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-semibold" style={{ color: RING_COLOR[status] }}>
          {Math.round(percent)}%
        </span>
      </div>
    </div>
  )
}
