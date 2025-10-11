import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export default function GraphPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<any[]>([])
  const [edges, setEdges] = useState<any[]>([])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const r = await fetch('/api/graph', { credentials: 'include' })
        if (!r.ok) throw new Error('Failed to load graph')
        const json = await r.json()
        if (!mounted) return
        setNodes(json.nodes || [])
        setEdges(json.edges || [])
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Error')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">Knowledge Graph (beta)</h1>
          <Link to="/" className="jarvis-btn">Back</Link>
        </div>
        {loading && <div>Loading…</div>}
        {error && <div className="text-red-300">{error}</div>}
        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-3">
              <div className="text-sm text-cyan-300 mb-2">Study Sets</div>
              {nodes.filter(n => n.type==='studyset').map((n) => (
                <div key={n.id} className="text-sm mb-1">• {n.label}</div>
              ))}
              {nodes.filter(n => n.type==='studyset').length === 0 && (
                <div className="text-xs text-slate-400">No sets yet.</div>
              )}
            </div>
            <div className="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-3">
              <div className="text-sm text-cyan-300 mb-2">Notes</div>
              {nodes.filter(n => n.type==='note').map((n) => (
                <div key={n.id} className="text-sm mb-1">• {n.label}</div>
              ))}
              {nodes.filter(n => n.type==='note').length === 0 && (
                <div className="text-xs text-slate-400">No linked notes.</div>
              )}
            </div>
            <div className="md:col-span-2 rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-3">
              <div className="text-sm text-cyan-300 mb-2">Links</div>
              {edges.map((e, i) => (
                <div key={i} className="text-xs mb-1">{e.source} → {e.target}</div>
              ))}
              {edges.length === 0 && (<div className="text-xs text-slate-400">No links yet. Link notes when generating study sets to see relationships.</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
