import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import PageHeader from '../components/PageHeader'
import ProgressRing from '../components/ProgressRing'
import { areaStatus, STATUS_SHORT_LABEL, STATUS_STYLES } from '../lib/statusColors'

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

// Mesmos tons suaves do painel-metas original — servem só pra diferenciar
// visualmente o nível hierárquico da área, não têm relação com status.
const CATEGORY_STYLE = {
  coordenacao: { label: 'Coordenação', bg: 'bg-[#eef0fb]', border: 'border-[#dde1f7]' },
  supervisao: { label: 'Supervisão', bg: 'bg-[#fdf3ea]', border: 'border-[#f8e6d3]' },
  outras: { label: 'Demais áreas', bg: 'bg-[#eef4ee]', border: 'border-[#dfeadf]' },
} as const

export default function Dashboard() {
  const navigate = useNavigate()
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
      if (error) setErrorMsg(error.message)
      else setRows((data ?? []) as AreaResult[])
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

  const regionaisVisiveis = regional ? [regional] : regionais

  const kpis = useMemo(() => {
    const filtered = regional ? rows.filter((r) => r.regional_name === regional) : rows
    const acc = { totalMetas: 0, apuradas: 0 }
    for (const r of filtered) {
      acc.totalMetas += r.total_metas
      acc.apuradas += r.metas_apuradas
    }
    return acc
  }, [rows, regional])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">Não foi possível carregar o dashboard: {errorMsg}</p>

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão por área"
        actions={<span className="text-sm text-slate-400">{kpis.apuradas} de {kpis.totalMetas} metas apuradas ao todo</span>}
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setRegional(null)}
          className={`px-4 py-2 rounded-full text-sm font-medium border ${
            !regional ? 'bg-ambar-accent text-white border-ambar-accent' : 'border-slate-300 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Todas as regionais
        </button>
        {regionais.map((r) => (
          <button
            key={r}
            onClick={() => setRegional(r)}
            className={`px-4 py-2 rounded-full text-sm font-medium border ${
              regional === r ? 'bg-ambar-accent text-white border-ambar-accent' : 'border-slate-300 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className={`grid gap-5 items-start ${regionaisVisiveis.length === 1 ? 'grid-cols-1 max-w-md' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
        {regionaisVisiveis.map((regionalName) => {
          const areasDaRegional = rows.filter((r) => r.regional_name === regionalName)
          return (
            <div key={regionalName} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800">{regionalName}</h2>
              </div>
              <div className="p-4 space-y-5">
                {(['coordenacao', 'supervisao', 'outras'] as const).map((cat) => {
                  const areas = areasDaRegional.filter((a) => a.category === cat)
                  if (areas.length === 0) return null
                  const style = CATEGORY_STYLE[cat]
                  return (
                    <div key={cat}>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                        {style.label}
                      </p>
                      <div className="space-y-2">
                        {areas.map((a) => {
                          const status = areaStatus(a)
                          return (
                            <button
                              key={a.area_id}
                              onClick={() => navigate(`/areas/${a.area_id}`)}
                              className={`w-full text-left rounded-lg border p-3 flex items-center justify-between gap-3 hover:shadow-sm transition-shadow ${style.bg} ${style.border}`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{a.area_name}</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {a.metas_apuradas}/{a.total_metas} metas apuradas
                                </p>
                                <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full mt-1.5 ${STATUS_STYLES[status].badgeClassName}`}>
                                  {STATUS_SHORT_LABEL[status]}
                                </span>
                              </div>
                              <ProgressRing percent={a.resultado_ponderado} status={status} />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
