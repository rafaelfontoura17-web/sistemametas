import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const { session, loading, inactiveError, signIn } = useAuth()
  const [mode, setMode] = useState<'login' | 'forgot' | 'forgot-sent'>('login')

  if (!loading && session) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden md:flex md:w-2/5 bg-ambar-dark flex-col justify-between p-10">
        <div>
          <div className="bg-white rounded-xl px-4 py-3 inline-block">
            <img src="/logo-ambar.jpg" alt="Âmbar Energia" className="w-40" />
          </div>
          <p className="text-white font-bold text-lg mt-6">Painel de Metas</p>
          <p className="text-white/50 text-sm">Gestão executiva de performance</p>
        </div>
        <p className="text-white/30 text-xs">© {new Date().getFullYear()} Âmbar Energia</p>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden text-center">
            <img src="/logo-ambar.jpg" alt="Âmbar Energia" className="w-32 mx-auto" />
          </div>

          {mode === 'login' && <LoginForm inactiveError={inactiveError} signIn={signIn} onForgot={() => setMode('forgot')} />}
          {mode === 'forgot' && <ForgotPasswordForm onSent={() => setMode('forgot-sent')} onBack={() => setMode('login')} />}
          {mode === 'forgot-sent' && <ForgotPasswordSent onBack={() => setMode('login')} />}
        </div>
      </div>
    </div>
  )
}

function LoginForm({
  inactiveError, signIn, onForgot,
}: {
  inactiveError: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  onForgot: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signInError } = await signIn(email, password)
    setSubmitting(false)
    if (signInError) setError('E-mail ou senha inválidos.')
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-800">Entrar</h1>
        <p className="text-sm text-slate-500 mt-0.5">Acesse o Painel de Metas com sua conta.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email">E-mail</label>
          <input
            id="email" type="email" required autoFocus autoComplete="email" disabled={submitting}
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ambar-accent focus:border-transparent disabled:bg-slate-50"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="password">Senha</label>
            <button type="button" onClick={onForgot} className="text-xs text-ambar-accent hover:underline">
              Esqueci minha senha
            </button>
          </div>
          <div className="relative">
            <input
              id="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" disabled={submitting}
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-ambar-accent focus:border-transparent disabled:bg-slate-50"
            />
            <button
              type="button" onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        {inactiveError && (
          <p className="text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-3 py-2" role="alert">
            {inactiveError}
          </p>
        )}
        {error && !inactiveError && (
          <p className="text-sm text-red-600" role="alert">{error}</p>
        )}

        <button
          type="submit" disabled={submitting}
          className="w-full rounded-lg bg-ambar-accent text-white text-sm font-medium py-2.5 hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </>
  )
}

function ForgotPasswordForm({ onSent, onBack }: { onSent: () => void; onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    setSubmitting(false)
    if (resetError) { setError(resetError.message); return }
    onSent()
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-800">Redefinir senha</h1>
        <p className="text-sm text-slate-500 mt-0.5">Enviamos um link pro seu e-mail pra você criar uma nova senha.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="forgot-email">E-mail</label>
          <input
            id="forgot-email" type="email" required autoFocus disabled={submitting}
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ambar-accent focus:border-transparent disabled:bg-slate-50"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit" disabled={submitting}
          className="w-full rounded-lg bg-ambar-accent text-white text-sm font-medium py-2.5 hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? 'Enviando…' : 'Enviar link'}
        </button>
        <button type="button" onClick={onBack} className="w-full text-sm text-slate-500 hover:text-slate-800 py-1">
          Voltar para o login
        </button>
      </form>
    </>
  )
}

function ForgotPasswordSent({ onBack }: { onBack: () => void }) {
  return (
    <div className="text-center space-y-4">
      <h1 className="text-xl font-semibold text-slate-800">Verifique seu e-mail</h1>
      <p className="text-sm text-slate-500">
        Se esse e-mail estiver cadastrado, você vai receber um link pra criar uma nova senha em instantes.
      </p>
      <button onClick={onBack} className="text-sm text-ambar-accent hover:underline">
        Voltar para o login
      </button>
    </div>
  )
}
