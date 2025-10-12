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
    return { nodes: ns, links: ls }
  }, [nodes, edges])

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
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData as any}
              backgroundColor="#0f172a"
              enableNodeDrag={true}
              cooldownTicks={120}
              linkDirectionalParticles={hoverLink ? 6 : 2}
              linkDirectionalParticleWidth={(link: any) => (hoverLink && (link === hoverLink || (hoverNode && (link.source === hoverNode || link.target === hoverNode))) ? 3 : 1)}
              linkColor={(link: any) => {
                const hl = hoverLink && (link === hoverLink)
                const touch = hoverNode && (link.source === hoverNode || link.target === hoverNode)
                return hl ? '#ffffff' : touch ? '#22d3ee' : 'rgba(148,163,184,0.5)'
              }}
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
              }}
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                const label = node.name
                const fontSize = Math.max(10, 14 / Math.sqrt(globalScale))
                const isHover = hoverNode && hoverNode.id === node.id
                // draw node
                ctx.beginPath()
                ctx.arc(node.x, node.y, (node.val || 4) + (isHover ? 2 : 0), 0, 2 * Math.PI, false)
                ctx.fillStyle = colorFor(node.type)
                ctx.fill()
                // label background
                ctx.font = `${fontSize}px Sans-Serif`
                const textWidth = ctx.measureText(label).width
                const bPad = 4
                const bW = textWidth + bPad * 2
                const bH = fontSize + bPad * 2
                ctx.fillStyle = isHover ? 'rgba(2,6,23,0.9)' : 'rgba(15,23,42,0.75)'
                ctx.fillRect(node.x - bW / 2, node.y - (node.val || 4) - bH - 6, bW, bH)
                // label text
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillStyle = '#e2e8f0'
                ctx.fillText(label, node.x, node.y - (node.val || 4) - bH / 2 - 6)
              }}
            />

            {/* Legend overlay */}
            <div className="absolute top-2 right-2 text-xs bg-slate-900/80 border border-slate-700/60 rounded-lg px-2 py-1 flex gap-3">
              <div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: colorFor('studyset') }} /> Study Set</div>
              <div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: colorFor('note') }} /> Note</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
