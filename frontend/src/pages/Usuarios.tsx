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
  view_regional_id: string | null
  edit_areas: { area_id: string; area_name: string }[]
}

interface Regional { id: string; name: string }
interface AreaRegional { area_id: string; regional_id: string; area_name: string }

const PERFIS = [
  { value: 'administrador', label: 'Administrador' },
  { value: 'gestor', label: 'Gestor' },
  { value: 'usuario', label: 'Usuário' },
] as const

export default function Usuarios() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<UserRow[]>([])
  const [regionais, setRegionais] = useState<Regional[]>([])
  const [areaRegionals, setAreaRegionals] = useState<AreaRegional[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data, error }, { data: r }, { data: ar }] = await Promise.all([
      supabase.from('v_user_details').select('*').order('email'),
      supabase.from('regionals').select('id, name').order('name'),
      supabase.from('area_regionals').select('area_id, regional_id, areas(name)').eq('active', true),
    ])
    if (error) setErrorMsg(error.message)
    else setRows((data ?? []) as UserRow[])
    setRegionais((r ?? []) as Regional[])
    setAreaRegionals(((ar ?? []) as any[]).map((row) => ({ area_id: row.area_id, regional_id: row.regional_id, area_name: row.areas?.name ?? '?' })))
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

      <p className="text-xs text-slate-400">
        Criação de novas contas é feita pelo Administrador aqui mesmo (por segurança, a chave necessária
        fica só no servidor, nunca no navegador). Perfil Usuário sempre vê a Regional inteira — a edição
        é restrita à lista de Áreas escolhida abaixo.
      </p>

      {showNewForm && (
        <NovoUsuarioForm
          regionais={regionais}
          areaRegionals={areaRegionals}
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
              <th className="text-left font-medium px-4 py-2.5">Vê</th>
              <th className="text-left font-medium px-4 py-2.5">Edita</th>
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
                  areaRegionals={areaRegionals}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); load() }}
                />
              ) : (
                <tr key={r.user_id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 text-slate-700">{r.employee_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.email}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.roles.join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.escopos.join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {r.edit_areas.length > 0 ? r.edit_areas.map((a) => a.area_name).join(', ') : '—'}
                  </td>
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

function EditAreasCheckboxes({
  regionalId, areaRegionals, selected, onChange,
}: {
  regionalId: string
  areaRegionals: AreaRegional[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const options = areaRegionals.filter((ar) => ar.regional_id === regionalId)
  if (options.length === 0) {
    return <p className="text-xs text-slate-400">Nenhuma Área cadastrada nessa Regional ainda.</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const checked = selected.includes(opt.area_id)
        return (
          <label key={opt.area_id} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer ${checked ? 'bg-ambar-accent text-white border-ambar-accent' : 'border-slate-300 text-slate-600'}`}>
            <input
              type="checkbox" className="hidden" checked={checked}
              onChange={() => onChange(checked ? selected.filter((id) => id !== opt.area_id) : [...selected, opt.area_id])}
            />
            {opt.area_name}
          </label>
        )
      })}
    </div>
  )
}

function EditRow({
  row, regionais, areaRegionals, onCancel, onSaved,
}: {
  row: UserRow
  regionais: Regional[]
  areaRegionals: AreaRegional[]
  onCancel: () => void
  onSaved: () => void
}) {
  const [nome, setNome] = useState(row.employee_name ?? '')
  const [perfil, setPerfil] = useState<(typeof PERFIS)[number]['value']>(
    (row.roles[0] as (typeof PERFIS)[number]['value']) ?? 'usuario'
  )
  const [regionalId, setRegionalId] = useState(row.view_regional_id ?? '')
  const [editAreaIds, setEditAreaIds] = useState<string[]>(row.edit_areas.map((a) => a.area_id))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSubmitting(true)
    setError(null)

    const { error: rpcError } = await supabase.rpc('admin_update_user', {
      p_user_id: row.user_id,
      p_nome: nome.trim() || null,
      p_perfil: perfil,
      p_regional_id: regionalId || null,
      p_area_id: null,
      p_edit_area_ids: perfil === 'usuario' ? editAreaIds : null,
    })

    setSubmitting(false)
    if (rpcError) { setError(rpcError.message); return }
    onSaved()
  }

  return (
    <tr className="border-t border-slate-100 bg-slate-50">
      <td className="px-4 py-3" colSpan={7}>
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-slate-700 mb-3">Editando {row.email}</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 uppercase mb-1">Nome</label>
              <input
                value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome"
                className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 w-full"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 uppercase mb-1">Perfil</label>
              <select
                value={perfil} onChange={(e) => setPerfil(e.target.value as typeof perfil)}
                className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 w-full"
              >
                {PERFIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 uppercase mb-1">
                {perfil === 'administrador' ? 'Escopo' : 'Regional (visualização)'}
              </label>
              <select
                value={regionalId}
                onChange={(e) => { setRegionalId(e.target.value); setEditAreaIds([]) }}
                className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 w-full"
              >
                <option value="">{perfil === 'administrador' ? 'Global' : 'Selecione a Regional'}</option>
                {regionais.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>

          {perfil === 'usuario' && regionalId && (
            <div className="mt-3">
              <label className="block text-[11px] text-slate-400 uppercase mb-1.5">
                Áreas que pode editar (lançar/solicitar resultado)
              </label>
              <EditAreasCheckboxes regionalId={regionalId} areaRegionals={areaRegionals} selected={editAreaIds} onChange={setEditAreaIds} />
            </div>
          )}

          {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} disabled={submitting} className="text-sm rounded-lg bg-ambar-accent text-white font-medium px-4 py-1.5 disabled:opacity-60">
              Salvar
            </button>
            <button onClick={onCancel} className="text-sm text-slate-500 px-2">Cancelar</button>
          </div>
        </div>
      </td>
    </tr>
  )
}

function NovoUsuarioForm({
  regionais, areaRegionals, onDone,
}: {
  regionais: Regional[]
  areaRegionals: AreaRegional[]
  onDone: () => void
}) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [cargo, setCargo] = useState('')
  const [perfil, setPerfil] = useState<(typeof PERFIS)[number]['value']>('usuario')
  const [regionalId, setRegionalId] = useState('')
  const [editAreaIds, setEditAreaIds] = useState<string[]>([])
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
    if (perfil === 'usuario' && !regionalId) {
      setError('Usuário precisa de uma Regional de visualização.')
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
        areaId: null,
        editAreaIds: perfil === 'usuario' ? editAreaIds : null,
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
      <div className="grid grid-cols-2 gap-3">
        <select value={perfil} onChange={(e) => { setPerfil(e.target.value as typeof perfil); setEditAreaIds([]) }} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          {PERFIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select
          value={regionalId}
          onChange={(e) => { setRegionalId(e.target.value); setEditAreaIds([]) }}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">{perfil === 'administrador' ? 'Global' : 'Selecione a Regional'}</option>
          {regionais.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {perfil === 'usuario' && regionalId && (
        <div>
          <p className="text-[11px] text-slate-400 uppercase mb-1.5">Áreas que pode editar (lançar/solicitar resultado)</p>
          <EditAreasCheckboxes regionalId={regionalId} areaRegionals={areaRegionals} selected={editAreaIds} onChange={setEditAreaIds} />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="text-sm rounded-lg bg-ambar-accent text-white font-medium px-4 py-2 hover:bg-ambar-dark disabled:opacity-60">
        {submitting ? 'Criando…' : 'Criar usuário'}
      </button>
    </form>
  )
}
