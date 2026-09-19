import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

interface Notificacao {
  id: string
  type: string
  title: string
  message: string | null
  read: boolean
  created_at: string
}

export default function Notificacoes() {
  const { appUser } = useAuth()
  const [rows, setRows] = useState<Notificacao[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, message, read, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    setRows((data ?? []) as Notificacao[])
    setLoading(false)
  }

  useEffect(() => {
    if (appUser) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser])

  async function markRead(id: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, read: true } : r)))
    await supabase.from('notifications').update({ read: true }).eq('id', id)
  }

  async function markAllRead() {
    const unreadIds = rows.filter((r) => !r.read).map((r) => r.id)
    if (unreadIds.length === 0) return
    setRows((rs) => rs.map((r) => ({ ...r, read: true })))
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando…</p>

  const unreadCount = rows.filter((r) => !r.read).length

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Notificações</h1>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-sm text-ambar-accent hover:underline">
            Marcar todas como lidas
          </button>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((n) => (
          <button
            key={n.id}
            onClick={() => !n.read && markRead(n.id)}
            className={`w-full text-left rounded-xl border p-4 transition-colors ${
              n.read ? 'bg-white border-slate-200' : 'bg-blue-50/60 border-blue-100'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-slate-800">{n.title}</p>
              {!n.read && <span className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />}
            </div>
            {n.message && <p className="text-sm text-slate-600 mt-1">{n.message}</p>}
            <p className="text-xs text-slate-400 mt-2">{new Date(n.created_at).toLocaleString('pt-BR')}</p>
          </button>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400">Nenhuma notificação ainda.</p>}
      </div>
    </div>
  )
}
