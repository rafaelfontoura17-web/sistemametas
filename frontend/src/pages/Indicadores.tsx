import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

interface Indicador {
  id: string
  name: string
  description: string | null
  direction: string
  measurement_unit_id: string | null
  measurement_units: { name: string } | null
}
interface Unidade { id: string; name: string; code: string }

const DIRECOES = [
  { value: 'maior_melhor', label: 'Maior é melhor' },
  { value: 'menor_melhor', label: 'Menor é melhor' },
  { value: 'binario', label: 'Binário (sim/não)' },
  { value: 'cronologico', label: 'Cronológico (por mês)' },
  { value: 'percentual_por_mes', label: 'Percentual + mês (composta)' },
]

export default function Indicadores() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<Indicador[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: i, error: iErr }, { data: u }] = await Promise.all([
      supabase.from('indicators').select('id, name, description, direction, measurement_unit_id, measurement_units(name)').order('name'),
      supabase.from('measurement_units').select('id, name, code').order('name'),
    ])
    if (iErr) setErrorMsg(iErr.message)
    setRows((i ?? []) as unknown as Indicador[])
    setUnidades((u ?? []) as Unidade[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">{errorMsg}</p>

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-800">Indicadores</h1>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Nome</th>
              <th className="text-left font-medium px-4 py-2.5">Direção</th>
              <th className="text-left font-medium px-4 py-2.5">Unidade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-700">{r.name}</td>
                <td className="px-4 py-2.5 text-slate-500">{DIRECOES.find((d) => d.value === r.direction)?.label ?? r.direction}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.measurement_units?.name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nenhum indicador cadastrado.</p>}
      </div>

      {isAdmin && <NovoIndicador unidades={unidades} onDone={load} />}
    </div>
  )
}

function NovoIndicador({ unidades, onDone }: { unidades: Unidade[]; onDone: () => void }) {
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [direction, setDirection] = useState('maior_melhor')
  const [unidadeId, setUnidadeId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setError('Preencha o nome.'); return }
    setSubmitting(true)
    setError(null)
    const { error: insertError } = await supabase.from('indicators').insert({
      name: nome.trim(),
      description: descricao.trim() || null,
      direction,
      measurement_unit_id: unidadeId || null,
    })
    setSubmitting(false)
    if (insertError) { setError(insertError.message); return }
    setNome(''); setDescricao('')
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <h2 className="text-sm font-medium text-slate-700">Novo indicador</h2>
      <input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full" />
      <textarea placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full" rows={2} />
      <div className="flex gap-3">
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1">
          {DIRECOES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1">
          <option value="">Unidade de medida</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="text-sm rounded-lg bg-ambar-accent text-white px-4 py-2 hover:bg-ambar-dark disabled:opacity-60">
        Adicionar
      </button>
    </form>
  )
}
