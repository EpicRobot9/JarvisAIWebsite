import { useState, useRef } from 'react'
import { generateStudySet } from '../lib/api'

export default function ImportPage() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File|null>(null)
  const [ocr, setOcr] = useState(false)
  const [analyze, setAnalyze] = useState(true)
  const [preview, setPreview] = useState<string>('')
  const [meta, setMeta] = useState<any>(null)
  const [source, setSource] = useState<string>('')
  const [analysis, setAnalysis] = useState<any>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function handleImportUrl() {
    if (!url.trim()) return
    setBusy(true)
    setStatus('Fetching and extracting…')
    try {
      const r = await fetch('/api/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url })
      })
      if (!r.ok) throw new Error(`Import failed ${r.status}`)
      const data = await r.json()
      setStatus('Generating study set…')
      const set = await generateStudySet({ subject: data.title || url, info: data.text || '' })
      window.location.href = `/study/sets/${encodeURIComponent(set.id)}`
    } catch (e) {
      setStatus((e as any)?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleImportFile() {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    setBusy(true)
    setStatus(`Extracting ${ext?.toUpperCase() || 'file'}…`)
    setPreview('')
    setMeta(null)
    setSource('')
    setAnalysis(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (ocr) form.append('ocr', 'true')
      if (!analyze) form.append('analyze', 'false')
      const r = await fetch('/api/import/file', { method: 'POST', credentials: 'include', body: form })
      if (!r.ok) throw new Error(`Import failed ${r.status}`)
      const data = await r.json()
      setSource(data.source || (ext || '').toUpperCase())
      setMeta(data.meta || null)
      setAnalysis(data.analysis || null)
      const rawText: string = data.text || ''
      setPreview(rawText.slice(0, 1200))
      setStatus('Generating study set…')
      const set = await generateStudySet({ subject: data.title || file.name, info: rawText })
      window.location.href = `/study/sets/${encodeURIComponent(set.id)}`
    } catch (e) {
      setStatus((e as any)?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="jarvis-title mb-4">Import from URL, PDF, DOCX, PPTX</h1>
      <div className="grid gap-2 mb-3">
        <label className="text-xs">URL</label>
        <input className="jarvis-input" placeholder="https://example.com/article" value={url} onChange={e=>setUrl(e.target.value)} disabled={busy} />
        <button className="jarvis-btn jarvis-btn-primary" disabled={busy || !url.trim()} onClick={handleImportUrl}>Import URL → Study Set</button>
      </div>
      <div className="grid gap-2 mb-3">
        <label className="text-xs">Document File (PDF / DOCX / PPTX)</label>
        <input type="file" accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,.ppt,.pptx,.docx" ref={fileInput} disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)} />
        <div className="flex flex-col gap-1 text-xs">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={ocr} disabled={busy} onChange={e=>setOcr(e.target.checked)} /> OCR for low-text PDFs
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={analyze} disabled={busy} onChange={e=>setAnalyze(e.target.checked)} /> Deep analysis (sections / tables / flashcards)
          </label>
        </div>
        <button className="jarvis-btn jarvis-btn-primary" disabled={busy || !file} onClick={handleImportFile}>Import File → Study Set</button>
        <p className="text-[11px] opacity-70 leading-snug">
          • Analysis extracts headings, simple tables, and Term: Definition pairs (up to 50).<br/>
          • Disable analysis for faster ingest on very large documents.<br/>
          • OCR rasterizes up to first 15 pages if embedded text sparse.
        </p>
      </div>
      {status && <div className="text-sm jarvis-subtle mt-3">{status}</div>}
      {preview && (
        <div className="mt-4 p-3 bg-black/30 rounded border border-white/10">
          <div className="flex justify-between mb-1 text-[11px] uppercase tracking-wide opacity-70">
            <span>Preview</span>
            {source && <span>{source}</span>}
          </div>
          <pre className="whitespace-pre-wrap text-xs max-h-60 overflow-auto">{preview}</pre>
          {meta && (
            <div className="mt-2 text-[11px] opacity-70 space-y-1">
              {meta.pdfParseError && <div>pdf-parse error (fallback flows applied)</div>}
              {meta.ocrApplied && <div>OCR applied ({meta.ocrPages} pages{meta.ocrPagesTruncated ? `; +${meta.ocrPagesTruncated} skipped` : ''})</div>}
              {meta.ocrAttempted && !meta.ocrApplied && <div>OCR attempted but produced no text</div>}
              {meta.ocrSkipped && <div>OCR skipped: {meta.ocrSkipped}</div>}
              {meta.canvasUnavailable && <div>Canvas unavailable: raster OCR disabled</div>}
              {meta.removedRepeating && <div>Removed {meta.removedRepeating} repeating header/footer lines</div>}
              {meta.truncated && <div>Text truncated for length.</div>}
            </div>
          )}
          {analysis && (
            <div className="mt-4 text-[11px] space-y-2">
              {analysis.sections && analysis.sections.length > 0 && (
                <details className="bg-black/20 p-2 rounded">
                  <summary className="cursor-pointer">Sections ({analysis.sections.length})</summary>
                  <ul className="list-disc ml-4 mt-1 space-y-1 max-h-40 overflow-auto">
                    {analysis.sections.slice(0,25).map((s:any,i:number)=>(<li key={i}>{s.heading}</li>))}
                  </ul>
                </details>
              )}
              {analysis.tables && analysis.tables.length > 0 && (
                <details className="bg-black/20 p-2 rounded">
                  <summary className="cursor-pointer">Tables ({analysis.tables.length})</summary>
                  <pre className="mt-1 whitespace-pre-wrap max-h-32 overflow-auto">{analysis.tables.slice(0,2).map((t:any)=>t.snippet).join('\n---\n')}</pre>
                </details>
              )}
              {analysis.flashcards && analysis.flashcards.length > 0 && (
                <details className="bg-black/20 p-2 rounded">
                  <summary className="cursor-pointer">Flashcard Suggestions ({analysis.flashcards.length})</summary>
                  <ul className="list-disc ml-4 mt-1 space-y-1 max-h-40 overflow-auto">
                    {analysis.flashcards.slice(0,30).map((f:any,i:number)=>(<li key={i}><strong>{f.front}:</strong> {f.back}</li>))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
