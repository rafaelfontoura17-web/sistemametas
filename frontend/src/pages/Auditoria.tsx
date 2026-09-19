import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

interface AuditLog {
  id: string
  action: string
  entity: string
  entity_id: string | null
  created_at: string
  new_data: unknown
}

export default function Auditoria() {
  const [rows, setRows] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('audit_logs')
      .select('id, action, entity, entity_id, created_at, new_data')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) setErrorMsg(error.message)
        else setRows((data ?? []) as AuditLog[])
        setLoading(false)
      })
  }, [])

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) {
    return (
      <p className="text-sm text-red-600">
        {errorMsg.includes('permission') || errorMsg.includes('row-level security')
          ? 'Só o Administrador tem acesso à Auditoria.'
          : errorMsg}
      </p>
    )
  }

  const entidades = Array.from(new Set(rows.map((r) => r.entity))).sort()
  const filtered = entityFilter ? rows.filter((r) => r.entity === entityFilter) : rows

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Auditoria</h1>
        <p className="text-sm text-slate-500 mt-0.5">Últimos {rows.length} eventos registrados.</p>
      </div>

      <select
        value={entityFilter ?? ''}
        onChange={(e) => setEntityFilter(e.target.value || null)}
        className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
      >
        <option value="">Todas as entidades</option>
        {entidades.map((e) => <option key={e} value={e}>{e}</option>)}
      </select>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Quando</th>
              <th className="text-left font-medium px-4 py-2.5">Ação</th>
              <th className="text-left font-medium px-4 py-2.5">Entidade</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                <td className="px-4 py-2.5 text-slate-700">{r.action}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.entity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nenhum evento encontrado.</p>}
      </div>
    </div>
  )
}
