import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createBoard, listBoards, type Board } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'

export default function BoardsPage() {
  const nav = useNavigate()
  const [items, setItems] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const r = await listBoards({ take: 100 })
        if (mounted) setItems(r.items)
      } catch (e:any) { if (mounted) setError(e?.message || 'Failed to load') }
      finally { if (mounted) setLoading(false) }
    })()
    return () => { mounted = false }
  }, [])

  async function create() {
    setCreating(true)
    try {
      const b = await createBoard(title.trim() || undefined)
      nav(`/boards/${b.id}`)
    } catch (e:any) { setError(e?.message || 'Create failed') }
    finally { setCreating(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <motion.div
        className="p-4 border-b border-slate-800 flex items-center gap-3"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <Link to="/" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Home</Link>
        <div className="font-medium">Boards</div>
        <div className="ml-auto flex items-center gap-2">
          <input placeholder="Board title" value={title} onChange={e=>setTitle(e.target.value)} className="px-3 py-2 rounded-md bg-slate-900/60 border border-slate-800 text-sm outline-none focus:border-slate-700" />
          <button onClick={create} disabled={creating} className="jarvis-btn jarvis-btn-primary">New Board</button>
        </div>
      </motion.div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      <div className="p-6">
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="h-4 w-1/2 skeleton rounded" />
                <div className="h-3 w-1/3 skeleton rounded mt-2" />
              </div>
            ))}
          </div>
        )}
        {!loading && items.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-slate-400"
          >
            No boards yet. Create your first board above.
          </motion.div>
        )}
        <AnimatePresence>
          {!loading && items.length > 0 && (
            <motion.div
              className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
            >
              {items.map(b => (
                <motion.div
                  key={b.id}
                  variants={{ hidden: { opacity: 0, y: 8, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1 } }}
                  whileHover={{ y: -2, scale: 1.01 }}
                  transition={{ duration: 0.25 }}
                >
                  <Link to={`/boards/${b.id}`} className="rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 p-4 block hover-lift">
                    <div className="text-slate-300 font-medium truncate" title={b.title}>{b.title || 'Untitled'}</div>
                    <div className="text-xs text-slate-500 mt-1">{new Date(b.createdAt).toLocaleString()}</div>
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
