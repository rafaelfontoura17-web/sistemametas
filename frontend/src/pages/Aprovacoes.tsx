import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

interface Pendente {
  id: string
  request_type: string
  status: string
  justification: string | null
  requester_id: string
  created_at: string
  goal_id: string | null
  can_approve: boolean
}

const TIPO_LABEL: Record<string, string> = {
  alteracao_resultado: 'Alteração de resultado',
  alteracao_meta: 'Alteração de meta',
  exclusao: 'Exclusão de meta',
  reabertura: 'Reabertura de Área',
}

export default function Aprovacoes() {
  const [rows, setRows] = useState<Pendente[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('approval_requests')
      .select('id, request_type, status, justification, requester_id, created_at, goal_id')
      .eq('status', 'pendente')
      .order('created_at')

    if (error) { setErrorMsg(error.message); setLoading(false); return }

    // fn_is_eligible_approver embute a hierarquia (Gestor de Regional
    // inteira > Gestor de Área) — a RLS já mostra só o que está no meu
    // escopo, mas só isso não diz se EU especificamente posso aprovar
    // (ex.: um par no mesmo nível não pode). Checa uma a uma.
    const withEligibility = await Promise.all(
      (data ?? []).map(async (r) => {
        const { data: elig } = await supabase.rpc('fn_can_approve', { p_request_id: r.id })
        return { ...r, can_approve: Boolean(elig) } as Pendente
      })
    )
    setRows(withEligibility)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleApprove(id: string) {
    setBusyId(id)
    setErrorMsg(null)
    const { error } = await supabase.rpc('approve_request', { p_request_id: id })
    setBusyId(null)
    if (error) { setErrorMsg(error.message); return }
    load()
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) { setErrorMsg('Justificativa é obrigatória para reprovar.'); return }
    setBusyId(id)
    setErrorMsg(null)
    const { error } = await supabase.rpc('reject_request', { p_request_id: id, p_justification: rejectReason })
    setBusyId(null)
    if (error) { setErrorMsg(error.message); return }
    setRejectingId(null)
    setRejectReason('')
    load()
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Aprovações</h1>
        <p className="text-sm text-slate-500 mt-0.5">{rows.length} solicitação(ões) pendente(s) no seu escopo.</p>
      </div>

      {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{TIPO_LABEL[r.request_type] ?? r.request_type}</p>
                <p className="text-xs text-slate-500 mt-0.5">{r.justification}</p>
                <p className="text-xs text-slate-400 mt-1">{new Date(r.created_at).toLocaleString('pt-BR')}</p>
              </div>
              {!r.can_approve && (
                <span className="text-[11px] text-slate-400 whitespace-nowrap">Fora da sua alçada</span>
              )}
            </div>

            {r.can_approve && (
              rejectingId === r.id ? (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  <textarea
                    placeholder="Motivo da reprovação (obrigatório)"
                    value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full" rows={2}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReject(r.id)} disabled={busyId === r.id}
                      className="text-sm rounded-lg bg-red-600 text-white px-3 py-1.5 disabled:opacity-60"
                    >
                      Confirmar reprovação
                    </button>
                    <button onClick={() => { setRejectingId(null); setRejectReason('') }} className="text-sm text-slate-500 px-2">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
                  <button
                    onClick={() => handleApprove(r.id)} disabled={busyId === r.id}
                    className="text-sm rounded-lg bg-ambar-accent text-white px-3 py-1.5 hover:bg-ambar-dark disabled:opacity-60"
                  >
                    {busyId === r.id ? 'Aprovando…' : 'Aprovar'}
                  </button>
                  <button
                    onClick={() => setRejectingId(r.id)}
                    className="text-sm rounded-lg border border-slate-300 text-slate-600 px-3 py-1.5"
                  >
                    Reprovar
                  </button>
                </div>
              )
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400">Nenhuma solicitação pendente.</p>}
      </div>
    </div>
  )
}
