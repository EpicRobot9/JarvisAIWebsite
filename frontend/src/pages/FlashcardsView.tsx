import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getStudySet, type StudySet, type Flashcard } from '../lib/api'

export default function FlashcardsView() {
  const { id } = useParams()
  const [setData, setSetData] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let mounted = true
    if (id) getStudySet(id).then(s => { if (mounted) setSetData(s) }).catch(e => setError(e?.message || 'Failed to load'))
    return () => { mounted = false }
  }, [id])

  const cards: Flashcard[] = useMemo(() => setData?.content?.flashcards || [], [setData])

  // Check if these flashcards were created from a study guide
  const linkedStudyGuideId = useMemo(() => {
    try {
      const links = JSON.parse(localStorage.getItem('flashcard-study-links') || '{}')
      return links[id] || null
    } catch {
      return null
    }
  }, [id])

  if (!id) return null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
  <Link to={`/study/sets/${id}/enhanced`} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Back</Link>
        <div className="font-medium">{setData?.title || 'Flash Cards'}</div>
        {linkedStudyGuideId && (
          <Link 
            to={`/study/sets/${linkedStudyGuideId}`} 
            className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm"
            title="View source study guide"
          >
            📚 Study Guide
          </Link>
        )}
        <div className="ml-auto">
          <Link to={`/study/sets/${id}/flashcards`} className="px-3 py-2 rounded-md bg-pink-600 hover:bg-pink-500 text-white text-sm">Study Mode</Link>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      <div className="p-6 max-w-5xl mx-auto">
        <div className="text-slate-300 font-semibold mb-3">{cards.length} cards</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((c, i) => (
            <button
              key={i}
              onClick={()=>setRevealed(r=>({...r, [i]: !r[i]}))}
              className={`relative h-48 [perspective:1000px] rounded-2xl border border-white/10 bg-transparent text-left`}
            >
              <div className={`absolute inset-0 rounded-2xl transition-transform duration-500 [transform-style:preserve-3d] ${revealed[i] ? '[transform:rotateY(180deg)]' : ''}`}>
                <div className="absolute inset-0 rounded-2xl bg-slate-900/70 p-5 flex flex-col justify-between [backface-visibility:hidden]">
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Question {i+1}</div>
                    <div className="text-slate-100 font-medium line-clamp-5">{c.front}</div>
                  </div>
                  <div className="text-slate-400 text-sm">Click to reveal answer</div>
                </div>
                <div className="absolute inset-0 rounded-2xl bg-slate-800/80 p-5 [transform:rotateY(180deg)] [backface-visibility:hidden] flex flex-col justify-between">
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Answer {i+1}</div>
                    <div className="text-slate-100 line-clamp-5">{c.back}</div>
                  </div>
                  <div className="text-slate-400 text-sm">Click to show question</div>
                </div>
              </div>
            </button>
          ))}
          {cards.length === 0 && (
            <div className="text-sm text-slate-500">No cards in this set.</div>
          )}
        </div>
      </div>
    </div>
  )
}
