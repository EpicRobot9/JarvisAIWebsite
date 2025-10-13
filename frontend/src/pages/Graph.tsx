import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ForceGraph2D from 'react-force-graph-2d'

export default function GraphPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<any[]>([])
  const [edges, setEdges] = useState<any[]>([])
  const fgRef = useRef<any>(null)
  const [hoverNode, setHoverNode] = useState<any | null>(null)
  const [hoverLink, setHoverLink] = useState<any | null>(null)
  const [selectedNode, setSelectedNode] = useState<any | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<{studyset: boolean; note: boolean; other: boolean}>({ studyset: true, note: true, other: true })
  const [showPhysics, setShowPhysics] = useState(true)

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

  // Map API data to react-force-graph format
  const graphData = useMemo(() => {
    const ns = (nodes || []).map((n: any) => ({
      id: n.id,
      name: n.label || String(n.id),
      type: n.type || 'node',
      // value influences node size; study sets a bit larger
      val: n.type === 'studyset' ? 8 : n.type === 'note' ? 4 : 3,
    }))
    const ls = (edges || []).map((e: any) => ({ source: e.source, target: e.target, kind: e.kind || 'rel' }))
    // Type filter
    const filteredNodes = ns.filter(n => (n.type === 'studyset' && typeFilter.studyset) || (n.type === 'note' && typeFilter.note) || (!(n.type === 'studyset' || n.type === 'note') && typeFilter.other))
    const keep = new Set(filteredNodes.map(n => n.id))
    const filteredLinks = ls.filter(l => keep.has(l.source as any) && keep.has(l.target as any))
    return { nodes: filteredNodes, links: filteredLinks }
  }, [nodes, edges, typeFilter])

  // Auto-zoom to fit when data loads
  useEffect(() => {
    if (!graphData.nodes.length) return
    const t = setTimeout(() => {
      try { fgRef.current?.zoomToFit?.(600, 40) } catch {}
    }, 100)
    return () => clearTimeout(t)
  }, [graphData])

  // Colors by type (dark theme)
  const colorFor = (type?: string) =>
    type === 'studyset' ? '#22d3ee' : type === 'note' ? '#a78bfa' : '#7dd3fc'

  const matchesSearch = (name?: string) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (name || '').toLowerCase().includes(q)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">Knowledge Graph</h1>
          <Link to="/" className="jarvis-btn">Back</Link>
        </div>

        {loading && <div>Loading…</div>}
        {error && <div className="text-red-300">{error}</div>}

        {!loading && !error && (
          <div className="relative rounded-2xl bg-slate-900/60 ring-1 ring-white/10 overflow-hidden" style={{ height: '70vh' }}>
            <div className="absolute z-10 top-2 left-2 flex items-center gap-2 bg-slate-900/80 border border-slate-700/60 rounded-lg p-2 text-xs">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="px-2 py-1 rounded bg-slate-950/70 border border-slate-800 text-slate-200 outline-none"
                style={{ width: 200 }}
              />
              <div className="flex items-center gap-2 pl-2 border-l border-slate-700">
                <label className="flex items-center gap-1"><input type="checkbox" checked={typeFilter.studyset} onChange={e=>setTypeFilter(f=>({...f, studyset:e.target.checked}))} /> <span className="text-cyan-300">Study Sets</span></label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={typeFilter.note} onChange={e=>setTypeFilter(f=>({...f, note:e.target.checked}))} /> <span className="text-violet-300">Notes</span></label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={typeFilter.other} onChange={e=>setTypeFilter(f=>({...f, other:e.target.checked}))} /> <span className="text-sky-300">Other</span></label>
              </div>
              <div className="flex items-center gap-2 pl-2 border-l border-slate-700">
                <button className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800" onClick={()=>{ try { fgRef.current?.zoomToFit?.(600, 40) } catch {} }}>Fit</button>
                <label className="flex items-center gap-1"><input type="checkbox" checked={showPhysics} onChange={e=>setShowPhysics(e.target.checked)} /> Physics</label>
              </div>
            </div>
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData as any}
              backgroundColor="#0f172a"
              enableNodeDrag={true}
              cooldownTicks={showPhysics ? 120 : 0}
              linkDirectionalParticles={hoverLink ? 6 : 2}
              linkDirectionalParticleWidth={(link: any) => (hoverLink && (link === hoverLink || (hoverNode && (link.source === hoverNode || link.target === hoverNode))) ? 3 : 1)}
              linkColor={(link: any) => {
                const hl = hoverLink && (link === hoverLink)
                const touch = hoverNode && (link.source === hoverNode || link.target === hoverNode)
                return hl ? '#ffffff' : touch ? '#22d3ee' : 'rgba(148,163,184,0.5)'
              }}
              linkCurvature={0.3}
              linkDirectionalArrowLength={5}
              linkDirectionalArrowRelPos={1}
              nodeRelSize={5}
              nodeLabel={(n: any) => `${n.name}`}
              onNodeHover={node => setHoverNode(node || null)}
              onLinkHover={link => setHoverLink(link || null)}
              onNodeClick={(node: any) => {
                // focus and zoom into the node
                if (!node) return
                const distance = 120
                const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0)
                fgRef.current?.centerAt?.(node.x, node.y, 600)
                fgRef.current?.zoom?.(2.5, 800)
                setSelectedNode(node)
              }}
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                const label = node.name
                const fontSize = Math.max(10, 14 / Math.sqrt(globalScale))
                const isHover = hoverNode && hoverNode.id === node.id
                const isSel = selectedNode && selectedNode.id === node.id
                const dim = !matchesSearch(node.name)
                // draw node
                const radius = (node.val || 4) + (isHover ? 2 : 0) + (isSel ? 2 : 0)
                ctx.beginPath()
                ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false)
                ctx.fillStyle = colorFor(node.type)
                ctx.globalAlpha = dim ? 0.35 : 1
                ctx.fill()
                // glow ring
                if (isHover || isSel) {
                  ctx.lineWidth = isSel ? 3 : 2
                  ctx.strokeStyle = isSel ? '#ffffff' : colorFor(node.type)
                  ctx.globalAlpha = 0.9
                  ctx.stroke()
                }
                ctx.globalAlpha = 1
                // label background
                ctx.font = `${fontSize}px Sans-Serif`
                const textWidth = ctx.measureText(label).width
                const bPad = 4
                const bW = textWidth + bPad * 2
                const bH = fontSize + bPad * 2
                ctx.fillStyle = isHover || isSel ? 'rgba(2,6,23,0.95)' : 'rgba(15,23,42,0.75)'
                ctx.fillRect(node.x - bW / 2, node.y - (node.val || 4) - bH - 6, bW, bH)
                // label text
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillStyle = dim ? 'rgba(226,232,240,0.5)' : '#e2e8f0'
                ctx.fillText(label, node.x, node.y - (node.val || 4) - bH / 2 - 6)
              }}
            />

            {/* Legend overlay */}
            <div className="absolute top-2 right-2 text-xs bg-slate-900/80 border border-slate-700/60 rounded-lg px-2 py-1 flex gap-3">
              <div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: colorFor('studyset') }} /> Study Set</div>
              <div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: colorFor('note') }} /> Note</div>
            </div>
            {selectedNode && (
              <div className="absolute bottom-2 right-2 max-w-xs rounded-xl bg-slate-900/90 border border-slate-700/60 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-slate-200 font-medium">{selectedNode.name}</div>
                    <div className="text-slate-400">Type: {selectedNode.type}</div>
                  </div>
                  <button className="text-slate-400 hover:text-slate-200" onClick={()=>setSelectedNode(null)}>✕</button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800" onClick={()=>{ try { fgRef.current?.centerAt?.(selectedNode.x, selectedNode.y, 400); fgRef.current?.zoom?.(3, 400) } catch {} }}>Focus</button>
                  <button className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800" onClick={()=>{ try { fgRef.current?.zoomToFit?.(400, 40) } catch {} }}>Fit</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
