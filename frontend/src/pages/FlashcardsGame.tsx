import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getStudySet, gradeFlashcard, type StudySet, type Flashcard } from '../lib/api'

export default function FlashcardsGame() {
  const { id } = useParams()
  const [setData, setSetData] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idx, setIdx] = useState(0)
  const [answer, setAnswer] = useState('')
  const [timeLimit, setTimeLimit] = useState(20)
  const [timeLeft, setTimeLeft] = useState(20)
  const [score, setScore] = useState(0)
  const [result, setResult] = useState<{ correct: boolean; explanation?: string } | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
    if (id) getStudySet(id).then(s => { if (mounted) { setSetData(s); resetTimer() } }).catch(e => setError(e?.message || 'Load failed'))
    return () => { mounted = false; if (timerRef.current) window.clearInterval(timerRef.current) }
  }, [id])

  const cards: Flashcard[] = useMemo(() => setData?.content?.flashcards || [], [setData])
  const current = cards[idx]
  // Check if these flashcards were created from a study guide
  const linkedStudyGuideId = useMemo(() => {
    try {
      const links = JSON.parse(localStorage.getItem('flashcard-study-links') || '{}')
      return links[id as string] || null
    } catch {
      return null
    }
  }, [id])

  function resetTimer() {
    setTimeLeft(timeLimit)
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          window.clearInterval(timerRef.current!)
          onSubmit() // auto-submit as empty (will be incorrect)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function onSubmit() {
    if (!current) return
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
    try {
      const r = await gradeFlashcard({ front: current.front, expectedBack: current.back, userAnswer: answer.trim() })
      setResult(r)
      if (r.correct) setScore(s => s + 1)
    } catch (e:any) {
      setError(e?.message || 'Grading failed')
    }
  }

  function nextCard() {
    setResult(null)
    setAnswer('')
    const next = idx + 1
    if (next >= cards.length) {
      // End of deck; wrap to start
      setIdx(0)
    } else {
      setIdx(next)
    }
    resetTimer()
  }

  if (!id) return null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to={`/study/sets/${id}/enhanced`} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Back</Link>
        <div className="font-medium">Flashcards Game</div>
        {linkedStudyGuideId && (
          <Link 
            to={`/study/sets/${linkedStudyGuideId}/enhanced`} 
            className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm"
            title="View source study guide"
          >
            📚 Study Guide
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-300">
          <label className="flex items-center gap-2"><span>Time limit</span>
            <input type="number" min={5} max={120} value={timeLimit} onChange={e => { const v = Math.max(5, Math.min(120, Number(e.target.value)||20)); setTimeLimit(v); setTimeLeft(v) }} className="w-20 bg-slate-900/60 border border-slate-800 rounded px-2 py-1 outline-none" />
            <span>sec</span>
          </label>
          <div className="ml-4">Score: <span className="font-semibold">{score}</span></div>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      {!current && <div className="p-6 text-slate-400">No flashcards in this set.</div>}
      {current && (
        <div className="p-6 max-w-2xl mx-auto">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6">
            <div className="text-slate-300 font-semibold text-lg mb-2">{current.front}</div>
            <div className="text-xs text-slate-400 mb-4">Time left: {timeLeft}s</div>
            <input
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !result) onSubmit() }}
              placeholder="Type your answer"
              className="w-full text-sm bg-slate-950/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700"
            />
            {!result ? (
              <div className="mt-3 flex gap-2">
                <button onClick={onSubmit} className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm">Submit</button>
                <button onClick={nextCard} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Skip</button>
              </div>
            ) : (
              <div className={`mt-3 text-sm rounded p-3 border ${result.correct ? 'bg-emerald-950/40 border-emerald-900 text-emerald-300' : 'bg-red-950/40 border-red-900 text-red-300'}`}>
                {result.correct ? 'Correct! +1 point.' : 'Not quite.'}
                {result.explanation && <div className="mt-1 text-slate-300">{result.explanation}</div>}
                <div className="mt-1 text-slate-400">Expected: <span className="text-slate-200">{current.back}</span></div>
                <div className="mt-3">
                  <button onClick={nextCard} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Next</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
