import { useEffect, useState, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

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
  result_status: string | null
}

interface GoalRange {
  attainment_percentage: number
  target_value: number
  target_month: number | null
}

const MESES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  critico: { label: 'Crítico', className: 'bg-red-100 text-red-700' },
  parcial: { label: 'Parcial', className: 'bg-amber-100 text-amber-700' },
  atingido: { label: 'Atingido', className: 'bg-emerald-100 text-emerald-700' },
}

export default function GoalDetail() {
  const { goalId } = useParams()
  const [goal, setGoal] = useState<GoalDetail | null>(null)
  const [ranges, setRanges] = useState<GoalRange[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: g, error: gErr }, { data: r, error: rErr }] = await Promise.all([
      supabase.from('v_goal_details').select('*').eq('goal_id', goalId).maybeSingle(),
      supabase.from('goal_ranges').select('attainment_percentage, target_value, target_month').eq('goal_id', goalId).order('attainment_percentage'),
    ])
    if (gErr || rErr) setErrorMsg((gErr ?? rErr)?.message ?? 'Erro desconhecido')
    setGoal((g as GoalDetail) ?? null)
    setRanges((r as GoalRange[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">Não foi possível carregar a meta: {errorMsg}</p>
  if (!goal) return <p className="text-sm text-slate-400">Meta não encontrada (ou fora do seu escopo).</p>

  const badge = goal.result_status ? STATUS_LABEL[goal.result_status] : null

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link to="/metas" className="text-xs text-slate-400 hover:text-slate-600">← Voltar para Metas</Link>
        <div className="flex items-start justify-between gap-3 mt-1">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{goal.indicator_name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {goal.area_name} · {goal.regional_name} · peso {goal.weight.toFixed(0)}%
            </p>
          </div>
          {badge && (
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${badge.className}`}>
              {badge.label}
            </span>
          )}
        </div>
        {goal.indicator_description && (
          <p className="text-sm text-slate-500 mt-3">{goal.indicator_description}</p>
        )}
      </div>

      {goal.result_id ? (
        <ResultadoLancado goal={goal} />
      ) : (
        <ApuracaoForm goal={goal} onSaved={load} />
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

function formatCriterio(direction: string, unidade: string | null, band: GoalRange) {
  const isPct = unidade === '%'
  const val = isPct ? `${(band.target_value * 100).toFixed(0)}%` : `${band.target_value} ${unidade ?? ''}`
  switch (direction) {
    case 'maior_melhor':
      return `≥ ${val}`
    case 'menor_melhor':
      return `≤ ${val}`
    case 'binario':
      return 'Concluído'
    case 'cronologico':
      return `até ${MESES[band.target_value]}`
    case 'percentual_por_mes':
      return `${(band.target_value * 100).toFixed(0)}% até ${MESES[band.target_month ?? 0]}`
    default:
      return val
  }
}

function ResultadoLancado({ goal }: { goal: GoalDetail }) {
  const [showForm, setShowForm] = useState(false)
  const [novoNumero, setNovoNumero] = useState('')
  const [novoPercentual, setNovoPercentual] = useState('')
  const [novoMes, setNovoMes] = useState('')
  const [novoBinario, setNovoBinario] = useState<'sim' | 'nao' | ''>('')
  const [justificativa, setJustificativa] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!justificativa.trim()) { setError('Justificativa é obrigatória.'); return }

    const items: { field_name: string; previous_value: string; requested_value: string }[] = []
    if (goal.direction === 'binario') {
      if (!novoBinario) { setError('Selecione Sim ou Não.'); return }
      items.push({ field_name: 'real_value', previous_value: String(goal.real_value), requested_value: novoBinario === 'sim' ? '1' : '0' })
    } else if (goal.direction === 'cronologico') {
      if (!novoMes) { setError('Selecione o mês.'); return }
      items.push({ field_name: 'real_value', previous_value: String(goal.real_value), requested_value: novoMes })
    } else if (goal.direction === 'percentual_por_mes') {
      if (!novoPercentual || !novoMes) { setError('Preencha percentual e mês.'); return }
      items.push({ field_name: 'real_value', previous_value: String(goal.real_value), requested_value: novoMes })
      items.push({ field_name: 'real_value_pct', previous_value: String(goal.real_value_pct), requested_value: String(Number(novoPercentual) / 100) })
    } else {
      if (!novoNumero) { setError('Preencha o novo valor.'); return }
      const novoValor = goal.unidade === '%' ? Number(novoNumero) / 100 : Number(novoNumero)
      items.push({ field_name: 'real_value', previous_value: String(goal.real_value), requested_value: String(novoValor) })
    }

    setSubmitting(true)
    const { error: rpcError } = await supabase.rpc('create_approval_request', {
      p_request_type: 'alteracao_resultado',
      p_goal_id: goal.goal_id,
      p_regional_id: goal.regional_id,
      p_area_id: goal.area_id,
      p_cycle_id: null,
      p_justification: justificativa,
      p_items: items,
    })
    setSubmitting(false)
    if (rpcError) { setError(rpcError.message); return }
    setDone(true)
    setShowForm(false)
  }

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

      {done ? (
        <p className="text-sm text-emerald-700 mt-4">
          Solicitação enviada — acompanhe em Solicitações.
        </p>
      ) : showForm ? (
        <form onSubmit={handleSubmit} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
          {goal.direction === 'binario' && (
            <div className="flex gap-3">
              {(['sim', 'nao'] as const).map((opt) => (
                <button type="button" key={opt} onClick={() => setNovoBinario(opt)}
                  className={`px-4 py-2 rounded-lg text-sm border ${novoBinario === opt ? 'bg-ambar-accent text-white border-ambar-accent' : 'border-slate-300 text-slate-600'}`}>
                  {opt === 'sim' ? 'Concluído' : 'Não concluído'}
                </button>
              ))}
            </div>
          )}
          {goal.direction === 'cronologico' && (
            <select value={novoMes} onChange={(e) => setNovoMes(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Novo mês de entrega</option>
              {MESES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          )}
          {goal.direction === 'percentual_por_mes' && (
            <div className="flex gap-3">
              <input type="number" step="0.01" placeholder="% executado" value={novoPercentual} onChange={(e) => setNovoPercentual(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-40" />
              <select value={novoMes} onChange={(e) => setNovoMes(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Mês</option>
                {MESES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          )}
          {(goal.direction === 'maior_melhor' || goal.direction === 'menor_melhor') && (
            <input type="number" step="0.01" placeholder="Novo valor realizado" value={novoNumero} onChange={(e) => setNovoNumero(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-56" />
          )}
          <textarea
            placeholder="Justificativa (obrigatória)"
            value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full" rows={2}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={submitting} className="rounded-lg bg-ambar-accent text-white text-sm font-medium px-4 py-2 hover:bg-ambar-dark disabled:opacity-60">
              {submitting ? 'Enviando…' : 'Enviar solicitação'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500 px-3">Cancelar</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowForm(true)} className="text-sm text-ambar-accent hover:underline mt-4">
          Solicitar alteração deste resultado
        </button>
      )}
    </div>
  )
}

function formatReal(goal: GoalDetail) {
  if (goal.direction === 'binario') return goal.real_value === 1 ? 'Sim' : 'Não'
  if (goal.direction === 'cronologico') return MESES[goal.real_value ?? 0]
  if (goal.direction === 'percentual_por_mes') {
    return `${((goal.real_value_pct ?? 0) * 100).toFixed(0)}% em ${MESES[goal.real_value ?? 0]}`
  }
  if (goal.unidade === '%') return `${((goal.real_value ?? 0) * 100).toFixed(1)}%`
  return `${goal.real_value} ${goal.unidade ?? ''}`
}

function ApuracaoForm({ goal, onSaved }: { goal: GoalDetail; onSaved: () => void }) {
  const [numero, setNumero] = useState('')
  const [percentual, setPercentual] = useState('')
  const [mes, setMes] = useState('')
  const [binario, setBinario] = useState<'sim' | 'nao' | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

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
    const { error: insertError } = await supabase
      .from('goal_results')
      .insert({ goal_id: goal.goal_id, real_value, real_value_pct, realization_month: new Date().toISOString().slice(0, 10) })
    setSubmitting(false)

    if (insertError) {
      setError(
        insertError.message.includes('row-level security') || insertError.code === '42501'
          ? 'Você não tem permissão para lançar o resultado desta meta.'
          : insertError.message
      )
      return
    }
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <h2 className="text-sm font-medium text-slate-700">Apuração</h2>

      {goal.direction === 'binario' && (
        <div className="flex gap-3">
          {(['sim', 'nao'] as const).map((opt) => (
            <button
              type="button"
              key={opt}
              onClick={() => setBinario(opt)}
              className={`px-4 py-2 rounded-lg text-sm border ${
                binario === opt ? 'bg-ambar-accent text-white border-ambar-accent' : 'border-slate-300 text-slate-600'
              }`}
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
          <input
            type="number" step="0.01" placeholder="% executado"
            value={percentual} onChange={(e) => setPercentual(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-40"
          />
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit" disabled={submitting}
        className="rounded-lg bg-ambar-accent text-white text-sm font-medium px-4 py-2 hover:bg-ambar-dark disabled:opacity-60"
      >
        {submitting ? 'Salvando…' : 'Lançar resultado'}
      </button>
    </form>
  )
}
