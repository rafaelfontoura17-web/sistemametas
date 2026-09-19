import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

interface AppUser {
  id: string
  email: string
  status: 'ativo' | 'inativo'
  employee_id: string | null
}

interface AuthContextValue {
  session: Session | null
  appUser: AppUser | null
  roles: string[]
  loading: boolean
  isAdmin: boolean
  isGestor: boolean
  inactiveError: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [inactiveError, setInactiveError] = useState<string | null>(null)

  async function loadAppUser(userId: string) {
    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('id, email, status, employee_id')
      .eq('id', userId)
      .maybeSingle()

    if (userError || !userRow) {
      // Sem RLS liberando a própria linha isso não deveria acontecer, mas
      // se acontecer é melhor tratar como "sem acesso" do que travar a tela.
      setAppUser(null)
      setRoles([])
      return
    }

    if (userRow.status === 'inativo') {
      setInactiveError('Seu usuário está inativo. Procure o administrador do sistema.')
      await supabase.auth.signOut()
      setAppUser(null)
      setRoles([])
      return
    }

    setAppUser(userRow as AppUser)

    const { data: roleRows } = await supabase
      .from('user_roles')
      .select('roles(code)')
      .eq('user_id', userId)
    setRoles((roleRows ?? []).map((r: any) => r.roles?.code).filter(Boolean))
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        loadAppUser(data.session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession) {
        setLoading(true)
        loadAppUser(newSession.user.id).finally(() => setLoading(false))
      } else {
        setAppUser(null)
        setRoles([])
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    setInactiveError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const value: AuthContextValue = {
    session,
    appUser,
    roles,
    loading,
    isAdmin: roles.includes('administrador'),
    isGestor: roles.includes('gestor'),
    inactiveError,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
