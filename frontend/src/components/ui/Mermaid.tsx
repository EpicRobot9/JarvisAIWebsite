import React, { useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'

type Props = {
  chart: string
  theme?: 'dark' | 'default'
}

const SECURE_CONFIG = { startOnLoad: false, securityLevel: 'strict' as const }

function sanitizeMermaidInput(src: string): string {
  // Quick guard: if it looks like plain text lines without a known mermaid keyword, wrap as flowchart with quoted labels
  const hasKeyword = /(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram)/.test(src)
  if (!hasKeyword) {
    const lines = src.split(/\n+/).filter(Boolean)
    // Create a simple top-down flow from lines, escaping quotes
    const nodes = lines.map((l, i) => `N${i}[${l.replace(/"/g, '\\"')}]`)
    const edges = nodes.map((n, i) => (i < nodes.length - 1 ? `${n} --> N${i+1}` : n))
    return `flowchart TD\n${edges.join('\n')}`
  }
  // Escape double quotes inside bracket labels to avoid parser errors
  // Example: A[Start: Origin of "Epic"]
  return src.replace(/\[(.*?)\]/g, (m, p1) => {
    const safe = String(p1).replace(/"/g, '\\"')
    return `[${safe}]`
  })
}

export default function Mermaid({ chart, theme = 'dark' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgWrapRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)

  // Initialize Mermaid once per theme
  useEffect(() => {
    mermaid.initialize({ ...SECURE_CONFIG, theme })
  }, [theme])

  // Render chart
  useEffect(() => {
    let mounted = true
    const el = svgWrapRef.current
    if (!el) return
    setError(null)
    const id = `mmd-${Math.random().toString(36).slice(2)}`
    const safeChart = sanitizeMermaidInput(chart)
    ;(async () => {
      try {
        const { svg } = await mermaid.render(id, safeChart)
        if (mounted) el.innerHTML = svg
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to render diagram')
      }
    })()
    return () => { mounted = false }
  }, [chart, theme])

  async function copyCode() {
    try { await navigator.clipboard.writeText(chart) } catch {}
  }

  async function copySVG() {
    try {
      const svg = svgWrapRef.current?.querySelector('svg')
      if (!svg) return
      const text = new XMLSerializer().serializeToString(svg)
      await navigator.clipboard.writeText(text)
    } catch {}
  }

  function download(type: 'svg' | 'png') {
    const svg = svgWrapRef.current?.querySelector('svg') as SVGSVGElement | null
    if (!svg) return
    const serialized = new XMLSerializer().serializeToString(svg)
    if (type === 'svg') {
      const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'diagram.svg'
      a.click()
      URL.revokeObjectURL(url)
    } else {
      const img = new Image()
      const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const scaleFactor = 2
        canvas.width = (svg.viewBox && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : svg.clientWidth) * scaleFactor
        canvas.height = (svg.viewBox && svg.viewBox.baseVal.height ? svg.viewBox.baseVal.height : svg.clientHeight) * scaleFactor
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = theme === 'dark' ? '#0b1222' : '#ffffff'
        ctx.fillRect(0,0,canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          if (!blob) return
          const dl = document.createElement('a')
          dl.href = URL.createObjectURL(blob)
          dl.download = 'diagram.png'
          dl.click()
          URL.revokeObjectURL(dl.href)
        }, 'image/png')
        URL.revokeObjectURL(url)
      }
      img.src = url
    }
  }

  function zoom(delta: number) {
    setScale(s => Math.min(3, Math.max(0.5, Number((s + delta).toFixed(2)))))
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-900 bg-rose-950/30 p-3 text-rose-300 text-xs">
        Mermaid error: {error}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="rounded-md border border-slate-800 bg-slate-900/50">
      <div className="flex items-center gap-1 justify-end p-1 border-b border-slate-800 text-xs">
        <button className="px-2 py-1 hover:bg-slate-800 rounded" onClick={() => zoom(-0.1)} title="Zoom out">−</button>
        <button className="px-2 py-1 hover:bg-slate-800 rounded" onClick={() => setScale(1)} title="Reset zoom">100%</button>
        <button className="px-2 py-1 hover:bg-slate-800 rounded" onClick={() => zoom(+0.1)} title="Zoom in">＋</button>
        <span className="mx-2 text-slate-500">|</span>
        <button className="px-2 py-1 hover:bg-slate-800 rounded" onClick={copyCode} title="Copy code">Copy code</button>
        <button className="px-2 py-1 hover:bg-slate-800 rounded" onClick={copySVG} title="Copy SVG">Copy SVG</button>
        <button className="px-2 py-1 hover:bg-slate-800 rounded" onClick={() => download('svg')} title="Download SVG">Download SVG</button>
        <button className="px-2 py-1 hover:bg-slate-800 rounded" onClick={() => download('png')} title="Download PNG">Download PNG</button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: 520 }}>
        <div ref={svgWrapRef} style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }} />
      </div>
    </div>
  )
}
