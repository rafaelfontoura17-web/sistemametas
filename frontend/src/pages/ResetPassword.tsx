import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) { setError('A senha precisa ter pelo menos 6 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não coincidem.'); return }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (updateError) { setError(updateError.message); return }
    setDone(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <img src="/logo-ambar.jpg" alt="Âmbar Energia" className="w-32 mb-8 mx-auto" />

        {done ? (
          <div className="text-center space-y-4">
            <h1 className="text-xl font-semibold text-slate-800">Senha atualizada</h1>
            <p className="text-sm text-slate-500">Já pode entrar com a nova senha.</p>
            <button onClick={() => navigate('/login')} className="text-sm text-ambar-accent hover:underline">
              Ir para o login
            </button>
          </div>
        ) : !ready ? (
          <p className="text-sm text-slate-400 text-center">Confirmando o link de redefinição…</p>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-800 mb-6">Criar nova senha</h1>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="password" placeholder="Nova senha" autoFocus disabled={submitting}
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ambar-accent focus:border-transparent disabled:bg-slate-50"
              />
              <input
                type="password" placeholder="Confirme a nova senha" disabled={submitting}
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ambar-accent focus:border-transparent disabled:bg-slate-50"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit" disabled={submitting}
                className="w-full rounded-lg bg-ambar-accent text-white text-sm font-medium py-2.5 hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? 'Salvando…' : 'Salvar nova senha'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
