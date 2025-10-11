import { useEffect, useState } from 'react'
import { storage } from '../lib/storage'

type Bookmark = { id: string; at: number; label?: string; transcript?: string }

export default function Bookmarks() {
  const [items, setItems] = useState<Bookmark[]>([])
  useEffect(()=>{
    setItems(storage.get('jarvis_bookmarks_v1', []))
  }, [])
  function clearAll() {
    if (!confirm('Clear all bookmarks?')) return
    storage.set('jarvis_bookmarks_v1', [])
    setItems([])
  }
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="jarvis-title mb-4">Bookmarks</h1>
      <div className="flex justify-end mb-3">
        <button className="jarvis-btn" onClick={clearAll}>Clear All</button>
      </div>
      <div className="space-y-3">
        {items.length === 0 && <div className="jarvis-subtle text-sm">No bookmarks yet.</div>}
        {items.map(b => (
          <div key={b.id} className="jarvis-card p-3">
            <div className="text-sm font-medium">{b.label || 'Bookmark'}</div>
            <div className="text-xs jarvis-subtle">{new Date(b.at).toLocaleString()}</div>
            {b.transcript && <div className="text-sm mt-2 whitespace-pre-wrap">{b.transcript}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
