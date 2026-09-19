import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import PageHeader from '../components/PageHeader'
import ProgressRing from '../components/ProgressRing'
import { areaStatus, STATUS_STYLES, type GoalStatus } from '../lib/statusColors'
import { formatReal, formatCriterio, isBandAchieved, type GoalRange } from '../lib/goalFormat'

interface AreaSummary {
  area_id: string
  area_name: string
  regional_name: string
  total_metas: number
  metas_apuradas: number
  metas_criticas: number
  metas_pendentes: number
  resultado_ponderado: number
}

interface GoalRow {
  goal_id: string
  indicator_name: string
  indicator_description: string | null
  direction: string
  unidade: string | null
  weight: number
  real_value: number | null
  real_value_pct: number | null
  attainment_percentage: number | null
  weighted_result: number | null
  result_status: GoalStatus | null
}

export default function AreaDetail() {
  const { areaId } = useParams()
  const [area, setArea] = useState<AreaSummary | null>(null)
  const [goals, setGoals] = useState<GoalRow[]>([])
  const [ranges, setRanges] = useState<Record<string, GoalRange[]>>({})
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: a, error: aErr }, { data: g, error: gErr }] = await Promise.all([
        supabase.from('v_area_results').select('*').eq('area_id', areaId).maybeSingle(),
        supabase.from('v_goal_details').select('*').eq('area_id', areaId).order('indicator_name'),
      ])
      if (cancelled) return
      if (aErr || gErr) {
        setErrorMsg((aErr ?? gErr)?.message ?? 'Erro desconhecido')
        setLoading(false)
        return
      }
      setArea(a as AreaSummary)
      setGoals((g ?? []) as GoalRow[])

      const goalIds = (g ?? []).map((row: any) => row.goal_id)
      if (goalIds.length > 0) {
        const { data: r } = await supabase
          .from('goal_ranges')
          .select('goal_id, attainment_percentage, target_value, target_month')
          .in('goal_id', goalIds)
          .order('attainment_percentage')
        const grouped: Record<string, GoalRange[]> = {}
        for (const row of (r ?? []) as (GoalRange & { goal_id: string })[]) {
          grouped[row.goal_id] = grouped[row.goal_id] ?? []
          grouped[row.goal_id].push(row)
        }
        if (!cancelled) setRanges(grouped)
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [areaId])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">Não foi possível carregar a área: {errorMsg}</p>
  if (!area) return <p className="text-sm text-slate-400">Área não encontrada (ou fora do seu escopo).</p>

  const status = areaStatus(area)

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title={area.area_name} breadcrumb={<><Link to="/" className="hover:underline">Visão por área</Link> / {area.area_name}</>} />

      <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-5">
        <ProgressRing percent={area.resultado_ponderado} status={status} size={72} />
        <div>
          <p className="font-semibold text-slate-800">{area.area_name}</p>
          <span className={`inline-block text-xs font-medium px-2.5 py-0.5 rounded-full mt-1 ${STATUS_STYLES[status].badgeClassName}`}>
            {STATUS_STYLES[status].label}
          </span>
          <p className="text-sm text-slate-500 mt-1.5">{area.metas_apuradas} de {area.total_metas} metas apuradas</p>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Metas da área</h2>
        <div className="space-y-4">
          {goals.map((goal) => (
            <GoalCard key={goal.goal_id} goal={goal} areaName={area.area_name} ranges={ranges[goal.goal_id] ?? []} />
          ))}
          {goals.length === 0 && <p className="text-sm text-slate-400">Nenhuma meta cadastrada nesta área.</p>}
        </div>
      </div>
    </div>
  )
}

function GoalCard({ goal, areaName, ranges }: { goal: GoalRow; areaName: string; ranges: GoalRange[] }) {
  const status = goal.result_status ?? 'pendente'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={`/metas/${goal.goal_id}`} className="font-semibold text-slate-800 hover:text-ambar-accent">
            {goal.indicator_name}
          </Link>
          {goal.indicator_description && (
            <p className="text-sm text-slate-500 mt-1">{goal.indicator_description}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">{areaName}</span>
            {goal.unidade && <span className="text-[11px] text-slate-400">Unidade: {goal.unidade}</span>}
          </div>
        </div>

        <div className="shrink-0 text-right grid grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] text-slate-400 uppercase">Real</p>
            <p className="text-sm font-bold text-ambar-accent">{formatReal(goal)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase">Peso</p>
            <p className="text-sm text-slate-700">{goal.weight.toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase">Resultado</p>
            <p className="text-sm font-semibold text-slate-800">
              {goal.attainment_percentage != null ? `${goal.attainment_percentage.toFixed(0)}%` : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, goal.attainment_percentage ?? 0)}%`,
              backgroundColor: { atingido: '#10b981', parcial: '#3b82f6', critico: '#ef4444', pendente: '#fbbf24' }[status],
            }}
          />
        </div>
        <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">{STATUS_STYLES[status].label}</span>
      </div>

      {ranges.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 uppercase mb-2">Métricas da meta {goal.unidade ? `(${goal.unidade})` : ''}</p>
          <div className="grid grid-cols-5 gap-2">
            {ranges.map((band) => {
              const achieved = isBandAchieved(goal, band)
              return (
                <div
                  key={band.attainment_percentage}
                  className={`rounded-lg border text-center py-2 px-1 ${
                    achieved ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <p className={`text-xs font-semibold ${achieved ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {band.attainment_percentage.toFixed(0)}%
                  </p>
                  <p className={`text-[11px] mt-0.5 ${achieved ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {formatCriterio(goal.direction, goal.unidade, band)}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
