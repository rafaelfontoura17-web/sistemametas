import type { ReactNode } from 'react'
import { formatApprovalValue } from '../lib/goalFormat'

export interface ApprovalDetail {
  request_id: string
  request_type: 'alteracao_resultado' | 'alteracao_meta' | 'exclusao' | 'reabertura'
  status: 'pendente' | 'aprovada' | 'reprovada'
  justification: string | null
  created_at: string
  resolved_at: string | null
  requester_name: string | null
  requester_cargo: string | null
  regional_name: string | null
  area_name: string | null
  cycle_name: string | null
  indicator_name: string | null
  indicator_direction: string | null
  unidade: string | null
  items: {
    real_value?: { previous: string | null; requested: string }
    real_value_pct?: { previous: string | null; requested: string }
    weight?: { previous: string | null; requested: string }
  } | null
  last_action: 'aprovar' | 'reprovar' | null
  action_justification: string | null
  approver_name: string | null
  approver_cargo: string | null
}

const TIPO_LABEL: Record<string, string> = {
  alteracao_resultado: 'Alteração de resultado',
  alteracao_meta: 'Alteração de meta',
  exclusao: 'Exclusão de meta',
  reabertura: 'Reabertura de Área',
}

const STATUS_BADGE: Record<ApprovalDetail['status'], { label: string; className: string }> = {
  pendente: { label: 'Pendente', className: 'bg-blue-100 text-blue-700' },
  aprovada: { label: 'Aprovada', className: 'bg-emerald-100 text-emerald-700' },
  reprovada: { label: 'Reprovada', className: 'bg-red-100 text-red-700' },
}

function pessoa(nome: string | null, cargo: string | null) {
  if (!nome) return '—'
  return cargo ? `${nome} — ${cargo}` : nome
}

export default function ApprovalCard({
  req, showRequester = true, actions,
}: {
  req: ApprovalDetail
  showRequester?: boolean
  actions?: ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
            {TIPO_LABEL[req.request_type] ?? req.request_type}
          </p>
          <RequestBody req={req} />
          {showRequester && (
            <p className="text-xs text-slate-400 mt-2">
              Solicitado por {pessoa(req.requester_name, req.requester_cargo)} em{' '}
              {new Date(req.created_at).toLocaleString('pt-BR')}
            </p>
          )}
          {req.justification && (
            <p className="text-xs text-slate-500 mt-1">"{req.justification}"</p>
          )}
        </div>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_BADGE[req.status].className}`}>
          {STATUS_BADGE[req.status].label}
        </span>
      </div>

      {req.status === 'aprovada' && req.approver_name && (
        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1.5 mt-3">
          Aprovado por {pessoa(req.approver_name, req.approver_cargo)}
        </p>
      )}
      {req.status === 'reprovada' && (
        <div className="text-xs text-red-700 bg-red-50 rounded-lg px-2.5 py-1.5 mt-3">
          <p>Reprovado por {pessoa(req.approver_name, req.approver_cargo)}</p>
          {req.action_justification && <p className="mt-0.5">Motivo: "{req.action_justification}"</p>}
        </div>
      )}

      {actions && <div className="mt-3 pt-3 border-t border-slate-100">{actions}</div>}
    </div>
  )
}

function RequestBody({ req }: { req: ApprovalDetail }) {
  const local = [req.area_name, req.regional_name].filter(Boolean).join(' — ')

  if (req.request_type === 'reabertura') {
    return (
      <>
        <p className="text-sm font-semibold text-slate-800 mt-0.5">{local}</p>
        {req.cycle_name && <p className="text-xs text-slate-500">Ciclo: {req.cycle_name}</p>}
      </>
    )
  }

  if (req.request_type === 'alteracao_meta') {
    const w = req.items?.weight
    return (
      <>
        <p className="text-sm font-semibold text-slate-800 mt-0.5">{req.indicator_name}</p>
        <p className="text-xs text-slate-500">{local}</p>
        {w && (
          <p className="text-sm text-slate-700 mt-1">
            Peso: <span className="text-slate-400">{w.previous ?? '—'}%</span> → <span className="font-medium">{w.requested}%</span>
          </p>
        )}
      </>
    )
  }

  if (req.request_type === 'exclusao') {
    return (
      <>
        <p className="text-sm font-semibold text-slate-800 mt-0.5">{req.indicator_name}</p>
        <p className="text-xs text-slate-500">{local}</p>
      </>
    )
  }

  // alteracao_resultado
  const direction = req.indicator_direction ?? ''
  const before = formatApprovalValue(direction, req.unidade, req.items?.real_value?.previous, req.items?.real_value_pct?.previous)
  const after = formatApprovalValue(direction, req.unidade, req.items?.real_value?.requested, req.items?.real_value_pct?.requested)
  return (
    <>
      <p className="text-sm font-semibold text-slate-800 mt-0.5">{req.indicator_name}</p>
      <p className="text-xs text-slate-500">{local}</p>
      <p className="text-sm text-slate-700 mt-1">
        Real: <span className="text-slate-400">{before}</span> → <span className="font-medium">{after}</span>
      </p>
    </>
  )
}
