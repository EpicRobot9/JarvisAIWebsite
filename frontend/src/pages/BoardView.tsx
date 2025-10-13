import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getBoard, updateBoard, createBoardItem, updateBoardItem, deleteBoardItem, createBoardEdge, deleteBoardEdge, aiStructureBoard, aiSummarizeSelection, aiDiagramFromSelection, aiFlashcardsFromSelection, type BoardItem, type BoardEdge } from '../lib/api'

export default function BoardView() {
  const { id } = useParams()
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<BoardItem[]>([])
  const [edges, setEdges] = useState<BoardEdge[]>([])
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!id) return
    try {
      const r = await getBoard(id)
      setTitle(r.board.title || 'Untitled')
      setItems(r.items)
      setEdges(r.edges)
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to="/boards" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Boards</Link>
        <input value={title} onChange={e=>setTitle(e.target.value)} onBlur={saveTitle} className="px-3 py-2 rounded-md bg-slate-900/60 border border-slate-800 text-sm outline-none focus:border-slate-700 flex-1" />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={addNote} className="jarvis-btn jarvis-btn-secondary">+ Note</button>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Simple canvas */}
        <div className="relative rounded-xl bg-slate-900/60 border border-slate-800 min-h-[60vh] overflow-auto">
          {loading && <div className="p-4 text-slate-400">Loading…</div>}
          {!loading && (
            <div className="relative">
              {items.map(it => (
                <div key={it.id} className={`absolute rounded-md border ${sel[it.id] ? 'border-emerald-400' : 'border-slate-700'} bg-slate-800/60 hover:border-slate-600`}
                     style={{ left: it.x, top: it.y, width: it.w, height: it.h }}
                     onClick={() => setSel(s => ({ ...s, [it.id]: !s[it.id] }))}
                >
                  {it.type === 'note' && (
                    <textarea value={it.content?.text || ''} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, content: { ...p.content, text: e.target.value } } : p))}
                              onBlur={async () => { if (!id) return; await updateBoardItem(id!, it.id, { content: it.content }) }}
                              className="w-full h-full bg-transparent text-slate-200 text-sm p-2 outline-none" />
                  )}
                  {it.type !== 'note' && (
                    <div className="p-2 text-xs text-slate-300">{it.type}</div>
                  )}
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
          <div className="text-xs text-slate-400">Selection: {selectedIds.length} items</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={doSummarize} disabled={selectedIds.length===0} className="jarvis-btn jarvis-btn-secondary">Summarize → Note</button>
            <button onClick={doDiagram} disabled={selectedIds.length===0} className="jarvis-btn jarvis-btn-secondary">Diagram (Mermaid)</button>
            <button onClick={doFlashcards} disabled={selectedIds.length===0} className="jarvis-btn jarvis-btn-secondary col-span-2">Create Flashcards</button>
          </div>
          <div className="text-xs text-slate-500">Tip: Hold Shift to select multiple, then run actions.</div>
        </div>
      </div>
    </div>
  )
}
