import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

export default function QuizJoinPage() {
  const { roomId: roomIdParam } = useParams()
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [userId] = useState(() => 'user-' + Math.random().toString(36).slice(2, 8))
  const [name, setName] = useState('Player')
  const [roomId, setRoomId] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const [started, setStarted] = useState(false)
  const [current, setCurrent] = useState(0)
  const [question, setQuestion] = useState<any>(null)
  const [answer, setAnswer] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [leaderboard, setLeaderboard] = useState<Array<{id:string,name:string,score:number,gold?:number,lives?:number,eliminated?:boolean}>>([])
  const [mode, setMode] = useState<'classic'|'gold'|'royale'>('classic')
  const navigate = useNavigate()

  useEffect(() => {
    if (!roomId) return
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${scheme}://${window.location.host}/ws/quiz`
    const wsClient = new WebSocket(wsUrl)
    setWs(wsClient)
    wsClient.onopen = () => {
      wsClient.send(JSON.stringify({ type: 'join', roomId, userId, name }))
    }
    wsClient.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'joined') {
        setJoined(true)
        if (msg.mode) setMode(msg.mode)
      } else if (msg.type === 'start') {
        setStarted(true)
        setCurrent(msg.current)
        setQuestion(msg.question)
        setAnswer(null)
        setEndsAt(msg.endsAt || null)
      } else if (msg.type === 'next') {
        setCurrent(msg.current)
        setQuestion(msg.question)
        setAnswer(null)
        setEndsAt(msg.endsAt || null)
      } else if (msg.type === 'end') {
        setDone(true)
        setLeaderboard(msg.leaderboard || [])
      }
      if (msg.type === 'reveal') {
        setLeaderboard(msg.leaderboard || [])
      }
    }
    wsClient.onerror = () => alert('WebSocket error')
    return () => { wsClient.close() }
  }, [roomId, userId, name, navigate])

  useEffect(() => {
    if (roomIdParam) setRoomId(roomIdParam)
  }, [roomIdParam])

  function handleAnswer(idx: number) {
    if (answer !== null) return
    setAnswer(idx)
    if (ws && roomId) ws.send(JSON.stringify({ type: 'answer', roomId, userId, answerIndex: idx }))
  }

  const timeLeft = useMemo(() => {
    if (!endsAt) return null
    const diff = Math.max(0, Math.floor((endsAt - Date.now()) / 1000))
    return diff
  }, [endsAt])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">Join Quiz</h1>
          <Link to="/shared" className="jarvis-btn">Back</Link>
        </div>
        {!roomId && (
          <div className="rounded bg-slate-900/50 p-3">
            <div className="mb-2">Enter Room Code to Join</div>
            <input className="jarvis-input mb-2" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" />
            <div className="flex gap-2">
              <input className="jarvis-input" placeholder="Room code" onKeyDown={(e)=>{ if (e.key==='Enter') setRoomId((e.target as HTMLInputElement).value.trim()) }} />
              <button className="jarvis-btn jarvis-btn-primary" onClick={()=>{
                const el = document.querySelector<HTMLInputElement>('.jarvis-input:nth-of-type(2)')
                if (el) setRoomId(el.value.trim())
              }}>Join</button>
            </div>
          </div>
        )}
        {roomId && !joined && <div>Joining…</div>}
        {started && question && !done && (
          <div className="mt-6">
            <div className="text-lg font-semibold mb-2">Q{current+1}: {question.question}</div>
            {timeLeft !== null && <div className="text-xs text-slate-400 mb-2">Time left: {timeLeft}s</div>}
            <ul className="list-disc ml-4">
              {question.choices.map((ch: string, i: number) => (
                <li key={i}>
                  <button className={`jarvis-btn ${answer===i ? 'jarvis-btn-primary' : ''}`} disabled={answer!==null} onClick={()=>handleAnswer(i)}>{String.fromCharCode(65+i)}. {ch}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {done && (
          <div className="mt-6">
            <div className="text-lg font-semibold mb-2 text-cyan-300">Quiz complete!</div>
            <div className="text-sm mb-2">Leaderboard</div>
            <ul className="ml-4 list-decimal">
              {leaderboard.map((p)=> (
                <li key={p.id}>{p.name}: <b>{p.score}</b></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
