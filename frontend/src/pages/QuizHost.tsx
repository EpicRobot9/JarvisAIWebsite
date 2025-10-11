import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

export default function QuizHostPage() {
  const { setId } = useParams()
  const [roomId, setRoomId] = useState<string>('')
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [started, setStarted] = useState(false)
  const [current, setCurrent] = useState(0)
  const [question, setQuestion] = useState<any>(null)
  const [reveal, setReveal] = useState<{correctIndex:number, counts:number[]} | null>(null)
  const [answered, setAnswered] = useState(0)
  const [total, setTotal] = useState(1)
  const [leaderboard, setLeaderboard] = useState<Array<{id:string,name:string,score:number,gold?:number,lives?:number,eliminated?:boolean}>>([])
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [questionTime, setQuestionTime] = useState<number>(30)
  const [mode, setMode] = useState<'classic'|'gold'|'royale'>('classic')
  const [goldSteal, setGoldSteal] = useState<number>(20) // percent
  const [royaleLives, setRoyaleLives] = useState<number>(3)
  const [summaryRoom, setSummaryRoom] = useState<string | null>(null)
  const [userId] = useState(() => 'host-' + Math.random().toString(36).slice(2, 8))
  const navigate = useNavigate()

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${scheme}://${window.location.host}/ws/quiz`
    const wsClient = new WebSocket(wsUrl)
    setWs(wsClient)
    wsClient.onopen = () => {
      wsClient.send(JSON.stringify({ type: 'host', setId, userId, name: 'Host', options: { questionTime, mode, goldStealChance: Math.max(0, Math.min(1, goldSteal/100)), royaleLives } }))
    }
    wsClient.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'room') {
        setRoomId(msg.roomId)
        setQuestionTime(msg.questionTime || 30)
        if (msg.options?.goldStealChance != null) setGoldSteal(Math.round((msg.options.goldStealChance || 0)*100))
        if (msg.options?.royaleLives != null) setRoyaleLives(Number(msg.options.royaleLives || 3))
      } else if (msg.type === 'start') {
        setStarted(true)
        setCurrent(msg.current)
        setQuestion(msg.question)
        setEndsAt(msg.endsAt || null)
        setReveal(null)
      } else if (msg.type === 'progress') {
        setAnswered(msg.answered)
        setTotal(msg.total)
      } else if (msg.type === 'next') {
        setCurrent(msg.current)
        setQuestion(msg.question)
        setEndsAt(msg.endsAt || null)
        setAnswered(0)
        setReveal(null)
      } else if (msg.type === 'end') {
        setLeaderboard(msg.leaderboard || [])
        setQuestion(null)
        setEndsAt(null)
        setStarted(false)
        setSummaryRoom(msg.roomId || roomId)
      }
      if (msg.type === 'reveal') {
        setLeaderboard(msg.leaderboard || [])
        setReveal({ correctIndex: msg.correctIndex, counts: msg.counts || [] })
      }
      if (msg.type === 'state') {
        setTotal((msg.participants || []).length || 1)
        if (msg.mode) setMode(msg.mode)
      }
    }
    wsClient.onerror = () => alert('WebSocket error')
    return () => { wsClient.close() }
  }, [setId, userId, navigate])

  function handleStart() {
    if (ws && roomId) ws.send(JSON.stringify({ type: 'start', roomId, userId }))
  }

  function handleNext() {
    if (ws && roomId) ws.send(JSON.stringify({ type: 'next', roomId, userId }))
  }

  const timeLeft = useMemo(() => {
    if (!endsAt) return null
    const diff = Math.max(0, Math.floor((endsAt - Date.now()) / 1000))
    return diff
  }, [endsAt])

  // tick per second so countdown updates
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x)=>x+1), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">Host Quiz</h1>
          <Link to="/shared" className="jarvis-btn">Back</Link>
        </div>
        <div className="rounded bg-slate-900/50 p-3 mb-4 text-sm">
          <div className="mb-1">Room Code: <b className="text-cyan-300">{roomId || '…'}</b></div>
          {roomId && <div className="mb-1">Join Link: <code className="text-xs">{`${window.location.origin}/quiz/join/${roomId}`}</code></div>}
          <div>Participants: <b>{total}</b></div>
          <div>Mode: <b className="text-cyan-300">{mode==='classic'?'Classic': mode==='gold'?'Gold Quest':'Battle Royale'}</b></div>
        </div>
        {!started && (
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-slate-400">Question time (s)</label>
            <input type="number" min={5} max={120} className="jarvis-input w-24" value={questionTime}
              onChange={e=>setQuestionTime(Math.max(5, Math.min(120, Number(e.target.value)||30)))} />
            <label className="text-xs text-slate-400">Mode</label>
            <select className="jarvis-input" value={mode} onChange={e=> setMode(e.target.value as any)}>
              <option value="classic">Classic</option>
              <option value="gold">Gold Quest</option>
              <option value="royale">Battle Royale</option>
            </select>
            {mode==='gold' && (
              <>
                <label className="text-xs text-slate-400">Steal %</label>
                <input type="number" min={0} max={100} className="jarvis-input w-20" value={goldSteal}
                  onChange={e=> setGoldSteal(Math.max(0, Math.min(100, Number(e.target.value)||0)))} />
              </>
            )}
            {mode==='royale' && (
              <>
                <label className="text-xs text-slate-400">Lives</label>
                <input type="number" min={1} max={9} className="jarvis-input w-20" value={royaleLives}
                  onChange={e=> setRoyaleLives(Math.max(1, Math.min(9, Number(e.target.value)||3)))} />
              </>
            )}
            <button className="jarvis-btn jarvis-btn-primary" onClick={handleStart} disabled={!roomId}>Start Quiz</button>
          </div>
        )}
        {started && question && (
          <div className="mt-6">
            <div className="text-lg font-semibold mb-2">Q{current+1}: {question.question}</div>
            {timeLeft !== null && <div className="text-xs text-slate-400 mb-2">Time left: {timeLeft - (tick%1000===-1?0:0)}s</div>}
            <div className="text-xs text-slate-400 mb-2">Answered: {answered}/{total}</div>
            <ul className="list-disc ml-4">
              {question.choices.map((ch: string, i: number) => (
                <li key={i}>{String.fromCharCode(65+i)}. {ch}</li>
              ))}
            </ul>
            <div className="mt-3">
              <button className="jarvis-btn" onClick={handleNext}>Next</button>
            </div>
          </div>
        )}
        {reveal && (
          <div className="mt-4 rounded bg-slate-900/50 p-3">
            <div className="text-sm text-cyan-300 mb-1">Reveal</div>
            <div className="text-xs text-slate-400 mb-2">Correct Answer: <b>{String.fromCharCode(65 + reveal.correctIndex)}</b></div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {question?.choices?.map((ch:string, i:number)=> (
                <div key={i} className={`rounded p-2 ${i===reveal.correctIndex? 'bg-emerald-900/30 text-emerald-300' : 'bg-slate-800/40'}`}>
                  {String.fromCharCode(65+i)}. {ch}
                  <div className="text-[10px] text-slate-400">Votes: {reveal.counts?.[i] || 0}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!started && leaderboard.length > 0 && (
          <div className="mt-6">
            <div className="text-lg font-semibold mb-2">Leaderboard</div>
            <ul className="ml-4 list-decimal">
              {leaderboard.map((p, i)=> (
                <li key={p.id}>
                  {p.name}: <b>{p.score}</b>
                  {mode==='gold' && <span className="text-xs text-amber-300"> • gold: {p.gold}</span>}
                  {mode==='royale' && <span className="text-xs text-red-300"> • lives: {p.lives ?? 0}{p.eliminated? ' (out)':''}</span>}
                </li>
              ))}
            </ul>
            {summaryRoom && (
              <div className="mt-2 text-xs">
                Post-game summary: <a className="text-cyan-300 underline" href={`/quiz/summary/${encodeURIComponent(summaryRoom)}`} onClick={(e)=>{ e.preventDefault(); window.open(`/quiz/summary/${encodeURIComponent(summaryRoom)}`,'_blank')}}>Open</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
