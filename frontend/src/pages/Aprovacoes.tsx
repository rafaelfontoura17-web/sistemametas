import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import PageHeader from '../components/PageHeader'
import ApprovalCard, { type ApprovalDetail } from '../components/ApprovalCard'

interface Row extends ApprovalDetail {
  can_approve: boolean
  regional_id: string | null
}

export default function Aprovacoes() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [regional, setRegional] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [batchReason, setBatchReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('v_approval_details')
      .select('*')
      .eq('status', 'pendente')
      .order('created_at')

    if (error) { setErrorMsg(error.message); setLoading(false); return }

    const withEligibility = await Promise.all(
      (data ?? []).map(async (r) => {
        const { data: elig } = await supabase.rpc('fn_can_approve', { p_request_id: r.request_id })
        return { ...r, can_approve: Boolean(elig) } as Row
      })
    )
    setRows(withEligibility)
    setSelected(new Set())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const regionais = useMemo(
    () => Array.from(new Set(rows.map((r) => r.regional_name).filter(Boolean))).sort((a, b) => a!.localeCompare(b!, 'pt-BR')),
    [rows]
  )
  const filtered = useMemo(
    () => (regional ? rows.filter((r) => r.regional_name === regional) : rows),
    [rows, regional]
  )

  const selectedType = useMemo(() => {
    const ids = [...selected]
    if (ids.length === 0) return null
    const row = rows.find((r) => r.request_id === ids[0])
    return row?.request_type ?? null
  }, [selected, rows])

  function toggleSelect(row: Row) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(row.request_id)) {
        next.delete(row.request_id)
      } else {
        if (selectedType && selectedType !== row.request_type) return prev
        next.add(row.request_id)
      }
      return next
    })
  }

  async function handleApprove(id: string) {
    setBusy(true)
    setErrorMsg(null)
    const { error } = await supabase.rpc('approve_request', { p_request_id: id })
    setBusy(false)
    if (error) { setErrorMsg(error.message); return }
    load()
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) { setErrorMsg('Justificativa é obrigatória para reprovar.'); return }
    setBusy(true)
    setErrorMsg(null)
    const { error } = await supabase.rpc('reject_request', { p_request_id: id, p_justification: rejectReason })
    setBusy(false)
    if (error) { setErrorMsg(error.message); return }
    setRejectingId(null); setRejectReason('')
    load()
  }

  async function handleBatchApprove() {
    setBusy(true)
    setErrorMsg(null)
    setBatchResult(null)
    const { data, error } = await supabase.rpc('batch_approve_requests', {
      p_ids: [...selected],
      p_justification: batchReason || null,
    })
    setBusy(false)
    if (error) { setErrorMsg(error.message); return }

    const rows_ = (data ?? []) as { request_id: string; success: boolean; error_message: string | null }[]
    const falhas = rows_.filter((r) => !r.success)
    setBatchResult(
      falhas.length === 0
        ? `${rows_.length} solicitação(ões) aprovada(s) com sucesso.`
        : `${rows_.length - falhas.length} aprovada(s); ${falhas.length} falharam: ${falhas.map((f) => f.error_message).join('; ')}`
    )
    setBatchReason('')
    load()
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Aprovações"
        actions={<span className="text-sm text-slate-400">{filtered.length} pendente(s)</span>}
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

      {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
      {batchResult && <p className="text-sm text-slate-600 bg-slate-100 rounded-lg px-3 py-2">{batchResult}</p>}

      {selected.size > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-2 sticky top-0 z-10">
          <span className="text-sm text-slate-600">{selected.size} selecionada(s)</span>
          <input
            placeholder="Justificativa do lote (opcional)"
            value={batchReason} onChange={(e) => setBatchReason(e.target.value)}
            className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <button onClick={handleBatchApprove} disabled={busy} className="text-sm rounded-lg bg-ambar-accent text-white px-3 py-1.5 disabled:opacity-60 whitespace-nowrap">
            Aprovar selecionadas
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-slate-500 px-2">Limpar</button>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((r) => (
          <div key={r.request_id} className="flex items-start gap-2">
            {r.can_approve && (
              <input
                type="checkbox" className="mt-4"
                checked={selected.has(r.request_id)}
                disabled={selectedType !== null && selectedType !== r.request_type && !selected.has(r.request_id)}
                onChange={() => toggleSelect(r)}
              />
            )}
            <div className="flex-1">
              <ApprovalCard
                req={r}
                actions={
                  r.can_approve ? (
                    rejectingId === r.request_id ? (
                      <div className="space-y-2">
                        <textarea
                          placeholder="Motivo da reprovação (obrigatório)"
                          value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                          className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full" rows={2}
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleReject(r.request_id)} disabled={busy} className="text-sm rounded-lg bg-red-600 text-white px-3 py-1.5 disabled:opacity-60">
                            Confirmar reprovação
                          </button>
                          <button onClick={() => { setRejectingId(null); setRejectReason('') }} className="text-sm text-slate-500 px-2">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => handleApprove(r.request_id)} disabled={busy} className="text-sm rounded-lg bg-ambar-accent text-white px-3 py-1.5 disabled:opacity-60">
                          Aprovar
                        </button>
                        <button onClick={() => setRejectingId(r.request_id)} className="text-sm rounded-lg border border-slate-300 text-slate-600 px-3 py-1.5">
                          Reprovar
                        </button>
                      </div>
                    )
                  ) : (
                    <span className="text-[11px] text-slate-400">Fora da sua alçada</span>
                  )
                }
              />
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-sm text-slate-400">Nenhuma solicitação pendente.</p>}
      </div>
    </div>
  )
}
