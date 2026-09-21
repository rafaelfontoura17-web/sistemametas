import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import PageHeader from '../components/PageHeader'
import { STATUS_STYLES, STATUS_SHORT_LABEL, type GoalStatus } from '../lib/statusColors'

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
  result_status: GoalStatus | null
}

function statusOf(row: GoalRow): GoalStatus {
  return row.result_status ?? 'pendente'
}

export default function Metas() {
  const [rows, setRows] = useState<GoalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [regional, setRegional] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)
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

  // Área depende da Regional selecionada — só mostra o que existe ali.
  const areas = useMemo(() => {
    const base = regional ? rows.filter((r) => r.regional_name === regional) : rows
    return Array.from(new Set(base.map((r) => r.area_name))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [rows, regional])

  function handleRegionalChange(value: string | null) {
    setRegional(value)
    setArea(null) // volta a mostrar todas as áreas ao trocar de regional
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (regional && r.regional_name !== regional) return false
      if (area && r.area_name !== area) return false
      if (statusFilter === 'pendente' && r.result_status !== null) return false
      if (statusFilter && statusFilter !== 'pendente' && r.result_status !== statusFilter) return false
      return true
    })
  }, [rows, regional, area, statusFilter])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">Não foi possível carregar as metas: {errorMsg}</p>

  return (
    <div className="space-y-4">
      <PageHeader
        title="Metas e Apuração"
        actions={<span className="text-sm text-slate-400">{filtered.length} de {rows.length} metas</span>}
      />

      <div className="flex flex-wrap gap-2">
        <select
          value={regional ?? ''}
          onChange={(e) => handleRegionalChange(e.target.value || null)}
          className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
        >
          <option value="">Todas as regionais</option>
          {regionais.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={area ?? ''}
          onChange={(e) => setArea(e.target.value || null)}
          className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
        >
          <option value="">Todas as áreas</option>
          {areas.map((a) => (
            <option key={a} value={a}>{a}</option>
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
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[status].badgeClassName}`}>
                      {STATUS_SHORT_LABEL[status]}
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
