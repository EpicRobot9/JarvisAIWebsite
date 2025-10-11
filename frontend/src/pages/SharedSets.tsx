import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function SharedSetsPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forking, setForking] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const r = await fetch('/api/study/browse')
        if (!r.ok) throw new Error('Failed to load shared sets')
        const json = await r.json()
        if (!mounted) return
        setItems(json.items || [])
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Error')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  async function handleFork(id: string) {
    setForking(id)
    try {
      const r = await fetch(`/api/study/fork/${encodeURIComponent(id)}`, { method: 'POST', credentials: 'include' })
      if (!r.ok) throw new Error('Fork failed')
      const json = await r.json()
      if (json.set?.id) {
        navigate(`/study/sets/${encodeURIComponent(json.set.id)}`)
      }
    } catch (e) {
      alert((e as any)?.message || 'Fork failed')
    } finally {
      setForking(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">Shared Study Sets</h1>
          <Link to="/" className="jarvis-btn">Back</Link>
        </div>
        {loading && <div>Loading…</div>}
        {error && <div className="text-red-300">{error}</div>}
        {!loading && !error && (
          <div className="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-3">
            {items.length === 0 && <div className="text-xs text-slate-400">No shared sets yet.</div>}
            {items.map((item) => (
              <div key={item.id} className="mb-3 p-2 rounded bg-slate-800/40 flex flex-col md:flex-row md:items-center justify-between">
                <div>
                  <div className="font-semibold text-cyan-200">{item.title}</div>
                  <div className="text-xs text-slate-400">{item.subject || 'No subject'} • Shared by {item.user}</div>
                </div>
                <div className="mt-2 md:mt-0 flex gap-2">
                  <Link to={`/study/shared/${encodeURIComponent(item.id)}`} className="jarvis-btn">View</Link>
                  <button className="jarvis-btn jarvis-btn-primary" disabled={forking===item.id} onClick={()=>handleFork(item.id)}>{forking===item.id ? 'Forking…' : 'Fork'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
