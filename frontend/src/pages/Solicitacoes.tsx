import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

interface Solicitacao {
  id: string
  request_type: string
  status: 'pendente' | 'aprovada' | 'reprovada'
  justification: string | null
  created_at: string
  resolved_at: string | null
}

const TIPO_LABEL: Record<string, string> = {
  alteracao_resultado: 'Alteração de resultado',
  alteracao_meta: 'Alteração de meta',
  exclusao: 'Exclusão de meta',
  reabertura: 'Reabertura de Área',
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pendente: { label: 'Pendente', className: 'bg-blue-100 text-blue-700' },
  aprovada: { label: 'Aprovada', className: 'bg-emerald-100 text-emerald-700' },
  reprovada: { label: 'Reprovada', className: 'bg-red-100 text-red-700' },
}

export default function Solicitacoes() {
  const { appUser } = useAuth()
  const [rows, setRows] = useState<Solicitacao[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('approval_requests')
      .select('id, request_type, status, justification, created_at, resolved_at')
      .eq('requester_id', appUser?.id)
      .order('created_at', { ascending: false })
    setRows((data ?? []) as Solicitacao[])
    setLoading(false)
  }

  useEffect(() => {
    if (appUser) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser])

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Minhas solicitações</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Alterações de resultado pedidas pela tela da meta aparecem aqui também.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-sm rounded-lg bg-ambar-accent text-white font-medium px-3 py-1.5 hover:bg-ambar-dark"
        >
          Solicitar reabertura de Área
        </button>
      </div>

      {showForm && <ReaberturaForm onDone={() => { setShowForm(false); load() }} />}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Tipo</th>
                <th className="text-left font-medium px-4 py-2.5">Justificativa</th>
                <th className="text-left font-medium px-4 py-2.5">Criada em</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = STATUS_LABEL[r.status]
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 text-slate-700">{TIPO_LABEL[r.request_type] ?? r.request_type}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.justification ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{new Date(r.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nenhuma solicitação ainda.</p>}
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
