import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

export default function SharedSetViewPage() {
  const { id } = useParams()
  const [set, setSet] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const r = await fetch(`/api/study/shared/${encodeURIComponent(id || '')}`)
        if (!r.ok) throw new Error('Failed to load shared set')
        const json = await r.json()
        if (!mounted) return
        setSet(json.set || null)
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Error')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [id])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">Shared Study Set</h1>
          <Link to="/shared" className="jarvis-btn">Back to Shared</Link>
        </div>
        {loading && <div>Loading…</div>}
        {error && <div className="text-red-300">{error}</div>}
        {!loading && !error && set && (
          <div className="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-3">
            <div className="font-semibold text-cyan-200 mb-2">{set.title}</div>
            <div className="text-xs text-slate-400 mb-2">{set.subject || 'No subject'}</div>
            <div className="text-xs text-slate-400 mb-2">Source: {set.sourceText?.slice(0, 120) || 'N/A'}{set.sourceText?.length > 120 ? '…' : ''}</div>
            {set.content?.test && set.content.test.length > 0 && (
              <div className="mb-3">
                <Link to={`/quiz/host/${encodeURIComponent(set.id)}`} className="jarvis-btn jarvis-btn-primary">Host Quiz</Link>
              </div>
            )}
            <div className="mt-3">
              {set.content?.guide && (
                <div className="mb-3">
                  <div className="text-sm text-cyan-300 mb-1">Guide</div>
                  <div className="prose prose-sm prose-invert" dangerouslySetInnerHTML={{ __html: set.content.guide.replace(/\n/g, '<br/>') }} />
                </div>
              )}
              {set.content?.flashcards && set.content.flashcards.length > 0 && (
                <div className="mb-3">
                  <div className="text-sm text-cyan-300 mb-1">Flashcards</div>
                  <ul className="list-disc ml-4">
                    {set.content.flashcards.map((c: any, i: number) => (
                      <li key={i}><b>{c.front}</b>: {c.back}</li>
                    ))}
                  </ul>
                </div>
              )}
              {set.content?.test && set.content.test.length > 0 && (
                <div className="mb-3">
                  <div className="text-sm text-cyan-300 mb-1">Test Questions</div>
                  <ul className="list-decimal ml-4">
                    {set.content.test.map((q: any, i: number) => (
                      <li key={i}><b>{q.question}</b> <span className="text-xs text-slate-400">Choices: {q.choices?.join(', ')}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {set.content?.match && set.content.match.length > 0 && (
                <div className="mb-3">
                  <div className="text-sm text-cyan-300 mb-1">Match Pairs</div>
                  <ul className="list-disc ml-4">
                    {set.content.match.map((p: any, i: number) => (
                      <li key={i}><b>{p.left}</b> ↔ {p.right}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
