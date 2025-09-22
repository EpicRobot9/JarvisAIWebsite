import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteStudySet, getStudySet, type StudySet } from '../lib/api'
import Markdown from '../components/ui/Markdown'

export default function StudySetView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [setData, setSetData] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    if (id) getStudySet(id).then(s => { if (mounted) setSetData(s) }).catch(e => setError(e?.message || 'Failed to load'))
    return () => { mounted = false }
  }, [id])

  const has = useMemo(() => ({
    guide: !!setData?.content?.guide,
    flashcards: !!setData?.content?.flashcards?.length,
    test: !!setData?.content?.test?.length,
    match: !!setData?.content?.match?.length,
  }), [setData])

  if (!id) return null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to="/study" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Back</Link>
        <div className="font-medium">{setData?.title || 'Study Set'}</div>
        <div className="ml-auto flex items-center gap-2">
          <button className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm" onClick={async () => { if (!id) return; try { await deleteStudySet(id); navigate('/study') } catch (e:any) { setError(e?.message || 'Delete failed') } }}>Delete</button>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      {!setData && <div className="p-6 text-slate-400">Loading…</div>}
      {setData && (
        <div className="p-6 space-y-6">
          {has.guide && (
            <div>
              <div className="text-slate-300 font-semibold mb-2">Study Guide</div>
              <div className="prose prose-invert max-w-3xl">
                <Markdown content={setData.content.guide!} prefs={{ icon: 'triangle', color: 'slate', expandAll: false, expandCategories: false }} />
              </div>
            </div>
          )}

          {has.flashcards && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-slate-300 font-semibold">Flashcards</div>
                <Link to={`/study/sets/${id}/flashcards`} className="text-blue-400 hover:text-blue-300">Play game</Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {setData.content.flashcards!.map((c, idx) => (
                  <div key={idx} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                    <div className="text-sm text-slate-300 font-medium">{c.front}</div>
                    <div className="text-xs text-slate-400 mt-1">{c.back}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {has.test && (
            <div>
              <div className="text-slate-300 font-semibold mb-2">Practice Test (multiple choice)</div>
              <div className="space-y-3">
                {setData.content.test!.map((q, i) => (
                  <div key={i} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                    <div className="text-sm text-slate-300 mb-1">{i+1}. {q.question}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {q.choices.map((ch, idx) => (
                        <label key={idx} className="text-sm text-slate-300 flex items-center gap-2">
                          <input type="radio" name={`q-${i}`} /> {String.fromCharCode(65+idx)}. {ch}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {has.match && (
            <div>
              <div className="text-slate-300 font-semibold mb-2">Match Pairs</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="space-y-2">
                  {setData.content.match!.map((p, i) => (
                    <div key={i} className="rounded-md border border-slate-800 bg-slate-950/40 p-2 text-sm">{p.left}</div>
                  ))}
                </div>
                <div className="space-y-2">
                  {setData.content.match!.map((p, i) => (
                    <div key={i} className="rounded-md border border-slate-800 bg-slate-950/40 p-2 text-sm">{p.right}</div>
                  ))}
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-2">Drag-and-drop matching can be added later.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
