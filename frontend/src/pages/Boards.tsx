import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createBoard, listBoards, type Board } from '../lib/api'

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  async function refresh() {
    try {
      const r = await listBoards({ take: 100 })
      setBoards(r.items)
    } catch (e: any) {
      setError(e?.message || 'Failed to load boards')
    } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  async function onCreate() {
    try {
      const b = await createBoard(title.trim() || undefined)
      setTitle('')
      setBoards([b, ...boards])
    } catch (e:any) {
      setError(e?.message || 'Create failed')
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to="/" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Home</Link>
        <div className="font-medium">Boards</div>
        <div className="ml-auto flex items-center gap-2">
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Untitled board" className="px-3 py-2 rounded-md bg-slate-900/60 border border-slate-800 text-sm outline-none focus:border-slate-700" />
          <button onClick={onCreate} className="jarvis-btn jarvis-btn-primary">New Board</button>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        {loading && <div className="text-slate-400">Loading…</div>}
        {!loading && boards.length === 0 && <div className="text-slate-400">No boards yet. Create one above.</div>}
        {boards.map(b => (
          <Link key={b.id} to={`/boards/${b.id}`} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 hover:bg-slate-900">
            <div className="font-medium">{b.title || 'Untitled'}</div>
            <div className="text-xs text-slate-400 mt-1">{new Date(b.createdAt).toLocaleString()}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
