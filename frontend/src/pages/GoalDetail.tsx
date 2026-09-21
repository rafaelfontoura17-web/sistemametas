import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { STATUS_STYLES, type GoalStatus } from '../lib/statusColors'
import { MESES, formatReal, formatCriterio, type GoalRange } from '../lib/goalFormat'

interface GoalDetail {
  goal_id: string
  cycle_id: string
  weight: number
  area_id: string
  area_name: string
  regional_id: string
  regional_name: string
  indicator_name: string
  indicator_description: string | null
  direction: string
  unidade: string | null
  result_id: string | null
  real_value: number | null
  real_value_pct: number | null
  attainment_percentage: number | null
  weighted_result: number | null
  result_status: GoalStatus | null
}

interface PendingRequest {
  request_id: string
  created_at: string
  justification: string | null
}

export default function GoalDetail() {
  const { goalId } = useParams()
  const [goal, setGoal] = useState<GoalDetail | null>(null)
  const [ranges, setRanges] = useState<GoalRange[]>([])
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: g, error: gErr }, { data: r, error: rErr }, { data: p }] = await Promise.all([
      supabase.from('v_goal_details').select('*').eq('goal_id', goalId).maybeSingle(),
      supabase.from('goal_ranges').select('attainment_percentage, target_value, target_month').eq('goal_id', goalId).order('attainment_percentage'),
      supabase.from('approval_requests').select('id, created_at, justification')
        .eq('goal_id', goalId).eq('status', 'pendente').eq('request_type', 'alteracao_resultado')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (gErr || rErr) setErrorMsg((gErr ?? rErr)?.message ?? 'Erro desconhecido')
    setGoal((g as GoalDetail) ?? null)
    setRanges((r as GoalRange[]) ?? [])
    setPending(p ? { request_id: (p as any).id, created_at: (p as any).created_at, justification: (p as any).justification } : null)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">Não foi possível carregar a meta: {errorMsg}</p>
  if (!goal) return <p className="text-sm text-slate-400">Meta não encontrada (ou fora do seu escopo).</p>

  const status: GoalStatus = goal.result_status ?? 'pendente'

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link to="/metas" className="text-xs text-slate-400 hover:text-slate-600">← Voltar para Metas e Apuração</Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{goal.indicator_name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {goal.area_name} · {goal.regional_name} · peso {goal.weight.toFixed(0)}%
            </p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${STATUS_STYLES[status].badgeClassName}`}>
            {STATUS_STYLES[status].label}
          </span>
        </div>
        {goal.indicator_description && (
          <p className="text-sm text-slate-500 mt-3">{goal.indicator_description}</p>
        )}
      </div>

      {goal.result_id ? (
        <ResultadoLancado goal={goal} pending={pending} onSaved={load} />
      ) : pending ? (
        <PendenteBanner pending={pending} />
      ) : (
        <SubmitResultForm goal={goal} isCorrection={false} onSaved={load} />
      )}

      {ranges.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700 mb-3">Faixas da meta</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400 uppercase">
              <tr>
                <th className="text-left font-medium pb-2">Faixa</th>
                <th className="text-left font-medium pb-2">Critério</th>
              </tr>
            </thead>
            <tbody>
              {ranges.map((band) => (
                <tr key={band.attainment_percentage} className="border-t border-slate-100">
                  <td className="py-1.5 font-medium text-slate-700">{band.attainment_percentage.toFixed(0)}%</td>
                  <td className="py-1.5 text-slate-600">{formatCriterio(goal.direction, goal.unidade, band)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PendenteBanner({ pending }: { pending: PendingRequest }) {
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
      <p className="text-sm font-medium text-blue-800">Lançamento enviado, aguardando aprovação</p>
      <p className="text-xs text-blue-600 mt-1">
        Solicitado em {new Date(pending.created_at).toLocaleString('pt-BR')}
        {pending.justification && ` — "${pending.justification}"`}
      </p>
      <p className="text-xs text-blue-500 mt-2">Acompanhe o andamento na tela de Solicitações.</p>
    </div>
  )
}

function ResultadoLancado({ goal, pending, onSaved }: { goal: GoalDetail; pending: PendingRequest | null; onSaved: () => void }) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-medium text-slate-700 mb-3">Resultado apurado</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-slate-400 text-xs">Real</dt>
          <dd className="text-slate-800">{formatReal(goal)}</dd>
        </div>
        <div>
          <dt className="text-slate-400 text-xs">Atingimento</dt>
          <dd className="text-slate-800 font-medium">{goal.attainment_percentage?.toFixed(0)}%</dd>
        </div>
        <div>
          <dt className="text-slate-400 text-xs">Resultado ponderado</dt>
          <dd className="text-slate-800">{goal.weighted_result?.toFixed(2)}</dd>
        </div>
      </dl>

      {pending ? (
        <p className="text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mt-4">
          Já existe uma correção enviada, aguardando aprovação.
        </p>
      ) : showForm ? (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <SubmitResultForm goal={goal} isCorrection onSaved={() => { setShowForm(false); onSaved() }} onCancel={() => setShowForm(false)} />
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="text-sm text-ambar-accent hover:underline mt-4">
          Solicitar alteração deste resultado
        </button>
      )}
    </div>
  )
}

function SubmitResultForm({
  goal, isCorrection, onSaved, onCancel,
}: {
  goal: GoalDetail
  isCorrection: boolean
  onSaved: () => void
  onCancel?: () => void
}) {
  const [numero, setNumero] = useState('')
  const [percentual, setPercentual] = useState('')
  const [mes, setMes] = useState('')
  const [binario, setBinario] = useState<'sim' | 'nao' | ''>('')
  const [justificativa, setJustificativa] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (isCorrection && !justificativa.trim()) { setError('Justificativa é obrigatória para corrigir um valor já apurado.'); return }

    let real_value: number | null = null
    let real_value_pct: number | null = null

    if (goal.direction === 'binario') {
      if (!binario) { setError('Selecione Sim ou Não.'); return }
      real_value = binario === 'sim' ? 1 : 0
    } else if (goal.direction === 'cronologico') {
      if (!mes) { setError('Selecione o mês.'); return }
      real_value = Number(mes)
    } else if (goal.direction === 'percentual_por_mes') {
      if (!percentual || !mes) { setError('Preencha o percentual e o mês — os dois são obrigatórios.'); return }
      real_value = Number(mes)
      real_value_pct = Number(percentual) / 100
    } else {
      if (!numero) { setError('Preencha o valor realizado.'); return }
      real_value = goal.unidade === '%' ? Number(numero) / 100 : Number(numero)
    }

    setSubmitting(true)
    const { error: rpcError } = await supabase.rpc('submit_goal_result', {
      p_goal_id: goal.goal_id,
      p_real_value: real_value,
      p_real_pct: real_value_pct,
      p_justification: justificativa.trim() || null,
    })
    setSubmitting(false)

    if (rpcError) { setError(rpcError.message); return }
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className={isCorrection ? 'space-y-3' : 'bg-white rounded-xl border border-slate-200 p-4 space-y-4'}>
      {!isCorrection && <h2 className="text-sm font-medium text-slate-700">Apuração</h2>}

      {goal.direction === 'binario' && (
        <div className="flex gap-3">
          {(['sim', 'nao'] as const).map((opt) => (
            <button
              type="button" key={opt} onClick={() => setBinario(opt)}
              className={`px-4 py-2 rounded-lg text-sm border ${binario === opt ? 'bg-ambar-accent text-white border-ambar-accent' : 'border-slate-300 text-slate-600'}`}
            >
              {opt === 'sim' ? 'Concluído' : 'Não concluído'}
            </button>
          ))}
        </div>
      )}

      {goal.direction === 'cronologico' && (
        <select value={mes} onChange={(e) => setMes(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Mês de entrega</option>
          {MESES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      )}

      {goal.direction === 'percentual_por_mes' && (
        <div className="flex gap-3">
          <input type="number" step="0.01" placeholder="% executado" value={percentual} onChange={(e) => setPercentual(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-40" />
          <select value={mes} onChange={(e) => setMes(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Mês em que atingiu</option>
            {MESES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
      )}

      {(goal.direction === 'maior_melhor' || goal.direction === 'menor_melhor') && (
        <input
          type="number" step="0.01"
          placeholder={goal.unidade === '%' ? 'Valor realizado (%)' : `Valor realizado (${goal.unidade ?? ''})`}
          value={numero} onChange={(e) => setNumero(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-56"
        />
      )}

      <textarea
        placeholder={isCorrection ? 'Justificativa (obrigatória)' : 'Justificativa (opcional)'}
        value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
        className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full" rows={2}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit" disabled={submitting}
          className="rounded-lg bg-ambar-accent text-white text-sm font-medium px-4 py-2 hover:bg-ambar-dark disabled:opacity-60"
        >
          {submitting ? 'Enviando…' : isCorrection ? 'Enviar correção' : 'Lançar resultado'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm text-slate-500 px-3">Cancelar</button>}
      </div>
    </form>
  )
}
