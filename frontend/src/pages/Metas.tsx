import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

interface GoalRow {
  goal_id: string
  area_name: string
  regional_name: string
  indicator_name: string
  direction: string
  weight: number
  real_value: number | null
  real_value_pct: number | null
  attainment_percentage: number | null
  result_status: 'pendente' | 'critico' | 'parcial' | 'atingido' | null
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  critico: { label: 'Crítico', className: 'bg-red-100 text-red-700' },
  parcial: { label: 'Parcial', className: 'bg-amber-100 text-amber-700' },
  atingido: { label: 'Atingido', className: 'bg-emerald-100 text-emerald-700' },
}

function statusOf(row: GoalRow) {
  return row.result_status ?? null
}

export default function Metas() {
  const [rows, setRows] = useState<GoalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [regional, setRegional] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('v_goal_details')
        .select(
          'goal_id, area_name, regional_name, indicator_name, direction, weight, real_value, real_value_pct, attainment_percentage, result_status'
        )
        .order('area_name')
      if (cancelled) return
      if (error) setErrorMsg(error.message)
      else setRows((data ?? []) as GoalRow[])
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const regionais = useMemo(
    () => Array.from(new Set(rows.map((r) => r.regional_name))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [rows]
  )

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (regional && r.regional_name !== regional) return false
      if (statusFilter === 'pendente' && r.result_status !== null) return false
      if (statusFilter && statusFilter !== 'pendente' && r.result_status !== statusFilter) return false
      return true
    })
  }, [rows, regional, statusFilter])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">Não foi possível carregar as metas: {errorMsg}</p>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Metas</h1>
        <p className="text-sm text-slate-500 mt-0.5">{filtered.length} de {rows.length} metas</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={regional ?? ''}
          onChange={(e) => setRegional(e.target.value || null)}
          className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
        >
          <option value="">Todas as regionais</option>
          {regionais.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter(e.target.value || null)}
          className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
        >
          <option value="">Todos os status</option>
          <option value="pendente">Aguardando apuração</option>
          <option value="critico">Crítico</option>
          <option value="parcial">Parcial</option>
          <option value="atingido">Atingido</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Indicador</th>
              <th className="text-left font-medium px-4 py-2.5">Área</th>
              <th className="text-left font-medium px-4 py-2.5">Regional</th>
              <th className="text-right font-medium px-4 py-2.5">Peso</th>
              <th className="text-right font-medium px-4 py-2.5">Atingimento</th>
              <th className="text-left font-medium px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const status = statusOf(r)
              const badge = status ? STATUS_LABEL[status] : { label: 'Aguardando apuração', className: 'bg-blue-100 text-blue-700' }
              return (
                <tr key={r.goal_id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link to={`/metas/${r.goal_id}`} className="text-ambar-accent hover:underline">
                      {r.indicator_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{r.area_name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.regional_name}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{r.weight.toFixed(0)}%</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                    {r.attainment_percentage != null ? `${r.attainment_percentage.toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.className}`}>
                      {badge.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">Nenhuma meta encontrada com esse filtro.</p>
        )}
      </div>
    </div>
  )
}
