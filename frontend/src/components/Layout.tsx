import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/metas', label: 'Metas' },
  { to: '/solicitacoes', label: 'Solicitações' },
  { to: '/aprovacoes', label: 'Aprovações' },
  { to: '/notificacoes', label: 'Notificações' },
]

const NAV_ITEMS_ADMIN = [
  { to: '/usuarios', label: 'Usuários' },
  { to: '/areas-regionais', label: 'Áreas e Regionais' },
  { to: '/indicadores', label: 'Indicadores' },
  { to: '/relatorios', label: 'Relatórios' },
  { to: '/auditoria', label: 'Auditoria' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { appUser, roles, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!appUser) return
    let cancelled = false

    async function loadUnread() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('read', false)
      if (!cancelled) setUnread(count ?? 0)
    }
    loadUnread()

    // Atualiza quando uma notificação nova chega em tempo real, sem
    // precisar recarregar a página.
    const channel = supabase
      .channel('notifications-unread')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        () => loadUnread()
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [appUser])

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 bg-ambar-dark text-white flex flex-col">
        <div className="px-5 py-6 border-b border-white/10">
          <p className="text-[11px] font-semibold tracking-widest text-emerald-300 uppercase">
            Âmbar Energia
          </p>
          <p className="text-sm font-medium mt-0.5">Gestão de Metas</p>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-white/10 font-medium' : 'text-white/70 hover:bg-white/5'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <p className="text-[11px] text-white/40 uppercase tracking-wide px-3 pt-4 pb-1">Administração</p>
              {NAV_ITEMS_ADMIN.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive ? 'bg-white/10 font-medium' : 'text-white/70 hover:bg-white/5'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6">
          <div />
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/notificacoes')}
              className="relative text-slate-500 hover:text-slate-700"
              title="Notificações"
              aria-label={`${unread} notificações não lidas`}
            >
              🔔
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] leading-none rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
                  {unread}
                </span>
              )}
            </button>
            <div className="text-right">
              <p className="text-sm font-medium text-slate-800">{appUser?.email}</p>
              <p className="text-xs text-slate-400">{roles.join(', ') || 'sem perfil'}</p>
            </div>
            <button
              onClick={() => signOut()}
              className="text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5"
            >
              Sair
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
