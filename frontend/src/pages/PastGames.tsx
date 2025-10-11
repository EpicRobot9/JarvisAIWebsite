import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export default function PastGamesPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(()=>{
    let mounted = true
    ;(async()=>{
      try{
        setLoading(true)
        const r = await fetch('/api/quiz/summaries', { credentials:'include' })
        if (!r.ok) throw new Error('Failed to load summaries')
        const j = await r.json()
        if (!mounted) return
        setItems(j.items||[])
      }catch(e:any){
        if (mounted) setError(e?.message||'Error')
      }finally{ if (mounted) setLoading(false) }
    })()
    return ()=>{ mounted = false }
  },[])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">Past Games</h1>
          <Link to="/" className="jarvis-btn">Home</Link>
        </div>
        {loading && <div>Loading…</div>}
        {error && <div className="text-red-300">{error}</div>}
        {!loading && !error && (
          <div className="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-3">
            {items.length===0 && <div className="text-xs text-slate-400">No past games found.</div>}
            {items.map((it:any)=> (
              <div key={`${it.roomId}-${it.at}`} className="p-2 rounded bg-slate-800/40 flex justify-between items-center mb-2">
                <div>
                  <div className="text-sm">Room: <b className="text-cyan-300">{it.roomId}</b> • Mode: {it.mode}</div>
                  <div className="text-xs text-slate-400">Set: {it.setId} • Host: {it.hostName || 'unknown'} • {new Date(it.at).toLocaleString()}</div>
                </div>
                <div>
                  <Link to={`/quiz/summary/${encodeURIComponent(it.roomId)}`} className="jarvis-btn">View</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
