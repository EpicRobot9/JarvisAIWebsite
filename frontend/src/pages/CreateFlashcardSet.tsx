import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { generateStudySet } from '../lib/api'

export default function CreateFlashcardSet() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [count, setCount] = useState(15)
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate')
  const [types, setTypes] = useState<{ definitions: boolean; concepts: boolean; examples: boolean; comparisons: boolean; applications: boolean }>({ definitions: true, concepts: true, examples: false, comparisons: false, applications: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(() => !!content.trim() && !loading, [content, loading])

  async function onGenerate() {
    if (!canSubmit) return
    setLoading(true); setError(null)
    try {
      // Encode preferences into instructions for the backend prompt
      const prefsLines = [
        `flashcards_count: ${count}`,
        `difficulty: ${difficulty}`,
        `types: ${Object.entries(types).filter(([,v])=>v).map(([k])=>k).join(', ') || 'any'}`,
        name ? `set_title: ${name}` : ''
      ].filter(Boolean)
      const info = `${prefsLines.join('\n')}\n\n${content.trim()}`
      const set = await generateStudySet({ title: name || undefined, info, tools: ['flashcards'] })
      navigate(`/study/sets/${set.id}`)
    } catch (e:any) {
      setError(e?.message || 'Failed to generate flashcards')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to="/study" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Back to Study</Link>
        <div className="font-medium">Create Flash Card Set</div>
      </div>

      <div className="p-6 max-w-3xl mx-auto">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Flash Card Set Name:</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., Biology Chapter 5" className="w-full text-sm bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none" />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Content Source:</label>
            <select className="w-full text-sm bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none" value="manual" onChange={()=>{}}>
              <option value="manual">Manual Text Input</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Paste your study content:</label>
            <textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="Paste content or notes here" className="w-full h-48 text-sm bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Number of Flash Cards to Generate:</label>
              <select value={count} onChange={e=>setCount(Number(e.target.value))} className="w-full text-sm bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none">
                {[10,12,15,20,25,30].map(n => <option key={n} value={n}>{n} cards</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Difficulty Level:</label>
              <select value={difficulty} onChange={e=>setDifficulty(e.target.value as any)} className="w-full text-sm bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none">
                <option value="beginner">Beginner - Basic recall</option>
                <option value="intermediate">Intermediate - Detailed understanding</option>
                <option value="advanced">Advanced - Critical application</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">Flash Card Types:</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
              <Checkbox label="Definitions" checked={types.definitions} onChange={v=>setTypes(t=>({...t, definitions: v}))} />
              <Checkbox label="Concepts" checked={types.concepts} onChange={v=>setTypes(t=>({...t, concepts: v}))} />
              <Checkbox label="Examples" checked={types.examples} onChange={v=>setTypes(t=>({...t, examples: v}))} />
              <Checkbox label="Comparisons" checked={types.comparisons} onChange={v=>setTypes(t=>({...t, comparisons: v}))} />
              <Checkbox label="Applications" checked={types.applications} onChange={v=>setTypes(t=>({...t, applications: v}))} />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={onGenerate} disabled={!canSubmit} className={`px-4 py-2 rounded-md ${canSubmit ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}>
              {loading ? 'Generating…' : 'Generate Flash Cards'}
            </button>
            <button onClick={()=>window.alert('Preview not implemented')} className="px-4 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300">Preview Content</button>
          </div>

          {error && <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}
        </div>
      </div>
    </div>
  )
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v:boolean)=>void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} />
      <span className="text-slate-300">{label}</span>
    </label>
  )
}
