import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import ApprovalCard, { type ApprovalDetail } from '../components/ApprovalCard'

export default function Solicitacoes() {
  const { appUser } = useAuth()
  const [rows, setRows] = useState<ApprovalDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [regional, setRegional] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('v_approval_details')
      .select('*')
      .eq('requester_id', appUser?.id)
      .order('created_at', { ascending: false })
    setRows((data ?? []) as ApprovalDetail[])
    setLoading(false)
  }

  useEffect(() => {
    if (appUser) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser])

  const regionais = useMemo(
    () => Array.from(new Set(rows.map((r) => r.regional_name).filter(Boolean))).sort((a, b) => a!.localeCompare(b!, 'pt-BR')),
    [rows]
  )
  const filtered = useMemo(
    () => (regional ? rows.filter((r) => r.regional_name === regional) : rows),
    [rows, regional]
  )

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Minhas solicitações"
        actions={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-sm rounded-lg bg-ambar-accent text-white font-medium px-3 py-1.5 hover:bg-ambar-dark whitespace-nowrap"
          >
            Solicitar reabertura de Área
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setRegional(null)}
          className={`px-3 py-1.5 rounded-full text-sm border ${!regional ? 'bg-ambar-accent text-white border-ambar-accent' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
        >
          Todas as regionais
        </button>
        {regionais.map((r) => (
          <button
            key={r}
            onClick={() => setRegional(r)}
            className={`px-3 py-1.5 rounded-full text-sm border ${regional === r ? 'bg-ambar-accent text-white border-ambar-accent' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
          >
            {r}
          </button>
        ))}
      </div>

      {showForm && <ReaberturaForm onDone={() => { setShowForm(false); load() }} />}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ApprovalCard key={r.request_id} req={r} showRequester={false} />
          ))}
          {filtered.length === 0 && <p className="text-sm text-slate-400">Nenhuma solicitação ainda.</p>}
        </div>
      )}
    </div>
  )
}

interface ClosedArea {
  area_id: string
  regional_id: string
  cycle_id: string
  area_name: string
  regional_name: string
}

function ReaberturaForm({ onDone }: { onDone: () => void }) {
  const [closedAreas, setClosedAreas] = useState<ClosedArea[]>([])
  const [selected, setSelected] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('v_area_results')
      .select('area_id, regional_id, cycle_id, area_name, regional_name')
      .eq('status_fechamento', 'fechada')
      .then(({ data }) => setClosedAreas((data ?? []) as ClosedArea[]))
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!selected) { setError('Selecione a Área fechada que deseja reabrir.'); return }
    if (!justificativa.trim()) { setError('Justificativa é obrigatória.'); return }

    const area = closedAreas.find((a) => a.area_id === selected)!
    setSubmitting(true)
    const { error: rpcError } = await supabase.rpc('create_approval_request', {
      p_request_type: 'reabertura',
      p_goal_id: null,
      p_regional_id: area.regional_id,
      p_area_id: area.area_id,
      p_cycle_id: area.cycle_id,
      p_justification: justificativa,
      p_items: null,
    })
    setSubmitting(false)
    if (rpcError) { setError(rpcError.message); return }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <select value={selected} onChange={(e) => setSelected(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full">
        <option value="">Selecione a Área fechada</option>
        {closedAreas.map((a) => (
          <option key={a.area_id} value={a.area_id}>{a.area_name} — {a.regional_name}</option>
        ))}
      </select>
      <textarea
        placeholder="Motivo da reabertura (obrigatório)"
        value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
        className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full" rows={2}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {closedAreas.length === 0 && (
        <p className="text-xs text-slate-400">Nenhuma Área fechada no seu escopo no momento.</p>
      )}
      <button type="submit" disabled={submitting} className="rounded-lg bg-ambar-accent text-white text-sm font-medium px-4 py-2 hover:bg-ambar-dark disabled:opacity-60">
        {submitting ? 'Enviando…' : 'Enviar solicitação'}
      </button>
    </form>
  )
}
