import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getIntegrationProviders, type IntegrationItem, type IntegrationProvider } from '../lib/integrations'

export default function IntegrationsDrawer() {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [itemsByProv, setItemsByProv] = React.useState<Record<string, IntegrationItem[]>>({})
  const [providers, setProviders] = React.useState<IntegrationProvider[]>([])
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const p = getIntegrationProviders()
    setProviders(p)
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      const entries = await Promise.all(providers.map(async p => [p.id, await p.loadItems()] as const))
      const rec: Record<string, IntegrationItem[]> = {}
      for (const [id, arr] of entries) rec[id] = arr
      setItemsByProv(rec)
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => { const next = !open; setOpen(next); if (next && !loading) void refresh() }

  // Close when clicking outside
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = rootRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button onClick={toggle} className="px-3 py-2 rounded-md hover:bg-slate-800/60 text-slate-300 text-sm">Integrations</button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="absolute right-0 mt-2 w-[320px] max-h-[60vh] overflow-auto rounded-lg border border-slate-800 bg-slate-950 shadow-xl p-2"
          >
            {loading && <div className="p-3 text-slate-400 text-sm">Loading…</div>}
            {!loading && providers.map(p => (
              <div key={p.id} className="mb-3 last:mb-0">
                <button
                  onClick={() => setCollapsed(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                  className="w-full text-left px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300 hover:text-slate-100 flex items-center justify-between"
                  title="Expand/collapse"
                >
                  <span>{p.name}</span>
                  <span className="text-slate-500">{collapsed[p.id] ? '+' : '−'}</span>
                </button>
                {!collapsed[p.id] && (
                <div className="grid grid-cols-1 gap-2">
                  {(itemsByProv[p.id] || []).map(it => (
                    <div
                      key={it.id}
                      draggable
                      onDragStart={(e)=>{
                        e.dataTransfer.effectAllowed = 'copy'
                        e.dataTransfer.setData('application/x-board-integration', JSON.stringify(it.dragPayload))
                        // Also set plain text as a fallback to allow drop events
                        e.dataTransfer.setData('text/plain', `integration:${p.id}:${it.id}`)
                      }}
                      className="flex items-center gap-2 px-2 py-2 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 cursor-grab active:cursor-grabbing select-none"
                      title={it.subtitle || it.title}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 truncate">{it.title}</div>
                        {it.subtitle && <div className="text-xs text-slate-400 truncate">{it.subtitle}</div>}
                      </div>
                      <a href={it.href} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 hover:text-emerald-300">Open</a>
                    </div>
                  ))}
                  {(itemsByProv[p.id] || []).length === 0 && (
                    <div className="px-2 py-2 text-xs text-slate-500">No items</div>
                  )}
                </div>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
