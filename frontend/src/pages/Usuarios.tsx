import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'

interface UserRow {
  user_id: string
  employee_id: string | null
  email: string
  status: 'ativo' | 'inativo'
  employee_name: string | null
  cargo: string | null
  roles: string[]
  escopos: string[]
}

interface Regional { id: string; name: string }
interface Area { id: string; name: string }

const PERFIS = [
  { value: 'administrador', label: 'Administrador' },
  { value: 'gestor', label: 'Gestor' },
  { value: 'usuario', label: 'Usuário' },
] as const

export default function Usuarios() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<UserRow[]>([])
  const [regionais, setRegionais] = useState<Regional[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data, error }, { data: r }, { data: a }] = await Promise.all([
      supabase.from('v_user_details').select('*').order('email'),
      supabase.from('regionals').select('id, name').order('name'),
      supabase.from('areas').select('id, name').order('name'),
    ])
    if (error) setErrorMsg(error.message)
    else setRows((data ?? []) as UserRow[])
    setRegionais((r ?? []) as Regional[])
    setAreas((a ?? []) as Area[])
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
      <PageHeader
        title="Usuários"
        actions={
          isAdmin && (
            <button
              onClick={() => setShowNewForm((v) => !v)}
              className="text-sm rounded-lg bg-ambar-accent text-white font-medium px-3 py-1.5 hover:bg-ambar-dark"
            >
              Novo usuário
            </button>
          )
        }
      />

      {showNewForm && (
        <NovoUsuarioForm
          regionais={regionais}
          areas={areas}
          onDone={() => { setShowNewForm(false); load() }}
        />
      )}

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
            {rows.map((r) =>
              editingId === r.user_id ? (
                <EditRow
                  key={r.user_id}
                  row={r}
                  regionais={regionais}
                  areas={areas}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); load() }}
                />
              ) : (
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
                    <td className="px-4 py-2.5 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => setEditingId(r.user_id)}
                        className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleStatus(r)} disabled={busyId === r.user_id}
                        className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1 disabled:opacity-60"
                      >
                        {r.status === 'ativo' ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>
                  )}
                </tr>
              )
            )}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nenhum usuário encontrado.</p>}
      </div>
    </div>
  )
}

function EditRow({
  row, regionais, areas, onCancel, onSaved,
}: {
  row: UserRow
  regionais: Regional[]
  areas: Area[]
  onCancel: () => void
  onSaved: () => void
}) {
  const [nome, setNome] = useState(row.employee_name ?? '')
  const [perfil, setPerfil] = useState<(typeof PERFIS)[number]['value']>(
    (row.roles[0] as (typeof PERFIS)[number]['value']) ?? 'usuario'
  )
  const [regionalId, setRegionalId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSubmitting(true)
    setError(null)

    if (nome.trim() && nome.trim() !== (row.employee_name ?? '')) {
      if (row.employee_id) {
        const { error: nameErr } = await supabase.from('employees').update({ name: nome.trim() }).eq('id', row.employee_id)
        if (nameErr) { setError(nameErr.message); setSubmitting(false); return }
      } else {
        // Usuário ainda não tinha nenhum employee vinculado (ex.: admin
        // criado direto no painel do Supabase) — cria um agora.
        const { data: newEmployee, error: createErr } = await supabase
          .from('employees').insert({ name: nome.trim(), email: row.email }).select('id').single()
        if (createErr) { setError(createErr.message); setSubmitting(false); return }
        const { error: linkErr } = await supabase.from('users').update({ employee_id: newEmployee.id }).eq('id', row.user_id)
        if (linkErr) { setError(linkErr.message); setSubmitting(false); return }
      }
    }

    const { data: role, error: roleErr } = await supabase.from('roles').select('id').eq('code', perfil).single()
    if (roleErr || !role) { setError('Perfil inválido.'); setSubmitting(false); return }

    const { error: delRoleErr } = await supabase.from('user_roles').delete().eq('user_id', row.user_id)
    if (delRoleErr) { setError(delRoleErr.message); setSubmitting(false); return }
    const { error: insRoleErr } = await supabase.from('user_roles').insert({ user_id: row.user_id, role_id: role.id })
    if (insRoleErr) { setError(insRoleErr.message); setSubmitting(false); return }

    const { error: delAccessErr } = await supabase.from('user_access').delete().eq('user_id', row.user_id)
    if (delAccessErr) { setError(delAccessErr.message); setSubmitting(false); return }

    // Administrador sem regional selecionada = acesso Global, não precisa de linha em user_access.
    if (!(perfil === 'administrador' && !regionalId)) {
      const { error: insAccessErr } = await supabase.from('user_access').insert({
        user_id: row.user_id,
        regional_id: regionalId || null,
        area_id: areaId || null,
      })
      if (insAccessErr) { setError(insAccessErr.message); setSubmitting(false); return }
    }

    setSubmitting(false)
    onSaved()
  }

  return (
    <tr className="border-t border-slate-100 bg-slate-50">
      <td className="px-4 py-2.5">
        <input
          value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome"
          className="text-sm border border-slate-300 rounded-lg px-2 py-1 w-full"
        />
      </td>
      <td className="px-4 py-2.5 text-slate-500">{row.email}</td>
      <td className="px-4 py-2.5">
        <select value={perfil} onChange={(e) => setPerfil(e.target.value as typeof perfil)} className="text-sm border border-slate-300 rounded-lg px-2 py-1">
          {PERFIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex gap-1.5">
          <select value={regionalId} onChange={(e) => { setRegionalId(e.target.value); setAreaId('') }} className="text-sm border border-slate-300 rounded-lg px-2 py-1">
            <option value="">{perfil === 'administrador' ? 'Global' : 'Selecione a Regional'}</option>
            {regionais.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={!regionalId} className="text-sm border border-slate-300 rounded-lg px-2 py-1 disabled:opacity-50">
            <option value="">Regional inteira</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </td>
      <td className="px-4 py-2.5 text-slate-400 text-xs">{row.status}</td>
      <td className="px-4 py-2.5 text-right space-x-2 whitespace-nowrap">
        <button onClick={handleSave} disabled={submitting} className="text-xs rounded-lg bg-ambar-accent text-white px-2.5 py-1 disabled:opacity-60">
          Salvar
        </button>
        <button onClick={onCancel} className="text-xs text-slate-500 px-2">Cancelar</button>
      </td>
    </tr>
  )
}

function NovoUsuarioForm({
  regionais, areas, onDone,
}: {
  regionais: Regional[]
  areas: Area[]
  onDone: () => void
}) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [cargo, setCargo] = useState('')
  const [perfil, setPerfil] = useState<(typeof PERFIS)[number]['value']>('usuario')
  const [regionalId, setRegionalId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!nome.trim() || !email.trim() || !senha) {
      setError('Nome, e-mail e senha são obrigatórios.')
      return
    }
    if (senha.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }

    setSubmitting(true)
    const { data, error: fnError } = await supabase.functions.invoke('create-user', {
      body: {
        nome: nome.trim(),
        email: email.trim(),
        senha,
        cargo: cargo.trim() || null,
        perfil,
        regionalId: regionalId || null,
        areaId: areaId || null,
      },
    })
    setSubmitting(false)

    if (fnError || data?.error) {
      setError(data?.error ?? fnError?.message ?? 'Erro desconhecido ao criar usuário.')
      return
    }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <h2 className="text-sm font-medium text-slate-700">Novo usuário</h2>
      <div className="grid grid-cols-2 gap-3">
        <input placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <input type="password" placeholder="Senha temporária (mín. 6 caracteres)" value={senha} onChange={(e) => setSenha(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <input placeholder="Cargo (opcional)" value={cargo} onChange={(e) => setCargo(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <select value={perfil} onChange={(e) => setPerfil(e.target.value as typeof perfil)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          {PERFIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={regionalId} onChange={(e) => { setRegionalId(e.target.value); setAreaId('') }} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">{perfil === 'administrador' ? 'Global' : 'Selecione a Regional'}</option>
          {regionais.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={!regionalId} className="border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
          <option value="">Regional inteira</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="text-sm rounded-lg bg-ambar-accent text-white font-medium px-4 py-2 hover:bg-ambar-dark disabled:opacity-60">
        {submitting ? 'Criando…' : 'Criar usuário'}
      </button>
    </form>
  )
}
