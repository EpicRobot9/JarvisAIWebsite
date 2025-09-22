import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getNotesSettings, saveNotesSettings, type NotesPrefs } from '../lib/api'

export default function NotesSettings() {
  const [prefs, setPrefs] = useState<NotesPrefs>({ instructions: '', collapsible: true, categories: true, icon: 'triangle', color: 'slate', expandAll: false, expandCategories: false, fontSize: 'medium', responseLength: 'medium' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true
    getNotesSettings().then(p => { if (mounted) setPrefs(p) }).catch(e => setError((e as any)?.message || 'Failed to load settings'))
    return () => { mounted = false }
  }, [])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await saveNotesSettings(prefs)
      navigate('/notes')
    } catch (e) {
      setError((e as any)?.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
          <Link to="/notes" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">← Back to Notes</Link>
          <span className="text-slate-400 text-sm">Notes Settings</span>
        </div>
        <div className="p-6">
          {error && <div className="mb-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}
          <form onSubmit={onSave} className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Custom instructions to the AI</label>
              <textarea
                value={prefs.instructions}
                onChange={e => setPrefs(p => ({ ...p, instructions: e.target.value }))}
                className="w-full h-40 bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700 text-sm"
                placeholder="Example: Use headings, bullet points, a short summary first, then action items with owners and due dates. Use categories like Engineering, Product, Decisions."
              />
              <p className="text-xs text-slate-500 mt-1">These instructions will be included with the summarize request.</p>
            </div>
            <div className="flex items-center gap-6">
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <input type="checkbox" checked={prefs.categories} onChange={e => setPrefs(p => ({ ...p, categories: e.target.checked }))} />
                Group into categories
              </label>
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <input type="checkbox" checked={prefs.collapsible} onChange={e => setPrefs(p => ({ ...p, collapsible: e.target.checked }))} />
                Use collapsible sections (details/summary)
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Summary icon</label>
                <select value={prefs.icon || 'triangle'} onChange={e => setPrefs(p => ({ ...p, icon: e.target.value as any }))} className="w-full bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700 text-sm">
                  <option value="triangle">Triangle</option>
                  <option value="chevron">Chevron</option>
                  <option value="plusminus">Plus/Minus</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Summary color</label>
                <select value={prefs.color || 'slate'} onChange={e => setPrefs(p => ({ ...p, color: e.target.value as any }))} className="w-full bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700 text-sm">
                  <option value="slate">Slate</option>
                  <option value="blue">Blue</option>
                  <option value="emerald">Emerald</option>
                  <option value="amber">Amber</option>
                  <option value="rose">Rose</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Notes font size</label>
                <select value={prefs.fontSize || 'medium'} onChange={e => setPrefs(p => ({ ...p, fontSize: e.target.value as any }))} className="w-full bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700 text-sm">
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">AI response length</label>
                <select value={prefs.responseLength || 'medium'} onChange={e => setPrefs(p => ({ ...p, responseLength: e.target.value as any }))} className="w-full bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700 text-sm">
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long (detailed)</option>
                </select>
              </div>
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <input type="checkbox" checked={!!prefs.expandAll} onChange={e => setPrefs(p => ({ ...p, expandAll: e.target.checked }))} />
                Expand all sections by default
              </label>
              <label className="text-sm text-slate-300 flex items-center gap-2">
                <input type="checkbox" checked={!!prefs.expandCategories} onChange={e => setPrefs(p => ({ ...p, expandCategories: e.target.checked }))} />
                Expand top-level categories
              </label>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm">{saving ? 'Saving…' : 'Save Settings'}</button>
              <Link to="/notes" className="px-4 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Cancel</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
