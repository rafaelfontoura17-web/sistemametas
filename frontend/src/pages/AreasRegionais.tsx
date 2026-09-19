import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

interface Regional { id: string; name: string; code: string; active: boolean }
interface Area { id: string; name: string; code: string; active: boolean }
interface Vinculo { area_id: string; regional_id: string; area_name: string; regional_name: string }

export default function AreasRegionais() {
  const { isAdmin } = useAuth()
  const [regionais, setRegionais] = useState<Regional[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: r, error: rErr }, { data: a, error: aErr }, { data: v, error: vErr }] = await Promise.all([
      supabase.from('regionals').select('*').order('name'),
      supabase.from('areas').select('*').order('name'),
      supabase.from('area_regionals').select('area_id, regional_id, areas(name), regionals(name)').eq('active', true),
    ])
    if (rErr || aErr || vErr) setErrorMsg((rErr ?? aErr ?? vErr)?.message ?? 'Erro desconhecido')
    setRegionais((r ?? []) as Regional[])
    setAreas((a ?? []) as Area[])
    setVinculos(
      ((v ?? []) as any[]).map((row) => ({
        area_id: row.area_id, regional_id: row.regional_id,
        area_name: row.areas?.name ?? '?', regional_name: row.regionals?.name ?? '?',
      }))
    )
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">{errorMsg}</p>

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-800">Áreas e Regionais</h1>

      <Secao titulo="Regionais">
        <ListaSimples items={regionais} />
        {isAdmin && <NovoRegistro tabela="regionals" onDone={load} />}
      </Secao>

      <Secao titulo="Áreas">
        <ListaSimples items={areas} />
        {isAdmin && <NovoRegistro tabela="areas" onDone={load} />}
      </Secao>

      <Secao titulo="Vínculo Área ↔ Regional">
        <p className="text-xs text-slate-400 mb-2">
          Uma Área só pode ter metas numa Regional se esse vínculo existir aqui.
        </p>
        <ul className="divide-y divide-slate-100">
          {vinculos.map((v) => (
            <li key={`${v.area_id}-${v.regional_id}`} className="py-2 text-sm text-slate-700">
              {v.area_name} <span className="text-slate-400">—</span> {v.regional_name}
            </li>
          ))}
          {vinculos.length === 0 && <li className="text-sm text-slate-400 py-2">Nenhum vínculo.</li>}
        </ul>
        {isAdmin && <NovoVinculo areas={areas} regionais={regionais} onDone={load} />}
      </Secao>
    </div>
  )
}

function NovoVinculo({ areas, regionais, onDone }: { areas: Area[]; regionais: Regional[]; onDone: () => void }) {
  const [areaId, setAreaId] = useState('')
  const [regionalId, setRegionalId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!areaId || !regionalId) { setError('Selecione a Área e a Regional.'); return }
    setSubmitting(true)
    setError(null)
    const { error: insertError } = await supabase.from('area_regionals').insert({ area_id: areaId, regional_id: regionalId })
    setSubmitting(false)
    if (insertError) { setError(insertError.message); return }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
      <select value={areaId} onChange={(e) => setAreaId(e.target.value)} className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm flex-1">
        <option value="">Área</option>
        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select value={regionalId} onChange={(e) => setRegionalId(e.target.value)} className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm flex-1">
        <option value="">Regional</option>
        {regionais.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <button type="submit" disabled={submitting} className="text-sm rounded-lg bg-ambar-accent text-white px-3 py-1.5 disabled:opacity-60">
        Vincular
      </button>
      {error && <p className="text-xs text-red-600 self-center">{error}</p>}
    </form>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-medium text-slate-700 mb-3">{titulo}</h2>
      {children}
    </div>
  )
}

function ListaSimples({ items }: { items: { id: string; name: string; code: string; active: boolean }[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between py-2 text-sm">
          <span className="text-slate-700">{item.name}</span>
          <span className="text-xs text-slate-400">{item.code}</span>
        </li>
      ))}
      {items.length === 0 && <li className="text-sm text-slate-400 py-2">Nenhum registro.</li>}
    </ul>
  )
}

function NovoRegistro({ tabela, onDone }: { tabela: 'regionals' | 'areas'; onDone: () => void }) {
  const [nome, setNome] = useState('')
  const [codigo, setCodigo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim() || !codigo.trim()) { setError('Preencha nome e código.'); return }
    setSubmitting(true)
    setError(null)
    const { error: insertError } = await supabase.from(tabela).insert({ name: nome.trim(), code: codigo.trim().toUpperCase() })
    setSubmitting(false)
    if (insertError) { setError(insertError.message); return }
    setNome(''); setCodigo('')
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
      <input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm flex-1" />
      <input placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm w-32" />
      <button type="submit" disabled={submitting} className="text-sm rounded-lg bg-ambar-accent text-white px-3 py-1.5 disabled:opacity-60">
        Adicionar
      </button>
      {error && <p className="text-xs text-red-600 self-center">{error}</p>}
    </form>
  )
}
