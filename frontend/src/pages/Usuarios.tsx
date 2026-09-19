import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

interface UserRow {
  user_id: string
  email: string
  status: 'ativo' | 'inativo'
  employee_name: string | null
  cargo: string | null
  roles: string[]
  escopos: string[]
}

export default function Usuarios() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('v_user_details').select('*').order('email')
    if (error) setErrorMsg(error.message)
    else setRows((data ?? []) as UserRow[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleStatus(row: UserRow) {
    setBusyId(row.user_id)
    const novoStatus = row.status === 'ativo' ? 'inativo' : 'ativo'
    const { error } = await supabase.from('users').update({ status: novoStatus }).eq('id', row.user_id)
    setBusyId(null)
    if (error) { setErrorMsg(error.message); return }
    load()
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>
  if (errorMsg) return <p className="text-sm text-red-600">{errorMsg}</p>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Usuários</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Criação de novas contas é feita pelo Administrador via script de provisionamento
          (por segurança, a chave necessária não pode ficar no navegador). Aqui dá pra
          ativar/desativar acesso e ver perfil e escopo de cada um.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Nome</th>
              <th className="text-left font-medium px-4 py-2.5">E-mail</th>
              <th className="text-left font-medium px-4 py-2.5">Perfil</th>
              <th className="text-left font-medium px-4 py-2.5">Escopo</th>
              <th className="text-left font-medium px-4 py-2.5">Status</th>
              {isAdmin && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-700">{r.employee_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.email}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.roles.join(', ') || '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.escopos.join(', ') || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    r.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {r.status === 'ativo' ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                {isAdmin && (
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => toggleStatus(r)} disabled={busyId === r.user_id}
                      className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1 disabled:opacity-60"
                    >
                      {r.status === 'ativo' ? 'Desativar' : 'Ativar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nenhum usuário encontrado.</p>}
      </div>
    </div>
  )
}
