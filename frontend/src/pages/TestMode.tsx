import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getStudySet, type StudySet, type McqQuestion } from '../lib/api'
import { sendToRouter } from '../lib/api'

export default function TestMode() {
  const { id } = useParams()
  const [setData, setSetData] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [answers, setAnswers] = useState<Array<{ index: number; selected: number | null; answerIndex: number; correct: boolean; skipped?: boolean }>>([])
  // Completion modal + AI feedback
  const [showFinishModal, setShowFinishModal] = useState(false)
  const [aiMessage, setAiMessage] = useState<string>('')

  // Settings (persisted)
  const [showSettings, setShowSettings] = useState(false)
  const [timerEnabled, setTimerEnabled] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('test_timer_enabled') || 'false') } catch { return false }
  })
  const [timerSeconds, setTimerSeconds] = useState<number>(() => {
    const v = Number(localStorage.getItem('test_timer_seconds') || '20')
    return Number.isFinite(v) ? Math.max(5, Math.min(120, Math.round(v))) : 20
  })
  const [autoSkipOnTimeout, setAutoSkipOnTimeout] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('test_auto_skip_on_timeout') || 'true') } catch { return true }
  })
  const [allowSkip, setAllowSkip] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('test_allow_skip') || 'true') } catch { return true }
  })

  useEffect(() => { try { localStorage.setItem('test_timer_enabled', JSON.stringify(timerEnabled)) } catch {} }, [timerEnabled])
  useEffect(() => { try { localStorage.setItem('test_timer_seconds', String(timerSeconds)) } catch {} }, [timerSeconds])
  useEffect(() => { try { localStorage.setItem('test_auto_skip_on_timeout', JSON.stringify(autoSkipOnTimeout)) } catch {} }, [autoSkipOnTimeout])
  useEffect(() => { try { localStorage.setItem('test_allow_skip', JSON.stringify(allowSkip)) } catch {} }, [allowSkip])

  // Timer state
  const [secondsLeft, setSecondsLeft] = useState<number>(timerSeconds)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
    if (id) getStudySet(id).then(s => { if (mounted) setSetData(s) }).catch(e => setError(e?.message || 'Load failed'))
    return () => { mounted = false }
  }, [id])

  const questions: McqQuestion[] = useMemo(() => setData?.content?.test || [], [setData])
  
  // Check if this test was created from a study guide
  const linkedStudyGuideId = useMemo(() => {
    try {
      const links = JSON.parse(localStorage.getItem('test-study-links') || '{}')
      return links[id] || null
    } catch {
      return null
    }
  }, [id])
  
  const current = questions[idx]

  // Manage per-question timer lifecycle
  useEffect(() => {
    // Clear any previous interval
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (!timerEnabled || finished || !current) return
    // Reset timer at the start of each question
    setSecondsLeft(timerSeconds)
    // If we're currently showing feedback, don't run timer
    if (answered) return
    timerRef.current = window.setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          // Time's up
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          // Handle timeout: prefer skip if enabled, otherwise submit if user selected something
          // Guard against race if already answered/finished
          if (!finished && !answered) {
            if (autoSkipOnTimeout) {
              skipQuestion(true)
            } else {
              if (selected != null) {
                submit()
              } else {
                // Count as incorrect (not marked skipped)
                skipQuestion(false)
              }
            }
          }
          return 0
        }
        return prev - 1
      })
    }, 1000) as unknown as number

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, timerEnabled, timerSeconds, finished, answered, current])

  function submit() {
    if (current == null || selected == null) return
    const correct = selected === current.answerIndex
    if (correct) setScore(s => s + 1)
    setAnswers(prev => [...prev, { index: idx, selected, answerIndex: current.answerIndex, correct }])
    setAnswered(true)
    // After brief delay, advance to next
    setTimeout(() => {
      const next = idx + 1
      if (next >= questions.length) {
        setFinished(true)
      } else {
        setIdx(next)
        setSelected(null)
        setAnswered(false)
        setSecondsLeft(timerSeconds)
      }
    }, 700)
  }

  function skipQuestion(markSkipped = true) {
    if (!current) return
    if (markSkipped) {
      setAnswers(prev => [...prev, { index: idx, selected: null, answerIndex: current.answerIndex, correct: false, skipped: true }])
    }
    const next = idx + 1
    if (next >= questions.length) {
      setFinished(true)
    } else {
      setIdx(next)
      setSelected(null)
      setAnswered(false)
      setSecondsLeft(timerSeconds)
    }
  }

  function retake() {
    setIdx(0)
    setSelected(null)
    setAnswered(false)
    setScore(0)
    setFinished(false)
    setAnswers([])
    setShowFinishModal(false)
    setAiMessage('')
    // reset timer
    setSecondsLeft(timerSeconds)
  }

  // When finished flips to true, prepare the AI message and open modal
  useEffect(() => {
    if (!finished) return
    const total = questions.length || 0
    const correct = score
    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0
    const fallbackGood = `Nice job! You got a ${correct}/${total}! Keep up the great work and keep challenging yourself.`
    const fallbackBad = `Dang... you got a ${correct}/${total}. Keep practicing so you can get better! Focus on the questions you missed and try again.`
    const fallback = correct >= Math.ceil(total * 0.6) ? fallbackGood : fallbackBad
    setAiMessage(fallback)
    setShowFinishModal(true)

    // Try to get an AI-generated encouragement; ignore errors and keep fallback
    ;(async () => {
      try {
        const prompt = `The student just completed a short multiple-choice practice test.
Topic: ${setData?.title || setData?.subject || 'Unknown'}
Total questions: ${total}
Correct: ${correct}
Incorrect: ${Math.max(0, total - correct)}
Score percent: ${percentage}%

Write a short, encouraging one- to two-sentence message tailored to their result. Be friendly and motivating. Avoid mentioning percentages explicitly unless helpful.`
        const r = await sendToRouter(prompt, { userId: 'study-feedback' })
        if (r.reply) setAiMessage(r.reply)
      } catch {}
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  if (!id) return null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3 relative">
        <Link to={`/study/sets/${id}`} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Back</Link>
        <div className="font-medium">Test Mode</div>
        {linkedStudyGuideId && (
          <Link 
            to={`/study/sets/${linkedStudyGuideId}`} 
            className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm"
            title="View source study guide"
          >
            📚 Study Guide
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="text-sm text-slate-300">{questions.length} questions</div>
          <button onClick={() => setShowSettings(s=>!s)} className="px-3 py-1.5 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Settings</button>
        </div>
        {showSettings && (
          <div className="absolute top-full right-4 mt-2 w-[360px] rounded-lg border border-slate-800 bg-slate-900/95 p-4 shadow-xl z-10">
            <div className="text-sm font-medium mb-3 text-slate-200">Test Settings</div>
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Enable timer per question</span>
                <input type="checkbox" className="h-4 w-4" checked={timerEnabled} onChange={e=>setTimerEnabled(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Seconds per question</span>
                <input type="number" min={5} max={120} value={timerSeconds} onChange={e=> setTimerSeconds(() => {
                  const v = Number(e.target.value)
                  return Number.isFinite(v) ? Math.max(5, Math.min(120, Math.round(v))) : 20
                })} className="w-24 rounded border border-slate-700 bg-slate-800 p-1.5 text-right" />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Auto-skip on timeout</span>
                <input type="checkbox" className="h-4 w-4" checked={autoSkipOnTimeout} onChange={e=>setAutoSkipOnTimeout(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Allow manual skip</span>
                <input type="checkbox" className="h-4 w-4" checked={allowSkip} onChange={e=>setAllowSkip(e.target.checked)} />
              </label>
            </div>
          </div>
        )}
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      {finished ? (
        <div className="p-8 max-w-4xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
            <div className="text-center mb-6">
              <div className="text-2xl font-semibold mb-1">Test complete</div>
              <div className="text-slate-300 mb-2">Score: {score} / {questions.length}</div>
              <div className="flex gap-2 justify-center">
                <button onClick={retake} className="px-4 py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white">Retake Test</button>
                <Link to={`/study/sets/${id}`} className="px-4 py-2.5 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300">Back to Set</Link>
              </div>
            </div>
            {/* Review list */}
            <div className="mt-6 grid gap-4">
              {questions.map((q, i) => {
                const rec = answers.find(a => a.index === i)
                const userSel = rec?.selected
                const isCorrect = rec?.correct
                const skipped = rec?.skipped || false
                return (
                  <div key={i} className={[
                    'rounded-xl border p-4',
                    isCorrect ? 'border-emerald-400/40 bg-emerald-400/10' : skipped ? 'border-slate-600/60 bg-slate-800/60' : 'border-rose-400/40 bg-rose-400/10'
                  ].join(' ')}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="font-semibold text-slate-100">Q{i+1}. {q.question}</div>
                        <div className="mt-2 grid gap-1 text-sm">
                          <div className="text-slate-300">
                            <span className="text-slate-400">Your answer: </span>
                            {skipped ? (
                              <span className="italic text-slate-400">Skipped</span>
                            ) : (
                              <span className={isCorrect ? 'text-emerald-300' : 'text-rose-300'}>
                                {userSel != null ? `${String.fromCharCode(65 + userSel)}. ${q.choices[userSel]}` : '—'}
                              </span>
                            )}
                          </div>
                          {!isCorrect && (
                            <div className="text-slate-300">
                              <span className="text-slate-400">Correct answer: </span>
                              <span className="text-emerald-300">{String.fromCharCode(65 + q.answerIndex)}. {q.choices[q.answerIndex]}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isCorrect ? (
                          <span className="inline-flex items-center rounded-md bg-emerald-500/20 text-emerald-300 px-2 py-1 text-xs font-medium">Correct</span>
                        ) : skipped ? (
                          <span className="inline-flex items-center rounded-md bg-slate-500/20 text-slate-300 px-2 py-1 text-xs font-medium">Skipped</span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-rose-500/20 text-rose-300 px-2 py-1 text-xs font-medium">Incorrect</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : current ? (
        <div className="p-8 max-w-3xl mx-auto">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-blue-300/20 to-cyan-300/10 p-8 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="text-slate-300">Question {idx+1} of {questions.length}</div>
              <div className="flex items-center gap-4">
                {timerEnabled && (
                  <div className="flex items-center gap-2 text-slate-300">
                    <div className="w-40 h-2 bg-slate-800 rounded overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / timerSeconds) * 100))}%` }} />
                    </div>
                    <span className="font-mono tabular-nums">{secondsLeft}s</span>
                  </div>
                )}
                <div className="text-slate-300">Score: <span className="font-semibold">{score}</span></div>
              </div>
            </div>
            <div className="text-slate-100 font-semibold text-2xl mb-5 leading-snug">{current.question}</div>
            <div className="grid gap-3">
              {current.choices.map((ch, i) => {
                const isSel = selected === i
                const isCorrect = answered && i === current.answerIndex
                const isWrong = answered && isSel && !isCorrect
                return (
                  <button key={i}
                    onClick={() => !answered && setSelected(i)}
                    className={[
                      'text-left rounded-lg px-4 py-3 border transition-colors',
                      isCorrect ? 'bg-emerald-100/40 border-emerald-300 text-emerald-900' :
                      isWrong ? 'bg-rose-100/40 border-rose-300 text-rose-900' :
                      isSel ? 'bg-white/95 text-slate-900 border-slate-300' : 'bg-slate-900/60 border-slate-800 text-slate-200'
                    ].join(' ')}
                  >
                    <span className="mr-2 font-mono">{String.fromCharCode(65+i)}.</span> {ch}
                  </button>
                )
              })}
            </div>
            <div className="mt-6 flex gap-3">
              <button disabled={selected==null || answered} onClick={submit} className="px-4 py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white">Submit</button>
              {allowSkip && (
                <button onClick={() => skipQuestion(true)} className="px-4 py-2.5 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300">Skip</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 text-slate-400 text-lg">No test questions in this set.</div>
      )}

      {/* Finish modal */}
      {showFinishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={()=>setShowFinishModal(false)} />
          <div className="relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
            <div className="text-center">
              <div className="text-3xl font-bold mb-2">{score >= Math.ceil((questions.length||0)*0.6) ? 'Nice Job! 🎉' : 'Keep Going! 💪'}</div>
              <div className="text-slate-300 mb-3">You got {score}/{questions.length}.</div>
              <div className="text-slate-200 whitespace-pre-line">{aiMessage}</div>
            </div>
            <div className="mt-6 flex gap-3 justify-center">
              <button onClick={retake} className="px-4 py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white">Retake Test</button>
              <Link to={`/study/sets/${id}`} className="px-4 py-2.5 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300">Back to Set</Link>
              <button onClick={()=>setShowFinishModal(false)} className="px-4 py-2.5 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Timer effect: run after main component so it has access to state
// Note: We define it outside component body? No, hooks must be inside. Instead, augment component with an effect.
