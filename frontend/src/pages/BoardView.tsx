import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getBoard, updateBoard, createBoardItem, updateBoardItem, deleteBoardItem, createBoardEdge, deleteBoardEdge, aiStructureBoard, aiSummarizeSelection, aiDiagramFromSelection, aiFlashcardsFromSelection, aiSuggestLinks, aiCluster, type BoardItem, type BoardEdge } from '../lib/api'
import { useCallSession } from '../hooks/useCallSession'
import { parseBoardCommand } from '../lib/commands'
import { enqueueStreamUrl, getPlaybackQueueLength, isAudioActive, setOnQueueIdleListener } from '../lib/audio'
import { getTtsStreamUrl } from '../lib/api'
import { exportNodeToPng, defaultBoardFileName } from '../lib/export'

export default function BoardView() {
  const { id } = useParams()
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<BoardItem[]>([])
  const [edges, setEdges] = useState<BoardEdge[]>([])
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ id: string; startX: number; startY: number; origW: number; origH: number } | null>(null)
  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 })
  const saveViewportTimer = useRef<number | null>(null)
  const [isSpaceDown, setIsSpaceDown] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [linkMode, setLinkMode] = useState(false)
  const [linkSource, setLinkSource] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState<{x:number;y:number}>({x:0,y:0})
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [voiceOn, setVoiceOn] = useState(false)

  // Minimal user/session for voice; reuse board id as session context
  const sessionId = useMemo(()=>`board-${id||'unknown'}`, [id])
  const voice = useCallSession({ userId: undefined, sessionId, customProcess: async (spoken: string) => {
    // Parse into a board command and execute; return a short TTS confirmation
    const cmd = parseBoardCommand(spoken)
    if (!cmd) return ''
    try {
      if (cmd.type === 'create_note') {
        const coords = { x: 60 + Math.random()*60, y: 60 + Math.random()*40 }
        if (!id) return ''
        const content = { text: (cmd.text ? cmd.text : 'New note') }
        const item = await createBoardItem(id, { type: 'note', x: coords.x, y: coords.y, w: 320, h: 200, content } as any)
        setItems(prev => [...prev, item])
        return 'Added a note.'
      }
      if (cmd.type === 'suggest_links') { await doSuggestLinks(); return 'Suggesting links.' }
      if (cmd.type === 'cluster') { await doCluster(); return 'Clustering items.' }
      if (cmd.type === 'link_selected') { await linkSelected(); return 'Linked selected.' }
      if (cmd.type === 'unlink_selected') { await unlinkSelected(); return 'Unlinked selection.' }
      if (cmd.type === 'summarize_selection') { await doSummarize(); return 'Summarizing selection.' }
      if (cmd.type === 'diagram_selection') { await doDiagram(); return 'Creating diagram.' }
      if (cmd.type === 'clear_selection') { setSel({}); return 'Cleared selection.' }
      if (cmd.type === 'select_all') { setSel(Object.fromEntries(items.map(i=>[i.id, true]))); return 'Selected all items.' }
      if (cmd.type === 'fit_view') { fitToContent(); return 'Fitting view.' }
      if (cmd.type === 'zoom_in') { zoomBy(1.1); return 'Zooming in.' }
      if (cmd.type === 'zoom_out') { zoomBy(1/1.1); return 'Zooming out.' }
    } catch (e) {
      // soft-fail; surface error banner via setError
      setError((e as any)?.message || 'Voice command failed')
    }
    return ''
  }, onTranscript: (t)=>{ /* no-op for now */ }, onReply: async (reply)=>{
    // Speak confirmation using stream URL queue
    try {
      setOnQueueIdleListener(()=>{})
      await enqueueStreamUrl(getTtsStreamUrl(reply))
    } catch {}
  } })

  async function load() {
    if (!id) return
    try {
      const r = await getBoard(id)
      setTitle(r.board.title || 'Untitled')
      setItems(r.items)
      setEdges(r.edges)
      const vp = r.board?.viewport
      if (vp && typeof vp.x === 'number' && typeof vp.y === 'number' && typeof vp.zoom === 'number') {
        setViewport({ x: vp.x, y: vp.y, zoom: Math.max(0.2, Math.min(3, vp.zoom)) })
      }
    } catch (e:any) {
      setError(e?.message || 'Failed to load board')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  async function saveTitle() {
    if (!id) return
    try { await updateBoard(id, { title }) } catch {}
  }

  async function addNote() {
    if (!id) return
    const item = await createBoardItem(id, { type: 'note', x: 60, y: 60, w: 320, h: 200, content: { text: 'New note' } as any } as any)
    setItems([...items, item])
  }

  const selectedIds = useMemo(() => Object.keys(sel).filter(k => sel[k]), [sel])

  // Global pointer handlers for drag/resize
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        // Convert to board coords
        const bx = (cx - viewport.x) / viewport.zoom
        const by = (cy - viewport.y) / viewport.zoom
        setMousePos({ x: bx, y: by })
      }
      if (dragRef.current) {
        const { id, startX, startY, origX, origY } = dragRef.current
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        setItems(prev => prev.map(it => it.id === id ? { ...it, x: Math.max(0, origX + dx / viewport.zoom), y: Math.max(0, origY + dy / viewport.zoom) } : it))
      } else if (resizeRef.current) {
        const { id, startX, startY, origW, origH } = resizeRef.current
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        setItems(prev => prev.map(it => it.id === id ? { ...it, w: Math.max(120, origW + dx / viewport.zoom), h: Math.max(80, origH + dy / viewport.zoom) } : it))
      } else if (panRef.current) {
        const { startX, startY, origX, origY } = panRef.current
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        const next = { x: origX + dx, y: origY + dy, zoom: viewport.zoom }
        setViewport(next)
        // debounce save viewport
        if (saveViewportTimer.current) window.clearTimeout(saveViewportTimer.current)
        saveViewportTimer.current = window.setTimeout(async () => {
          if (!id) return
          try { await updateBoard(id, { viewport: next }) } catch {}
        }, 500)
      }
    }
    async function onUp() {
      if (dragRef.current) {
        const { id } = dragRef.current
        dragRef.current = null
        const it = items.find(x => x.id === id)
        if (it && id) { try { await updateBoardItem(idParam(), id, { x: it.x, y: it.y }) } catch {} }
      }
      if (resizeRef.current) {
        const { id } = resizeRef.current
        resizeRef.current = null
        const it = items.find(x => x.id === id)
        if (it && id) { try { await updateBoardItem(idParam(), id, { w: it.w, h: it.h }) } catch {} }
      }
      if (panRef.current) panRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, viewport])

  // Track Spacebar state for panning
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') setIsSpaceDown(true)
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomBy(1.1)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        zoomBy(1/1.1)
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0')) {
        e.preventDefault()
        resetZoom()
      }
      if (e.key === 'Escape') {
        // Cancel link mode
        setLinkMode(false)
        setLinkSource(null)
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setIsSpaceDown(false)
    }
    function onBlur() { setIsSpaceDown(false) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Delete key handler
  useEffect(() => {
    async function onKey(e: KeyboardEvent) {
      if (e.key === 'Delete' && selectedIds.length > 0 && id) {
        const ids = [...selectedIds]
        setSel({})
        for (const itemId of ids) {
          try { await deleteBoardItem(id, itemId) } catch {}
        }
        setItems(prev => prev.filter(it => !ids.includes(it.id)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, id])

  const idParam = () => id || ''

  // Wheel to zoom (Ctrl+wheel), pan with background drag
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!id) return
    if (!e.ctrlKey) return // only zoom when Ctrl is held to avoid hijacking scroll
    e.preventDefault()
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    zoomAt(Math.exp(-e.deltaY * 0.001), e.clientX - rect.left, e.clientY - rect.top)
  }

  function toBoardCoords(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const cx = clientX - rect.left
    const cy = clientY - rect.top
    const x = (cx - viewport.x) / viewport.zoom
    const y = (cy - viewport.y) / viewport.zoom
    return { x, y }
  }

  async function addNoteAt(x: number, y: number) {
    if (!id) return
    try {
      const item = await createBoardItem(id, { type: 'note', x: Math.round(x - 160), y: Math.round(y - 100), w: 320, h: 200, content: { text: 'New note' } as any } as any)
      setItems(prev => [...prev, item])
    } catch (e:any) { setError(e?.message || 'Add note failed') }
  }

  function clampZoom(z: number) { return Math.max(0.2, Math.min(3, z)) }
  function queueSaveViewport(next: {x:number;y:number;zoom:number}) {
    if (saveViewportTimer.current) window.clearTimeout(saveViewportTimer.current)
    saveViewportTimer.current = window.setTimeout(async () => { if (id) { try { await updateBoard(id, { viewport: next }) } catch {} } }, 400)
  }
  function zoomAt(factor: number, cx: number, cy: number) {
    const prev = viewport
    const nextZoom = clampZoom(prev.zoom * factor)
    const px = (cx - prev.x) / prev.zoom
    const py = (cy - prev.y) / prev.zoom
    const nextX = cx - px * nextZoom
    const nextY = cy - py * nextZoom
    const next = { x: nextX, y: nextY, zoom: nextZoom }
    setViewport(next)
    queueSaveViewport(next)
  }
  function zoomBy(factor: number) {
    const rect = containerRef.current?.getBoundingClientRect()
    const cx = rect ? rect.width / 2 : 400
    const cy = rect ? rect.height / 2 : 300
    zoomAt(factor, cx, cy)
  }
  function resetZoom() {
    const next = { x: 0, y: 0, zoom: 1 }
    setViewport(next)
    queueSaveViewport(next)
  }
  function fitToContent() {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return resetZoom()
    if (items.length === 0) return resetZoom()
    const minX = Math.min(...items.map(i => i.x))
    const minY = Math.min(...items.map(i => i.y))
    const maxX = Math.max(...items.map(i => i.x + i.w))
    const maxY = Math.max(...items.map(i => i.y + i.h))
    const pad = 80
    const contentW = (maxX - minX) + pad
    const contentH = (maxY - minY) + pad
    const scaleX = rect.width / Math.max(1, contentW)
    const scaleY = rect.height / Math.max(1, contentH)
    const zoom = clampZoom(Math.min(scaleX, scaleY))
    // center content in view
    const cx = rect.width / 2
    const cy = rect.height / 2
    const contentCenterX = minX + (maxX - minX) / 2
    const contentCenterY = minY + (maxY - minY) / 2
    const nextX = cx - contentCenterX * zoom
    const nextY = cy - contentCenterY * zoom
    const next = { x: nextX, y: nextY, zoom }
    setViewport(next)
    queueSaveViewport(next)
  }

  // Edge helpers
  const itemById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  const boardSize = useMemo(() => {
    const maxX = items.reduce((m, it) => Math.max(m, it.x + it.w), 800)
    const maxY = items.reduce((m, it) => Math.max(m, it.y + it.h), 600)
    return { w: Math.max(maxX + 400, 1600), h: Math.max(maxY + 400, 1000) }
  }, [items])

  async function linkSelected() {
    if (!id) return
    const ids = selectedIds
    if (ids.length !== 2) return
    try {
      const e = await createBoardEdge(id, { sourceId: ids[0], targetId: ids[1] })
      setEdges(prev => [...prev, e])
    } catch (e:any) { setError(e?.message || 'Link failed') }
  }
  async function unlinkSelected() {
    if (!id) return
    const ids = new Set(selectedIds)
    const toDelete = edges.filter(e => ids.has(e.sourceId) && ids.has(e.targetId))
    for (const ed of toDelete) {
      try { await deleteBoardEdge(id, ed.id) } catch {}
    }
    setEdges(prev => prev.filter(e => !(ids.has(e.sourceId) && ids.has(e.targetId))))
  }
  async function deleteSelectedEdge() {
    if (!id || !selectedEdgeId) return
    try { await deleteBoardEdge(id, selectedEdgeId); setEdges(prev => prev.filter(e => e.id !== selectedEdgeId)); setSelectedEdgeId(null) }
    catch (e:any) { setError(e?.message || 'Delete edge failed') }
  }

  async function doStructure() {
    if (!id) return
    try {
      const r = await aiStructureBoard(id, prompt)
      setItems([...items, ...r.items])
      setPrompt('')
    } catch (e:any) { setError(e?.message || 'Structure failed') }
  }

  async function doSummarize() {
    if (!id || selectedIds.length === 0) return
    try {
      const r = await aiSummarizeSelection(id, selectedIds)
      setItems([...items, r.item])
      setSel({})
    } catch (e:any) { setError(e?.message || 'Summarize failed') }
  }

  async function doDiagram() {
    if (!id || selectedIds.length === 0) return
    try {
      const r = await aiDiagramFromSelection(id, selectedIds, 'flowchart')
      setItems([...items, r.item])
      setSel({})
    } catch (e:any) { setError(e?.message || 'Diagram failed') }
  }

  async function doFlashcards() {
    if (!id || selectedIds.length === 0) return
    try {
      await aiFlashcardsFromSelection(id, selectedIds, `From ${title}`)
      alert('Flashcard set created. See Study dashboard.')
      setSel({})
    } catch (e:any) { setError(e?.message || 'Flashcards failed') }
  }

  async function doSuggestLinks() {
    if (!id) return
    setBusy('Suggesting links…')
    try {
      const r = await aiSuggestLinks(id, selectedIds.length ? selectedIds : undefined, true)
      if (r.created?.length) setEdges(prev => [...prev, ...r.created])
    } catch (e:any) { setError(e?.message || 'Suggest-links failed') }
    finally { setBusy(null) }
  }

  async function doCluster() {
    if (!id) return
    setBusy('Clustering…')
    try {
      const r = await aiCluster(id, selectedIds.length ? selectedIds : undefined)
      if (r.groupItems?.length) setItems(prev => [...prev, ...r.groupItems])
      if (r.updatedItems?.length) {
        setItems(prev => prev.map(it => r.updatedItems.find(u => u.id === it.id) || it))
      }
      setSel({})
    } catch (e:any) { setError(e?.message || 'Cluster failed') }
    finally { setBusy(null) }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to="/boards" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Boards</Link>
        <input value={title} onChange={e=>setTitle(e.target.value)} onBlur={saveTitle} className="px-3 py-2 rounded-md bg-slate-900/60 border border-slate-800 text-sm outline-none focus:border-slate-700 flex-1" />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={addNote} className="jarvis-btn jarvis-btn-secondary">+ Note</button>
          {/* PTT voice control */}
          <button
            className={`jarvis-btn ${voice.state==='listening' ? 'jarvis-btn-primary' : 'jarvis-btn-secondary'}`}
            onMouseDown={(e)=>{ e.preventDefault(); voice.startListening() }}
            onMouseUp={(e)=>{ e.preventDefault(); voice.stopAndSend() }}
            onTouchStart={(e)=>{ e.preventDefault(); voice.startListening() }}
            onTouchEnd={(e)=>{ e.preventDefault(); voice.stopAndSend() }}
            title="Hold to talk (Spacebar also works)"
          >{voice.state==='listening' ? 'Release to Send' : 'Hold to Talk'}</button>
          <div className="text-xs text-slate-400 select-none">
            {voice.state === 'processing' ? 'Processing…' : voice.state === 'speaking' ? 'Speaking…' : ''}
          </div>
          <button
            className="jarvis-btn jarvis-btn-secondary"
            onClick={() => {
              const root = containerRef.current
              if (!root) return
              void exportNodeToPng(root, defaultBoardFileName(title))
            }}
          >Export PNG</button>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Simple canvas */}
        <div
          className="relative rounded-xl bg-slate-900/60 border border-slate-800 min-h-[60vh] overflow-auto"
          onWheel={handleWheel}
          onMouseDown={(e) => {
            // Background drag to pan (or hold Space on inner area)
            const target = e.target as HTMLElement
            const isBackground = target === e.currentTarget
            if (e.button !== 0) return
            if (isBackground || isSpaceDown) {
              panRef.current = { startX: e.clientX, startY: e.clientY, origX: viewport.x, origY: viewport.y }
            }
          }}
          ref={containerRef}
          onDoubleClick={(e) => {
            // Double-click empty background adds a note at cursor in board space
            const t = e.target as HTMLElement
            const isBg = t === e.currentTarget
            if (!isBg) return
            const p = toBoardCoords(e.clientX, e.clientY)
            addNoteAt(p.x, p.y)
          }}
        >
          {/* Canvas toolbar */}
          <div className="absolute z-10 top-3 left-3 flex items-center gap-2 bg-slate-950/70 border border-slate-800 rounded-md px-2 py-1 backdrop-blur-sm">
            <button className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700" onClick={() => zoomBy(1/1.1)}>-</button>
            <button className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700" onClick={() => zoomBy(1.1)}>+</button>
            <button className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700" onClick={resetZoom}>Reset</button>
            <button className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700" onClick={fitToContent}>Fit</button>
            <div className="mx-2 text-xs text-slate-300">{Math.round(viewport.zoom * 100)}%</div>
            <button
              className={`px-2 py-1 text-xs rounded border ${linkMode ? 'bg-emerald-700/70 border-emerald-600' : 'bg-slate-800 hover:bg-slate-700 border-slate-700'}`}
              onClick={() => { setLinkMode(v => !v); setLinkSource(null) }}
              title="Link Mode"
            >{linkMode ? 'Link: ON' : 'Link: OFF'}</button>
            {selectedEdgeId && (
              <button className="px-2 py-1 text-xs rounded bg-rose-800/70 hover:bg-rose-700 border border-rose-700 ml-2" onClick={deleteSelectedEdge} title="Delete selected edge">Delete Edge</button>
            )}
          </div>
          {loading && <div className="p-4 text-slate-400">Loading…</div>}
          {!loading && (
            <div
              className="relative"
              style={{ width: boardSize.w, height: boardSize.h, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, transformOrigin: '0 0' }}
            >
              {/* Edges (SVG below items to reduce overlay) */}
              <svg className="absolute inset-0" width={boardSize.w} height={boardSize.h} style={{ pointerEvents: 'auto' }}>
                <defs>
                  <marker id="arrow" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 4 L 0 8 z" fill="#64748b" />
                  </marker>
                  <marker id="arrow-selected" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 4 L 0 8 z" fill="#22c55e" />
                  </marker>
                </defs>
                {edges.map((e, idx) => {
                  const s = itemById[e.sourceId]
                  const t = itemById[e.targetId]
                  if (!s || !t) return null
                  const x1 = s.x + s.w / 2
                  const y1 = s.y + s.h / 2
                  const x2 = t.x + t.w / 2
                  const y2 = t.y + t.h / 2
                  const isSel = selectedEdgeId === e.id
                  return (
                    <g key={e.id || idx} onClick={(ev) => { ev.stopPropagation(); setSelectedEdgeId(isSel ? null : (e.id || null)) }}>
                      <line
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={isSel ? '#22c55e' : '#64748b'}
                        strokeWidth={isSel ? 3 : 2}
                        strokeOpacity={0.9}
                        markerEnd={isSel ? 'url(#arrow-selected)' : 'url(#arrow)'}
                      />
                      {e.label && (
                        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} fill="#cbd5e1" fontSize="10" textAnchor="middle" dy="-4" style={{ userSelect: 'none' }}>{e.label}</text>
                      )}
                    </g>
                  )
                })}
                {/* Temp link preview */}
                {linkMode && linkSource && (() => {
                  const s = itemById[linkSource]
                  if (!s) return null
                  const x1 = s.x + s.w / 2
                  const y1 = s.y + s.h / 2
                  return <line x1={x1} y1={y1} x2={mousePos.x} y2={mousePos.y} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={2} />
                })()}
              </svg>
              {items.map(it => (
                <div
                  key={it.id}
                  className={`absolute rounded-md border ${sel[it.id] ? 'border-emerald-400' : linkMode && linkSource === it.id ? 'border-emerald-500' : 'border-slate-700'} bg-slate-800/60 hover:border-slate-600 shadow-sm`}
                  style={{ left: it.x, top: it.y, width: it.w, height: it.h }}
                  onMouseDown={(e) => {
                    // If clicking on content area (textarea), don't start drag
                    const target = e.target as HTMLElement
                    if (target.closest('textarea')) return
                    // If panning with Space, start pan instead of selecting/dragging item
                    if (isSpaceDown && e.button === 0) {
                      panRef.current = { startX: e.clientX, startY: e.clientY, origX: viewport.x, origY: viewport.y }
                      return
                    }
                    // Click on an item should clear any selected edge
                    setSelectedEdgeId(null)
                    // Link mode: click to choose source then target
                    if (linkMode) {
                      if (!linkSource) {
                        setLinkSource(it.id)
                        setSel({ [it.id]: true })
                      } else if (linkSource !== it.id && id) {
                        createBoardEdge(id, { sourceId: linkSource, targetId: it.id })
                          .then(e => setEdges(prev => [...prev, e]))
                          .catch(err => setError(err?.message || 'Link failed'))
                        setLinkMode(false)
                        setLinkSource(null)
                        setSel({ [it.id]: true })
                      }
                      return
                    }
                    setSel(s => {
                      if (e.shiftKey) return { ...s, [it.id]: !s[it.id] }
                      return { [it.id]: true }
                    })
                    dragRef.current = { id: it.id, startX: e.clientX, startY: e.clientY, origX: it.x, origY: it.y }
                  }}
                >
                  {/* Drag handle (top bar) */}
                  <div
                    className="h-6 cursor-move rounded-t-md bg-slate-900/40 border-b border-slate-700 flex items-center px-2 text-[11px] text-slate-400 select-none"
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      dragRef.current = { id: it.id, startX: e.clientX, startY: e.clientY, origX: it.x, origY: it.y }
                    }}
                  >{it.type}</div>

                  {/* Content */}
                  {it.type === 'note' && (
                    <textarea
                      value={it.content?.text || ''}
                      onClick={(e) => { e.stopPropagation(); setSel(s => ({ ...s, [it.id]: e.shiftKey ? !s[it.id] : true })) }}
                      onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: { ...p.content, text: e.target.value } } : p))}
                      onBlur={async () => { if (!id) return; await updateBoardItem(id, it.id, { content: it.content }) }}
                      className="w-full h-[calc(100%-1.5rem)] bg-transparent text-slate-200 text-sm p-2 outline-none resize-none"
                    />
                  )}
                  {it.type === 'checklist' && (
                    <div className="p-2 text-sm text-slate-200 space-y-1" onClick={(e)=> e.stopPropagation()}>
                      {(Array.isArray(it.content?.items) ? it.content.items : []).map((ci:any, idx:number) => (
                        <label key={idx} className="flex items-center gap-2">
                          <input type="checkbox" checked={!!ci.done} onChange={async (e)=>{
                            const next = { ...(it.content||{}), items: [...(it.content?.items||[])] }
                            next.items[idx] = { ...next.items[idx], done: e.target.checked }
                            setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                            if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                          }} />
                          <span className={ci.done? 'line-through text-slate-400' : ''}>{ci.text}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {it.type === 'link' && (
                    <div className="p-2 text-sm text-slate-200" onClick={(e)=> e.stopPropagation()}>
                      <a href={it.content?.url || '#'} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline break-all">
                        {it.content?.title || it.content?.url || 'Open link'}
                      </a>
                      {it.content?.desc && <div className="text-xs text-slate-400 mt-1">{it.content.desc}</div>}
                    </div>
                  )}
                  {it.type === 'image' && (
                    <div className="w-full h-[calc(100%-1.5rem)] flex items-center justify-center bg-slate-900/30" onClick={(e)=> e.stopPropagation()}>
                      {it.content?.url ? (
                        <img src={it.content.url} alt={it.content?.caption || ''} className="max-w-full max-h-full object-contain rounded" />
                      ) : (
                        <div className="text-xs text-slate-500">No image URL</div>
                      )}
                    </div>
                  )}
                  {it.type === 'group' && (
                    <div className="p-2 text-sm text-slate-200 select-none">
                      <div className="font-semibold text-slate-100">{it.content?.title || 'Group'}</div>
                    </div>
                  )}

                  {/* Resize handle */}
                  <div
                    className="absolute right-1 bottom-1 w-3 h-3 bg-slate-600 rounded-sm cursor-se-resize"
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      resizeRef.current = { id: it.id, startX: e.clientX, startY: e.clientY, origW: it.w, origH: it.h }
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3 space-y-3">
          <div className="text-sm font-medium">AI Actions</div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Structure from prompt</label>
            <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Plan a project, outline a topic, etc." className="w-full h-24 bg-slate-950/40 border border-slate-800 rounded p-2 text-sm outline-none focus:border-slate-700" />
            <button onClick={doStructure} className="jarvis-btn jarvis-btn-primary mt-2 w-full">Create Structure</button>
          </div>
          <div className="text-xs text-slate-400">Selection: {selectedIds.length} items {busy && <span className="ml-2 text-emerald-400">{busy}</span>}</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={doSummarize} disabled={selectedIds.length===0} className="jarvis-btn jarvis-btn-secondary">Summarize → Note</button>
            <button onClick={doDiagram} disabled={selectedIds.length===0} className="jarvis-btn jarvis-btn-secondary">Diagram (Mermaid)</button>
            <button onClick={doFlashcards} disabled={selectedIds.length===0} className="jarvis-btn jarvis-btn-secondary col-span-2">Create Flashcards</button>
            <button onClick={linkSelected} disabled={selectedIds.length!==2} className="jarvis-btn jarvis-btn-secondary">Link Selected</button>
            <button onClick={unlinkSelected} disabled={selectedIds.length<2} className="jarvis-btn jarvis-btn-secondary">Unlink</button>
            <button onClick={doSuggestLinks} className="jarvis-btn jarvis-btn-primary col-span-2">AI: Suggest Links</button>
            <button onClick={doCluster} className="jarvis-btn jarvis-btn-primary col-span-2">AI: Cluster & Auto-Layout</button>
          </div>
          <div className="text-xs text-slate-500">Tips: Hold Shift to multi-select items. Ctrl+Wheel to zoom. Space+Drag to pan. Use Link Mode to connect notes.</div>
        </div>
      </div>
    </div>
  )
}
