import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

interface AreaResult {
  area_id: string
  area_name: string
  category: 'coordenacao' | 'supervisao' | 'outras'
  regional_id: string
  regional_name: string
  cycle_id: string
  total_metas: number
  metas_apuradas: number
  metas_criticas: number
  metas_parciais: number
  metas_atingidas: number
  metas_pendentes: number
  peso_total: number
  resultado_ponderado: number
  status_fechamento: 'aberta' | 'fechada' | null
}

function statusBadge(area: AreaResult) {
  if (area.metas_pendentes > 0) {
    return { label: 'Aguardando apuração', className: 'bg-blue-100 text-blue-700' }
  }
  if (area.metas_criticas > 0 && area.resultado_ponderado < 80) {
    return { label: 'Crítico', className: 'bg-red-100 text-red-700' }
  }
  if (area.resultado_ponderado < 100) {
    return { label: 'Parcial', className: 'bg-amber-100 text-amber-700' }
  }
  return { label: 'Atingido', className: 'bg-emerald-100 text-emerald-700' }
}

export default function Dashboard() {
  const [rows, setRows] = useState<AreaResult[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [regional, setRegional] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase.from('v_area_results').select('*')
      if (cancelled) return
      if (error) {
        setErrorMsg(error.message)
      } else {
        setRows((data ?? []) as AreaResult[])
      }
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

  const filtered = useMemo(
    () => (regional ? rows.filter((r) => r.regional_name === regional) : rows),
    [rows, regional]
  )

  const kpis = useMemo(() => {
    const acc = {
      totalMetas: 0,
      apuradas: 0,
      naoApuradas: 0,
      criticas: 0,
      parciais: 0,
      atingidas: 0,
    }
    for (const r of filtered) {
      acc.totalMetas += r.total_metas
      acc.apuradas += r.metas_apuradas
      acc.naoApuradas += r.metas_pendentes
      acc.criticas += r.metas_criticas
      acc.parciais += r.metas_parciais
      acc.atingidas += r.metas_atingidas
    }
    return acc
  }, [filtered])

  // Ranking só faz sentido dentro de UMA regional (doc. 08: "Ranking
  // somente entre Áreas da mesma Regional").
  const ranking = useMemo(() => {
    if (!regional) return null
    return [...filtered].sort((a, b) => b.resultado_ponderado - a.resultado_ponderado)
  }, [filtered, regional])

  if (loading) {
    return <p className="text-sm text-slate-400">Carregando…</p>
  }

  if (errorMsg) {
    return (
      <p className="text-sm text-red-600">
        Não foi possível carregar o dashboard: {errorMsg}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {kpis.apuradas} de {kpis.totalMetas} metas apuradas
          {regional ? ` em ${regional}` : ' no total'}.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setRegional(null)}
          className={`px-3 py-1.5 rounded-full text-sm border ${
            !regional
              ? 'bg-ambar-accent text-white border-ambar-accent'
              : 'border-slate-300 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Todas as regionais
        </button>
        {regionais.map((r) => (
          <button
            key={r}
            onClick={() => setRegional(r)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              regional === r
                ? 'bg-ambar-accent text-white border-ambar-accent'
                : 'border-slate-300 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ['Total de metas', kpis.totalMetas],
          ['Apuradas', kpis.apuradas],
          ['Não apuradas', kpis.naoApuradas],
          ['Críticas', kpis.criticas],
          ['Atenção', kpis.parciais],
          ['Atingidas', kpis.atingidas],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-2xl font-semibold text-slate-800 mt-1">{value}</p>
          </div>
        ))}
      </div>

      {ranking && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700 mb-3">
            Ranking — {regional}
          </h2>
          <ol className="space-y-1">
            {ranking.map((a, i) => (
              <li
                key={a.area_id}
                className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0"
              >
                <span className="text-slate-600">
                  <span className="text-slate-400 mr-2">{i + 1}.</span>
                  {a.area_name}
                </span>
                <span className="font-medium text-slate-800">
                  {a.resultado_ponderado.toFixed(1)}%
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-slate-700 mb-3">Áreas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((a) => {
            const badge = statusBadge(a)
            return (
              <div key={a.area_id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{a.area_name}</p>
                    <p className="text-xs text-slate-400">{a.regional_name}</p>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <p className="text-xs text-slate-500">
                    {a.metas_apuradas}/{a.total_metas} metas apuradas
                  </p>
                  <p className="text-lg font-semibold text-slate-800">
                    {a.resultado_ponderado.toFixed(1)}%
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
