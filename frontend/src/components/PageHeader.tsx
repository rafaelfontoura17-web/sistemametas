import type { ReactNode } from 'react'

export default function PageHeader({
  title,
  breadcrumb,
  actions,
}: {
  title: string
  breadcrumb?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <p className="text-[11px] font-semibold tracking-widest text-ambar-accent uppercase">
          Âmbar Energia · Performance 2026
        </p>
        <div className="flex items-center gap-2.5 mt-1">
          <span className="w-1 h-6 bg-ambar-accent rounded-full" />
          <h1 className="text-xl font-semibold text-slate-800">{title}</h1>
        </div>
        {breadcrumb && <p className="text-xs text-slate-400 mt-1 ml-3.5">{breadcrumb}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
