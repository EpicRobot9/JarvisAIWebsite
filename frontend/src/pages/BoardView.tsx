import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getBoard, updateBoard, createBoardItem, updateBoardItem, deleteBoardItem, createBoardEdge, deleteBoardEdge, aiStructureBoard, aiSummarizeSelection, aiDiagramFromSelection, aiFlashcardsFromSelection, aiSuggestLinks, aiCluster, uploadBoardImage, type BoardItem, type BoardEdge } from '../lib/api'
import { AppError } from '../lib/api'
import { useCallSession } from '../hooks/useCallSession'
import { parseBoardCommand } from '../lib/commands'
import { enqueueStreamUrl, getPlaybackQueueLength, isAudioActive, setOnQueueIdleListener } from '../lib/audio'
import { getTtsStreamUrl } from '../lib/api'
import { exportNodeToPng, defaultBoardFileName } from '../lib/export'
import { ZoomIn, ZoomOut, RefreshCcw, Maximize2, Download, Link2, Unlink, StickyNote, ListChecks, Image as ImageIcon, Shapes, Mic, MicOff, Table as TableIcon, Columns as ColumnsIcon, Plus, X, GripVertical, Pencil, Eraser } from 'lucide-react'

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
  const checklistDragRef = useRef<{ itemId: string; from: number } | null>(null)
  // Drawing UI state
  type DrawTool = 'pen' | 'eraser'
  type Point = { x: number; y: number }
  type Stroke = { points: Point[]; color: string; size: number; tool: DrawTool }
  const [drawMode, setDrawMode] = useState(false)
  const [drawTool, setDrawTool] = useState<DrawTool>('pen')
  const [drawColor, setDrawColor] = useState<string>('#22c55e') // emerald-500
  const [drawSize, setDrawSize] = useState<number>(4)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [redoStack, setRedoStack] = useState<Stroke[]>([])
  const [snapToColumn, setSnapToColumn] = useState<boolean>(true)
  const [editDrawingTargetId, setEditDrawingTargetId] = useState<string | null>(null)
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const currStrokeRef = useRef<Stroke | null>(null)

  // Redraw helper for draw overlay
  const redrawDrawCanvas = React.useCallback(() => {
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Clear fully
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Draw committed strokes
    for (const s of strokes) drawStrokePath(ctx, s)
    // Draw current stroke if any
    if (currStrokeRef.current) drawStrokePath(ctx, currStrokeRef.current)
  }, [strokes])

  // Keep canvas in sync when viewport or strokes change
  useEffect(() => {
    if (!drawMode) return
    redrawDrawCanvas()
  }, [drawMode, redrawDrawCanvas])

  // When board size changes while in draw mode, resize canvas backing store
  useEffect(() => {
    if (!drawMode) return
    const c = drawCanvasRef.current
    if (!c) return
    const parent = c.parentElement
    // Use computed board size (style width/height already set); rely on props below too
    // Here we ensure the backing store matches the styled size for crisp lines
    const rect = { w: Math.max(1, Math.round(c.clientWidth)), h: Math.max(1, Math.round(c.clientHeight)) }
    if (c.width !== rect.w) c.width = rect.w
    if (c.height !== rect.h) c.height = rect.h
    redrawDrawCanvas()
  }, [drawMode, redrawDrawCanvas, items])

  // Exit on Escape while in draw mode
  useEffect(() => {
    if (!drawMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { discardDrawing(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z')) {
        e.preventDefault()
        if (e.shiftKey) redoDrawing()
        else undoDrawing()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode])

  function clearDrawingCanvas() {
    const c = drawCanvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
  }

  function discardDrawing() {
    setDrawMode(false)
    setStrokes([])
    setRedoStack([])
    currStrokeRef.current = null
    drawingRef.current = false
    clearDrawingCanvas()
    setEditDrawingTargetId(null)
  }

  function undoDrawing() {
    if (strokes.length === 0) return
    const next = [...strokes]
    const last = next.pop()!
    setStrokes(next)
    setRedoStack(r => [last, ...r])
    requestAnimationFrame(() => redrawDrawCanvas())
  }
  function redoDrawing() {
    if (redoStack.length === 0) return
    const [first, ...rest] = redoStack
    setRedoStack(rest)
    setStrokes(prev => [...prev, first])
    requestAnimationFrame(() => redrawDrawCanvas())
  }

  async function saveDrawing() {
    if (!id) return
    // Aggregate all points to compute bounding box
    const allPts: Point[] = []
    for (const s of strokes) allPts.push(...s.points)
    if (currStrokeRef.current) allPts.push(...currStrokeRef.current.points)
    if (allPts.length === 0) { discardDrawing(); return }
    const src = drawCanvasRef.current
  if (!src) { discardDrawing(); return }
  const minX = Math.max(0, Math.min(...allPts.map(p => p.x)) - drawSize * 2)
  const minY = Math.max(0, Math.min(...allPts.map(p => p.y)) - drawSize * 2)
  const maxX = Math.min(src.width, Math.max(...allPts.map(p => p.x)) + drawSize * 2)
  const maxY = Math.min(src.height, Math.max(...allPts.map(p => p.y)) + drawSize * 2)
    const w = Math.max(1, Math.round(maxX - minX))
    const h = Math.max(1, Math.round(maxY - minY))
    // Create a cropped canvas
    const crop = document.createElement('canvas')
    crop.width = w
    crop.height = h
    const ctx = crop.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(src, minX, minY, w, h, 0, 0, w, h)
    // Convert to Blob and upload to backend (avoid large data URLs in content)
    const dataUrl = crop.toDataURL('image/png')
    const blob = await (await fetch(dataUrl)).blob()
    let uploadedUrl = ''
    try {
      const up = await uploadBoardImage(blob)
      uploadedUrl = up.url
    } catch (e) {
      // Fallback: if upload fails, still use data URL so user doesn’t lose work
      uploadedUrl = dataUrl
    }
    const vectorStrokes = strokes.map(s => ({ points: s.points, color: s.color, size: s.size, tool: s.tool }))
    const mid = { x: minX + w/2, y: minY + h/2 }
    try {
      // Edit mode: update existing image item with new PNG and vectors, keep x/y unless user wants snap (disabled in edit)
      if (editDrawingTargetId) {
        const existing = items.find(i => i.id === editDrawingTargetId)
        if (existing) {
          const nextContent = { ...(existing.content||{}), url: uploadedUrl, caption: (existing.content?.caption || 'Drawing'), vectorStrokes, vectorBounds: { x: minX, y: minY, w, h } }
          await updateBoardItem(id, existing.id, { x: Math.round(minX), y: Math.round(minY), w, h, content: nextContent } as any)
          setItems(prev => prev.map(it => it.id === existing.id ? { ...it, x: Math.round(minX), y: Math.round(minY), w, h, content: nextContent } : it))
        }
      } else {
      // Optionally attach to a column under the drawing center
      if (snapToColumn) {
        const col = getColumnUnder(mid.x, mid.y)
        if (col) {
          const item = await createBoardItem(id, { type: 'image', x: Math.round(minX), y: Math.round(minY), w, h, content: { url: uploadedUrl, caption: 'Drawing', vectorStrokes, vectorBounds: { x: minX, y: minY, w, h } } as any } as any)
          const withNew = [...items, { ...item, x: mid.x, y: mid.y }]
          const reflow = layoutColumn(col, item.id, withNew)
          setItems(prev => {
            const base = [...prev, item]
            return base.map(it => {
              const r = reflow.find(x => x.id === it.id)
              return r ? { ...it, x: r.x, y: r.y, content: r.content } : it
            })
          })
          for (const r of reflow) { try { await updateBoardItem(id, r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {} }
        } else {
          const item = await createBoardItem(id, { type: 'image', x: Math.round(minX), y: Math.round(minY), w, h, content: { url: uploadedUrl, caption: 'Drawing', vectorStrokes, vectorBounds: { x: minX, y: minY, w, h } } as any } as any)
          setItems(prev => [...prev, item])
        }
      } else {
        const item = await createBoardItem(id, { type: 'image', x: Math.round(minX), y: Math.round(minY), w, h, content: { url: uploadedUrl, caption: 'Drawing', vectorStrokes, vectorBounds: { x: minX, y: minY, w, h } } as any } as any)
        setItems(prev => [...prev, item])
      }
      }
    } catch (e:any) {
      setError(e?.message || 'Save drawing failed')
    } finally {
      discardDrawing()
    }
  }

  // Begin editing an existing image item
  function beginEditDrawing(it: BoardItem) {
    // Populate strokes if available; otherwise start empty
    const vs = (it as any)?.content?.vectorStrokes as Stroke[] | undefined
    setStrokes(Array.isArray(vs) ? vs.map(s => ({ points: s.points || [], color: s.color || drawColor, size: s.size || 4, tool: (s.tool as DrawTool) || 'pen' })) : [])
    setRedoStack([])
    setEditDrawingTargetId(it.id)
    setDrawMode(true)
    setLinkMode(false); setLinkSource(null); setSelectedEdgeId(null)
    // Next frame ensures canvas reflects new strokes
    setTimeout(() => redrawDrawCanvas(), 0)
  }
  // Agent UI state
  const [agentMode, setAgentMode] = useState<'legacy'|'mcp'>(() => ((localStorage.getItem('boards_agent_mode') || 'legacy') as 'legacy'|'mcp'))
  const [agentInput, setAgentInput] = useState('')
  const [agentReply, setAgentReply] = useState<string>('')

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
        const content = { text: (cmd.text ? cmd.text : '') }
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

  // Persist agent mode
  useEffect(() => { try { localStorage.setItem('boards_agent_mode', agentMode) } catch {} }, [agentMode])

  async function saveTitle() {
    if (!id) return
    try { await updateBoard(id, { title }) } catch {}
  }

  async function addNote() {
    if (!id) return
    const item = await createBoardItem(id, { type: 'note', x: 60, y: 60, w: 320, h: 200, content: { text: '' } as any } as any)
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
        const dxBoard = dx / viewport.zoom
        const dyBoard = dy / viewport.zoom
        setItems(prev => {
          const moving = prev.find(i => i.id === id)
          if (!moving) return prev
          // If dragging a column, move all its member items by the same delta
          if (moving.type === 'column') {
            const nextX = Math.max(0, origX + dxBoard)
            const nextY = Math.max(0, origY + dyBoard)
            const deltaX = nextX - moving.x
            const deltaY = nextY - moving.y
            const colId = moving.id
            return prev.map(it => {
              if (it.id === id) return { ...it, x: nextX, y: nextY }
              const memberOfCol = (it as any)?.content?.columnId === colId
              if (memberOfCol) {
                return { ...it, x: it.x + deltaX, y: it.y + deltaY }
              }
              return it
            })
          }
          // Default: dragging a normal item
          return prev.map(it => it.id === id ? { ...it, x: Math.max(0, origX + dxBoard), y: Math.max(0, origY + dyBoard) } : it)
        })
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
        if (it && id) {
          // If a column was moved, persist its new position and that of all member items
          if (it.type === 'column') {
            try { await updateBoardItem(idParam(), id, { x: it.x, y: it.y } as any) } catch {}
            const members = items.filter(m => (m as any)?.content?.columnId === it.id)
            for (const m of members) {
              try { await updateBoardItem(idParam(), m.id, { x: m.x, y: m.y } as any) } catch {}
            }
            return
          }
          // Column snap: if dropped over a column, assign and snap to next slot; if not, clear assignment
          const center = { x: it.x + it.w / 2, y: it.y + it.h / 2 }
          const col = getColumnUnder(center.x, center.y)
          if (col && it.type !== 'column') {
            const prevColId = (it as any)?.content?.columnId as string | undefined
            // Insert into ordered stack by drop Y, then reflow all members
            const reflow = layoutColumn(col, it.id)
            // Update local items
            setItems(prev => prev.map(p => {
              const found = reflow.find(r => r.id === p.id)
              if (found) return { ...p, x: found.x, y: found.y, content: found.content }
              // If this is the moving item and not in reflow (shouldn't happen), at least set columnId
              if (p.id === it.id) return { ...p, content: { ...(p.content||{}), columnId: col.id } }
              return p
            }))
            // Persist positions for all affected
            for (const r of reflow) {
              try { await updateBoardItem(idParam(), r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {}
            }
            // If moved from a different column, reflow the previous column to close gaps
            if (prevColId && prevColId !== col.id) {
              const prevCol = items.find(x => x.id === prevColId)
              if (prevCol && prevCol.type === 'column') {
                const rePrev = layoutColumn(prevCol)
                setItems(prev => prev.map(p => {
                  const r = rePrev.find(x => x.id === p.id)
                  return r ? { ...p, x: r.x, y: r.y, content: r.content } : p
                }))
                for (const r of rePrev) { try { await updateBoardItem(idParam(), r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {} }
              }
            }
          } else {
            // Clear column membership if moved outside
            if ((it as any)?.content?.columnId) {
              const prevColId = (it as any)?.content?.columnId as string
              const nextContent = { ...(it.content||{}) }
              delete (nextContent as any).columnId
              try { await updateBoardItem(idParam(), id, { x: it.x, y: it.y, content: nextContent } as any) } catch {}
              // Reflow the previous column to close gaps
              const prevCol = items.find(x => x.id === prevColId)
              if (prevCol && prevCol.type === 'column') {
                const reflow = layoutColumn(prevCol)
                setItems(prev => prev.map(p => {
                  if (p.id === it.id) return { ...p, content: nextContent }
                  const r = reflow.find(x => x.id === p.id)
                  if (r) return { ...p, x: r.x, y: r.y, content: r.content }
                  return p
                }))
                for (const r of reflow) { try { await updateBoardItem(idParam(), r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {} }
              } else {
                setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: nextContent } : p))
              }
            } else {
              try { await updateBoardItem(idParam(), id, { x: it.x, y: it.y } as any) } catch {}
            }
          }
        }
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
    if (drawMode) return // disable zoom while drawing
    if (!e.ctrlKey) return // only zoom when Ctrl is held to avoid hijacking scroll
    e.preventDefault()
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    zoomAt(Math.exp(-e.deltaY * 0.001), e.clientX - rect.left, e.clientY - rect.top)
  }

  // Column helpers: detect column under a point and compute next stacking slot
  function pointInRect(px: number, py: number, r: { x: number; y: number; w: number; h: number }) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
  }
  function getColumnUnder(x: number, y: number) {
    const cols = items.filter(it => it.type === 'column')
    for (const c of cols) {
      if (pointInRect(x, y, { x: c.x, y: c.y, w: c.w, h: c.h })) return c
    }
    return null
  }
  function getNextSlotInColumn(col: BoardItem, excludingId?: string) {
    const headerH = 48
    const pad = 8
    const members = items
      .filter(it => it.id !== excludingId && (it as any)?.content?.columnId === col.id)
      .sort((a, b) => a.y - b.y)
    let y = col.y + headerH + pad
    for (const m of members) {
      y = Math.max(y, m.y + m.h + pad)
    }
    const x = col.x + pad
    return { x, y }
  }

  // Layout/reflow items inside a column. If movingId is provided, insert by drop center Y.
  function layoutColumn(col: BoardItem, movingId?: string, inItems?: BoardItem[]) {
    const headerH = 48
    const pad = 8
    const base = inItems || items
    const members = base
      .filter(it => it.type !== 'column' && (it as any)?.content?.columnId === col.id && it.id !== movingId)
      .sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
    const result: Array<{ id: string; x: number; y: number; content?: any }> = []
    let ordered: BoardItem[] = [...members]
    if (movingId) {
      const moving = base.find(i => i.id === movingId)
      if (moving) {
        const centerY = moving.y + moving.h / 2
        let insertIdx = ordered.findIndex(m => centerY < (m.y + m.h / 2))
        if (insertIdx === -1) insertIdx = ordered.length
        ordered = [...ordered.slice(0, insertIdx), moving, ...ordered.slice(insertIdx)]
      }
    }
    let y = col.y + headerH + pad
    for (const m of ordered) {
      const x = col.x + pad
      result.push({ id: m.id, x, y, content: { ...(m.content || {}), columnId: col.id } })
      y = y + m.h + pad
    }
    return result
  }

  // Drag & drop from Tools palette
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // Allow drop if payload is our tool type
    if (e.dataTransfer.types.includes('application/x-board-tool') || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault()
    }
  }
  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!id) return
    const type = e.dataTransfer.getData('application/x-board-tool') || e.dataTransfer.getData('text/plain')
    if (!type) return
    e.preventDefault()
    const p = toBoardCoords(e.clientX, e.clientY)
    const base = { x: Math.round(p.x - 160), y: Math.round(p.y - 100) }
    try {
      if (type === 'note') {
        const item = await createBoardItem(id, { type: 'note', ...base, w: 320, h: 200, content: { text: '' } as any } as any)
        const col = getColumnUnder(p.x, p.y)
        if (col) {
          // Insert into column and reflow
          const withNew = [...items, { ...item, x: p.x, y: p.y }]
          const reflow = layoutColumn(col, item.id, withNew)
          setItems(prev => {
            const base = [...prev, item]
            return base.map(it => {
              const r = reflow.find(x => x.id === it.id)
              return r ? { ...it, x: r.x, y: r.y, content: r.content } : it
            })
          })
          // Persist for affected (including new item)
          for (const r of reflow) { try { await updateBoardItem(id, r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {} }
        } else {
          setItems(prev => [...prev, item])
        }
      } else if (type === 'checklist') {
        const item = await createBoardItem(id, { type: 'checklist', ...base, w: 320, h: 200, content: { items: [] } as any } as any)
        const col = getColumnUnder(p.x, p.y)
        if (col) {
          const withNew = [...items, { ...item, x: p.x, y: p.y }]
          const reflow = layoutColumn(col, item.id, withNew)
          setItems(prev => {
            const base = [...prev, item]
            return base.map(it => {
              const r = reflow.find(x => x.id === it.id)
              return r ? { ...it, x: r.x, y: r.y, content: r.content } : it
            })
          })
          for (const r of reflow) { try { await updateBoardItem(id, r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {} }
        } else {
          setItems(prev => [...prev, item])
        }
      } else if (type === 'image') {
        const item = await createBoardItem(id, { type: 'image', ...base, w: 360, h: 240, content: { url: '' } as any } as any)
        const col = getColumnUnder(p.x, p.y)
        if (col) {
          const withNew = [...items, { ...item, x: p.x, y: p.y }]
          const reflow = layoutColumn(col, item.id, withNew)
          setItems(prev => {
            const base = [...prev, item]
            return base.map(it => {
              const r = reflow.find(x => x.id === it.id)
              return r ? { ...it, x: r.x, y: r.y, content: r.content } : it
            })
          })
          for (const r of reflow) { try { await updateBoardItem(id, r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {} }
        } else {
          setItems(prev => [...prev, item])
        }
      } else if (type === 'link') {
        const item = await createBoardItem(id, { type: 'link', ...base, w: 360, h: 120, content: { url: '', title: '' } as any } as any)
        const col = getColumnUnder(p.x, p.y)
        if (col) {
          const withNew = [...items, { ...item, x: p.x, y: p.y }]
          const reflow = layoutColumn(col, item.id, withNew)
          setItems(prev => {
            const base = [...prev, item]
            return base.map(it => {
              const r = reflow.find(x => x.id === it.id)
              return r ? { ...it, x: r.x, y: r.y, content: r.content } : it
            })
          })
          for (const r of reflow) { try { await updateBoardItem(id, r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {} }
        } else {
          setItems(prev => [...prev, item])
        }
      } else if (type === 'group') {
        const item = await createBoardItem(id, { type: 'group', ...base, w: 400, h: 120, content: { title: '' } as any } as any)
        setItems(prev => [...prev, item])
      } else if (type === 'table') {
        const item = await createBoardItem(id, { type: 'table', ...base, w: 520, h: 280, content: { title: '', columns: ['Column 1', 'Column 2'], rows: [['',''],['','']] } as any } as any)
        const col = getColumnUnder(p.x, p.y)
        if (col) {
          const withNew = [...items, { ...item, x: p.x, y: p.y }]
          const reflow = layoutColumn(col, item.id, withNew)
          setItems(prev => prev.map(it => {
            const r = reflow.find(x => x.id === it.id)
            if (r) return { ...it, x: r.x, y: r.y, content: r.content }
            return it
          }))
          for (const r of reflow) { try { await updateBoardItem(id, r.id, { x: r.x, y: r.y, content: r.content } as any) } catch {} }
        } else {
          setItems(prev => [...prev, item])
        }
      } else if (type === 'column') {
        const item = await createBoardItem(id, { type: 'column', ...base, w: 300, h: 480, content: { title: '' } as any } as any)
        setItems(prev => [...prev, item])
      }
    } catch (e:any) {
      setError(e?.message || 'Drop failed')
    }
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
      const item = await createBoardItem(id, { type: 'note', x: Math.round(x - 160), y: Math.round(y - 100), w: 320, h: 200, content: { text: '' } as any } as any)
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

  // Simple Agent chat (supports MCP mode)
  async function sendAgentChat() {
    if (!id) return
    const msg = agentInput.trim()
    if (!msg) return
    setBusy('Agent…')
    try {
      const r = await fetch(`/api/boards/${encodeURIComponent(id)}/ai/chat?mode=${encodeURIComponent(agentMode)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: msg, itemIds: selectedIds })
      })
      if (!r.ok) throw new AppError('router_failed', `Agent chat failed ${r.status}: ${r.statusText}`, await r.text())
      const data = await r.json()
      setAgentReply(data.reply || 'OK')
      setAgentInput('')
      // Optionally refresh board after actions
      try { await load() } catch {}
    } catch (e) {
      const err = e as any
      setAgentReply(err?.message || 'Agent failed')
    } finally { setBusy(null) }
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
          <button onClick={addNote} className="jarvis-btn jarvis-btn-secondary flex items-center gap-1"><StickyNote className="w-4 h-4" /> <span className="hidden sm:inline">Note</span></button>
          {/* PTT voice control */}
          <button
            className={`jarvis-btn ${voice.state==='listening' ? 'jarvis-btn-primary' : 'jarvis-btn-secondary'} flex items-center gap-1`}
            onMouseDown={(e)=>{ e.preventDefault(); voice.startListening() }}
            onMouseUp={(e)=>{ e.preventDefault(); voice.stopAndSend() }}
            onTouchStart={(e)=>{ e.preventDefault(); voice.startListening() }}
            onTouchEnd={(e)=>{ e.preventDefault(); voice.stopAndSend() }}
            title="Hold to talk (Spacebar also works)"
          >{voice.state==='listening' ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}<span className="hidden sm:inline">{voice.state==='listening' ? 'Release to Send' : 'Hold to Talk'}</span></button>
          <div className="text-xs text-slate-400 select-none">
            {voice.state === 'processing' ? 'Processing…' : voice.state === 'speaking' ? 'Speaking…' : ''}
          </div>
          <button
            className="jarvis-btn jarvis-btn-secondary flex items-center gap-1"
            onClick={() => {
              const root = containerRef.current
              if (!root) return
              void exportNodeToPng(root, defaultBoardFileName(title))
            }}
          ><Download className="w-4 h-4" /> <span className="hidden sm:inline">Export PNG</span></button>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Simple canvas */}
        <div
          className="relative rounded-xl bg-slate-900/60 border border-slate-800 min-h-[60vh] overflow-auto"
          onWheel={handleWheel}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
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
            <button className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700" onClick={() => zoomBy(1/1.1)} title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
            <button className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700" onClick={() => zoomBy(1.1)} title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
            <button className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700" onClick={resetZoom} title="Reset zoom"><RefreshCcw className="w-4 h-4" /></button>
            <button className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700" onClick={fitToContent} title="Fit to content"><Maximize2 className="w-4 h-4" /></button>
            <div className="mx-2 text-xs text-slate-300">{Math.round(viewport.zoom * 100)}%</div>
            <button
              className={`px-2 py-1 text-xs rounded border ${linkMode ? 'bg-emerald-700/70 border-emerald-600' : 'bg-slate-800 hover:bg-slate-700 border-slate-700'}`}
              onClick={() => { setLinkMode(v => !v); setLinkSource(null) }}
              title="Link Mode"
            >{linkMode ? <span className="flex items-center gap-1"><Link2 className="w-4 h-4" /> ON</span> : <span className="flex items-center gap-1"><Link2 className="w-4 h-4" /> OFF</span>}</button>
            {selectedEdgeId && (
              <button className="px-2 py-1 text-xs rounded bg-rose-800/70 hover:bg-rose-700 border border-rose-700 ml-2 flex items-center gap-1" onClick={deleteSelectedEdge} title="Delete selected edge"><Unlink className="w-4 h-4" /> Delete Edge</button>
            )}
          </div>
          {/* Floating Tools palette (left side) */}
          <div className="absolute z-10 left-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 bg-slate-950/70 border border-slate-800 rounded-md p-2 backdrop-blur-sm">
            {/* Draw button */}
            <button
              onClick={() => { setDrawMode(true); setLinkMode(false); setLinkSource(null); setSelectedEdgeId(null) }}
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 select-none text-xs"
              title="Enter Draw mode"
            >
              <Pencil className="w-4 h-4 text-emerald-400" /> Draw
            </button>
            <div
              draggable
              onDragStart={(e)=>{ e.dataTransfer.setData('application/x-board-tool', 'note'); e.dataTransfer.effectAllowed = 'copy' }}
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 cursor-grab active:cursor-grabbing select-none text-xs"
              title="Drag onto the canvas to create a Note"
            >
              <StickyNote className="w-4 h-4 text-emerald-400" /> Note
            </div>
            <div
              draggable
              onDragStart={(e)=>{ e.dataTransfer.setData('application/x-board-tool', 'checklist'); e.dataTransfer.effectAllowed = 'copy' }}
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 cursor-grab active:cursor-grabbing select-none text-xs"
              title="Drag onto the canvas to create a Checklist"
            >
              <ListChecks className="w-4 h-4 text-emerald-400" /> Checklist
            </div>
            <div
              draggable
              onDragStart={(e)=>{ e.dataTransfer.setData('application/x-board-tool', 'image'); e.dataTransfer.effectAllowed = 'copy' }}
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 cursor-grab active:cursor-grabbing select-none text-xs"
              title="Drag onto the canvas to create an Image card"
            >
              <ImageIcon className="w-4 h-4 text-emerald-400" /> Image
            </div>
            <div
              draggable
              onDragStart={(e)=>{ e.dataTransfer.setData('application/x-board-tool', 'link'); e.dataTransfer.effectAllowed = 'copy' }}
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 cursor-grab active:cursor-grabbing select-none text-xs"
              title="Drag onto the canvas to create a Link card"
            >
              <Link2 className="w-4 h-4 text-emerald-400" /> Link
            </div>
            <div
              draggable
              onDragStart={(e)=>{ e.dataTransfer.setData('application/x-board-tool', 'group'); e.dataTransfer.effectAllowed = 'copy' }}
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 cursor-grab active:cursor-grabbing select-none text-xs"
              title="Drag onto the canvas to create a Group"
            >
              <Shapes className="w-4 h-4 text-emerald-400" /> Group
            </div>
            <div
              draggable
              onDragStart={(e)=>{ e.dataTransfer.setData('application/x-board-tool', 'table'); e.dataTransfer.effectAllowed = 'copy' }}
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 cursor-grab active:cursor-grabbing select-none text-xs"
              title="Drag onto the canvas to create a Table"
            >
              <TableIcon className="w-4 h-4 text-emerald-400" /> Table
            </div>
            <div
              draggable
              onDragStart={(e)=>{ e.dataTransfer.setData('application/x-board-tool', 'column'); e.dataTransfer.effectAllowed = 'copy' }}
              className="flex items-center gap-2 px-2 py-1 rounded border border-slate-800 bg-slate-900/60 hover:bg-slate-800 cursor-grab active:cursor-grabbing select-none text-xs"
              title="Drag onto the canvas to create a Column"
            >
              <ColumnsIcon className="w-4 h-4 text-emerald-400" /> Column
            </div>
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
                  style={{ left: it.x, top: it.y, width: it.w, height: it.h, zIndex: it.type === 'column' ? 1 : it.type === 'group' ? 2 : 3 }}
                  data-item-id={it.id}
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
                  >
                    <div className="flex items-center gap-1">
                      {it.type === 'note' && <StickyNote className="w-3.5 h-3.5" />}
                      {it.type === 'checklist' && <ListChecks className="w-3.5 h-3.5" />}
                      {it.type === 'image' && <ImageIcon className="w-3.5 h-3.5" />}
                      {it.type === 'link' && <Link2 className="w-3.5 h-3.5" />}
                      {it.type === 'group' && <Shapes className="w-3.5 h-3.5" />}
                      {it.type === 'table' && <TableIcon className="w-3.5 h-3.5" />}
                      {it.type === 'column' && <ColumnsIcon className="w-3.5 h-3.5" />}
                      <span className="capitalize text-slate-400">{it.type}</span>
                    </div>
                  </div>

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
                        <div
                          key={idx}
                          className="flex items-center gap-2"
                          draggable
                          onDragStart={(e)=>{
                            checklistDragRef.current = { itemId: it.id, from: idx }
                            e.dataTransfer.effectAllowed = 'move'
                            // Use a minimal payload to enable drag in all browsers
                            e.dataTransfer.setData('text/plain', 'move')
                          }}
                          onDragOver={(e)=>{ if (checklistDragRef.current?.itemId === it.id) { e.preventDefault() } }}
                          onDrop={async (e)=>{
                            const ref = checklistDragRef.current
                            checklistDragRef.current = null
                            if (!ref || ref.itemId !== it.id) return
                            e.preventDefault()
                            const from = ref.from
                            const to = idx
                            if (from === to) return
                            const arr = [...(it.content?.items||[])]
                            const [moved] = arr.splice(from, 1)
                            arr.splice(to, 0, moved)
                            const next = { ...(it.content||{}), items: arr }
                            setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                            if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                          }}
                        >
                          <span className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-slate-200" title="Drag to reorder"><GripVertical className="w-3.5 h-3.5" /></span>
                          <input type="checkbox" checked={!!ci.done} onChange={async (e)=>{
                            const next = { ...(it.content||{}), items: [...(it.content?.items||[])] }
                            next.items[idx] = { ...next.items[idx], done: e.target.checked }
                            setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                            if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                          }} />
                          <input
                            value={ci.text || ''}
                            onChange={(e)=>{
                              const next = { ...(it.content||{}), items: [...(it.content?.items||[])] }
                              next.items[idx] = { ...next.items[idx], text: e.target.value }
                              setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                            }}
                            onBlur={async()=>{ if (id) { try { await updateBoardItem(id, it.id, { content: it.content }) } catch {} } }}
                            onKeyDown={async (e)=>{
                              if (e.key === 'Escape') {
                                (e.currentTarget as HTMLInputElement).blur()
                                return
                              }
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                const curr = (it.content?.items||[])
                                const nextItems = [...curr.slice(0, idx+1), { text: '', done: false }, ...curr.slice(idx+1)]
                                const next = { ...(it.content||{}), items: nextItems }
                                setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                                if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                                setTimeout(() => {
                                  const root = document.querySelector(`[data-item-id="${it.id}"]`)
                                  if (!root) return
                                  const inputs = root.querySelectorAll('input[data-role="check-text"]')
                                  const el = inputs[idx+1] as HTMLInputElement | undefined
                                  if (el) { try { el.focus() } catch {} }
                                }, 0)
                              }
                            }}
                            className={`flex-1 bg-transparent border ${ci.done? 'border-slate-800 text-slate-400 line-through':'border-slate-700/60'} focus:border-slate-600 rounded px-2 py-1 text-sm outline-none`}
                            placeholder=""
                            data-role="check-text"
                          />
                          <button
                            className="p-1 text-slate-400 hover:text-slate-200"
                            title="Remove item"
                            onClick={async ()=>{
                              const nextItems = [...(it.content?.items||[])]
                              nextItems.splice(idx,1)
                              const next = { ...(it.content||{}), items: nextItems }
                              setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                              if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                            }}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <div className="pt-2">
                        <button
                          className="jarvis-btn jarvis-btn-secondary px-2 py-1 text-xs flex items-center gap-1"
                          onClick={async ()=>{
                            const next = { ...(it.content||{}), items: [...(it.content?.items||[]), { text: '', done: false }] }
                            setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                            if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Add item
                        </button>
                      </div>
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
                    <div className="w-full h-[calc(100%-1.5rem)] flex items-center justify-center bg-slate-900/30 relative" onClick={(e)=> e.stopPropagation()}>
                      {it.content?.url ? (
                        <img src={it.content.url} alt={it.content?.caption || ''} className="max-w-full max-h-full object-contain rounded" />
                      ) : (
                        <div className="text-xs text-slate-500">No image URL</div>
                      )}
                      {isDrawableImageContent(it.content) && (
                        <div className="absolute bottom-2 right-2 flex gap-2">
                          <button
                            className="px-2 py-1 text-[11px] rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200"
                            onClick={(e)=>{ e.stopPropagation(); beginEditDrawing(it) }}
                            title="Edit drawing"
                          >Edit</button>
                        </div>
                      )}
                    </div>
                  )}
                  {it.type === 'group' && (
                    <div className="p-2 text-sm text-slate-200 select-none" onClick={(e)=> e.stopPropagation()}>
                      <input
                        value={it.content?.title || ''}
                        onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: { ...p.content, title: e.target.value } } : p))}
                        onBlur={async () => { if (!id) return; await updateBoardItem(id, it.id, { content: it.content }) }}
                        className="w-full bg-transparent border border-slate-700/60 focus:border-slate-600 rounded px-2 py-1 font-semibold text-slate-100 outline-none"
                        placeholder=""
                      />
                    </div>
                  )}
                  {it.type === 'table' && (
                    <div className="w-full h-[calc(100%-1.5rem)] p-2" onClick={(e)=> e.stopPropagation()}>
                      {/* Table title */}
                      <input
                        value={it.content?.title || ''}
                        onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: { ...p.content, title: e.target.value } } : p))}
                        onBlur={async () => { if (!id) return; await updateBoardItem(id, it.id, { content: it.content }) }}
                        className="w-full bg-transparent border border-slate-700/60 focus:border-slate-600 rounded px-2 py-1 text-sm text-slate-100 outline-none mb-2"
                        placeholder=""
                      />
                      {/* Columns header */}
                      <div className="overflow-auto border border-slate-700 rounded">
                        <div className="min-w-full">
                          <div className="grid" style={{ gridTemplateColumns: `repeat(${(it.content?.columns||[]).length||2}, minmax(120px, 1fr))` }}>
                            {(it.content?.columns || []).map((c:string, ci:number) => (
                              <div key={ci} className="bg-slate-900/60 border-b border-slate-700 p-2 text-xs font-medium text-slate-200 flex items-center gap-2">
                                <input
                                  value={c}
                                  onChange={e => setItems(prev => prev.map(p => {
                                    if (p.id !== it.id) return p
                                    const cols = [...(p.content?.columns||[])]
                                    cols[ci] = e.target.value
                                    return { ...p, content: { ...p.content, columns: cols } }
                                  }))}
                                  onBlur={async () => { if (!id) return; await updateBoardItem(id, it.id, { content: it.content }) }}
                                  className="flex-1 bg-transparent border border-slate-700/60 focus:border-slate-600 rounded px-1 py-0.5 text-xs outline-none"
                                />
                                <button
                                  className="p-1 text-slate-400 hover:text-slate-200"
                                  title="Remove column"
                                  onClick={async ()=>{
                                    const cols = [...(it.content?.columns||[])]
                                    if (cols.length<=1) return
                                    cols.splice(ci,1)
                                    const rows = (it.content?.rows||[]).map((r:string[])=>{ const nr=[...r]; nr.splice(ci,1); return nr })
                                    const next = { ...(it.content||{}), columns: cols, rows }
                                    setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                                    if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                                  }}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                          {/* Rows */}
                          <div className="grid" style={{ gridTemplateColumns: `repeat(${(it.content?.columns||[]).length||2}, minmax(120px, 1fr))` }}>
                            {(it.content?.rows || []).map((row:string[], ri:number) => (
                              (row.length ? row : new Array((it.content?.columns||[]).length||2).fill('')).map((cell:string, ci:number) => (
                                <div key={`${ri}-${ci}`} className="border-t border-slate-800 p-1">
                                  <input
                                    value={cell || ''}
                                    onChange={e => setItems(prev => prev.map(p => {
                                      if (p.id !== it.id) return p
                                      const rows = [...(p.content?.rows||[]).map((r:string[])=>[...r])]
                                      if (!rows[ri]) rows[ri] = []
                                      rows[ri][ci] = e.target.value
                                      return { ...p, content: { ...p.content, rows } }
                                    }))}
                                    onBlur={async () => { if (!id) return; await updateBoardItem(id, it.id, { content: it.content }) }}
                                    className="w-full bg-transparent border border-slate-700/60 focus:border-slate-600 rounded px-1 py-1 text-xs outline-none"
                                  />
                                </div>
                              ))
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          className="jarvis-btn jarvis-btn-secondary px-2 py-1 text-xs flex items-center gap-1"
                          onClick={async ()=>{
                            const cols = (it.content?.columns||[])
                            const rows = [ ...(it.content?.rows||[]) , new Array(cols.length||2).fill('') ]
                            const next = { ...(it.content||{}), rows }
                            setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                            if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Row
                        </button>
                        <button
                          className="jarvis-btn jarvis-btn-secondary px-2 py-1 text-xs flex items-center gap-1"
                          onClick={async ()=>{
                            const cols = [ ...(it.content?.columns||[]), `Column ${(it.content?.columns||[]).length+1}` ]
                            const rows = (it.content?.rows||[]).map((r:string[])=>[...r, ''])
                            const next = { ...(it.content||{}), columns: cols, rows }
                            setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: next } : p))
                            if (id) { try { await updateBoardItem(id, it.id, { content: next }) } catch {} }
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Column
                        </button>
                      </div>
                    </div>
                  )}
                  {it.type === 'column' && (
                    <div className="w-full h-[calc(100%-1.5rem)] p-2 select-none" onClick={(e)=> e.stopPropagation()}>
                      <input
                        value={it.content?.title || ''}
                        onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: { ...p.content, title: e.target.value } } : p))}
                        onBlur={async () => { if (!id) return; await updateBoardItem(id, it.id, { content: it.content }) }}
                        className="w-full bg-slate-900/60 border border-slate-700 focus:border-slate-600 rounded px-2 py-1 text-sm text-slate-100 outline-none mb-2"
                        placeholder=""
                      />
                      <div className="flex-1 h-full rounded border border-slate-800 bg-slate-950/40 p-2 text-xs text-slate-400">
                        This is a visual column. Drag and position cards over it to group them.
                      </div>
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

          {/* Drawing overlay inside the canvas container */}
          {drawMode && (
            <>
              {/* Darken the board area */}
              <div className="absolute inset-0 z-20 bg-black/60" />
              {/* Canvas for drawing (aligned to board transform) */}
              <div
                className="absolute inset-0 z-30"
                onPointerDown={(e) => {
                  // Allow pen, mouse, or touch
                  e.preventDefault()
                  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                  const p = toBoardCoords(e.clientX, e.clientY)
                  drawingRef.current = true
                  const stroke: Stroke = { points: [p], color: drawColor, size: drawSize, tool: drawTool }
                  currStrokeRef.current = stroke
                  // starting a new stroke clears redo stack
                  setRedoStack([])
                  requestAnimationFrame(() => redrawDrawCanvas())
                }}
                onPointerMove={(e) => {
                  if (!drawingRef.current || !currStrokeRef.current) return
                  e.preventDefault()
                  const p = toBoardCoords(e.clientX, e.clientY)
                  currStrokeRef.current.points.push(p)
                  requestAnimationFrame(() => redrawDrawCanvas())
                }}
                onPointerUp={() => {
                  if (!drawingRef.current || !currStrokeRef.current) return
                  drawingRef.current = false
                  setStrokes(prev => [...prev, currStrokeRef.current as Stroke])
                  currStrokeRef.current = null
                  requestAnimationFrame(() => redrawDrawCanvas())
                }}
                onPointerCancel={() => {
                  if (!drawingRef.current || !currStrokeRef.current) return
                  drawingRef.current = false
                  setStrokes(prev => [...prev, currStrokeRef.current as Stroke])
                  currStrokeRef.current = null
                  requestAnimationFrame(() => redrawDrawCanvas())
                }}
                style={{ cursor: drawTool === 'pen' ? 'crosshair' : 'cell', touchAction: 'none' as any }}
              >
                <div
                  className="relative"
                  style={{ width: boardSize.w, height: boardSize.h, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, transformOrigin: '0 0' }}
                >
                  <canvas ref={drawCanvasRef} width={Math.max(1, Math.round(boardSize.w))} height={Math.max(1, Math.round(boardSize.h))} style={{ width: boardSize.w, height: boardSize.h }} />
                </div>
              </div>
              {/* Bottom customization bar */}
              <div className="absolute left-0 right-0 bottom-0 z-40">
                <div className="m-3 rounded-lg border border-slate-800 bg-slate-950/85 backdrop-blur-sm p-3 flex flex-wrap items-center gap-3">
                  <div className="text-xs text-slate-300 mr-1">{editDrawingTargetId ? 'Edit Drawing' : 'Draw'}</div>
                  <div className="flex items-center gap-1">
                    <button
                      className={`px-2 py-1 text-xs rounded border ${drawTool==='pen' ? 'bg-emerald-700/70 border-emerald-600' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'}`}
                      onClick={()=>setDrawTool('pen')}
                      title="Pen"
                    >
                      <span className="inline-flex items-center gap-1"><Pencil className="w-4 h-4" /> Pen</span>
                    </button>
                    <button
                      className={`px-2 py-1 text-xs rounded border ${drawTool==='eraser' ? 'bg-emerald-700/70 border-emerald-600' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'}`}
                      onClick={()=>setDrawTool('eraser')}
                      title="Eraser"
                    >
                      <span className="inline-flex items-center gap-1"><Eraser className="w-4 h-4" /> Eraser</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <label className="text-xs text-slate-300">Color</label>
                    <input type="color" value={drawColor} onChange={e=>setDrawColor(e.target.value)} className="h-7 w-9 p-0 bg-transparent border border-slate-700 rounded" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-300">Size</label>
                    <input type="range" min={1} max={24} value={drawSize} onChange={e=>setDrawSize(parseInt(e.target.value))} />
                    <span className="text-xs text-slate-400 w-6 text-right">{drawSize}</span>
                  </div>
                  {!editDrawingTargetId && (
                    <label className="flex items-center gap-2 ml-2 text-xs text-slate-300">
                      <input type="checkbox" checked={snapToColumn} onChange={e=>setSnapToColumn(e.target.checked)} /> Snap to column on save
                    </label>
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    <button className="jarvis-btn jarvis-btn-secondary" onClick={undoDrawing} disabled={strokes.length===0}>Undo</button>
                    <button className="jarvis-btn jarvis-btn-secondary" onClick={redoDrawing} disabled={redoStack.length===0}>Redo</button>
                    <button className="jarvis-btn jarvis-btn-secondary" onClick={()=>{ setStrokes([]); setRedoStack([]); currStrokeRef.current=null; redrawDrawCanvas() }}>Clear</button>
                    <button className="jarvis-btn jarvis-btn-secondary" onClick={discardDrawing}>{editDrawingTargetId ? 'Cancel' : 'Discard'}</button>
                    <button className="jarvis-btn jarvis-btn-primary" onClick={saveDrawing}>{editDrawingTargetId ? 'Update' : 'Save'}</button>
                  </div>
                </div>
              </div>
            </>
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
          {/* Agent Panel (Legacy vs MCP) */}
          <div className="pt-1 border-t border-slate-800" />
          <div className="text-sm font-medium flex items-center justify-between">
            <span>Board Agent</span>
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="agentmode" checked={agentMode==='legacy'} onChange={()=>setAgentMode('legacy')} /> Legacy
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="agentmode" checked={agentMode==='mcp'} onChange={()=>setAgentMode('mcp')} /> MCP
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <input
              value={agentInput}
              onChange={e=>setAgentInput(e.target.value)}
              onKeyDown={(e)=>{ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); void sendAgentChat() } }}
              placeholder={agentMode==='mcp' ? 'Ask the MCP agent…' : 'Ask the agent…'}
              className="w-full bg-slate-950/40 border border-slate-800 focus:border-slate-700 rounded px-2 py-1 text-sm outline-none"
            />
            <div className="flex gap-2">
              <button onClick={sendAgentChat} className="jarvis-btn jarvis-btn-secondary flex-1">Send</button>
            </div>
            {agentReply && (
              <div className="text-xs text-slate-300 bg-slate-950/40 border border-slate-800 rounded p-2 whitespace-pre-wrap">
                {agentReply}
              </div>
            )}
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
          <div className="text-xs text-slate-500">Tips: Drag tools onto the canvas to create cards. Hold Shift to multi-select items. Ctrl+Wheel to zoom. Space+Drag to pan. Use Link Mode to connect notes.</div>
        </div>
      </div>
    </div>
  )
}

// Helper: draw all strokes + current onto the draw canvas
export function drawStrokePath(ctx: CanvasRenderingContext2D, stroke: { points: {x:number;y:number}[]; color: string; size: number; tool: 'pen'|'eraser' }) {
  const pts = stroke.points
  if (!pts.length) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, stroke.size)
  ctx.strokeStyle = stroke.color
  const prevOp = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
  ctx.globalCompositeOperation = prevOp
}

// Helper to decide whether an image item is editable as a drawing
export function isDrawableImageContent(content: any): boolean {
  try {
    const vs = content?.vectorStrokes
    return Array.isArray(vs) && vs.length > 0
  } catch { return false }
}
