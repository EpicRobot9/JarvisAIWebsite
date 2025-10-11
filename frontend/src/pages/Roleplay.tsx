import React, { useEffect, useMemo, useRef, useState } from 'react'
import { listRoleplayScenarios, roleplayNext, type RoleplayMessage, type RoleplayScenario } from '../lib/api'
import { Link } from 'react-router-dom'
import { useCallSession } from '../hooks/useCallSession'

export default function RoleplayPage() {
  const [scenarios, setScenarios] = useState<RoleplayScenario[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<RoleplayMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ summary?: string; scores?: Array<{ criterion?: string; score?: number; notes?: string }> } | null>(null)
  const [voiceMode, setVoiceMode] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const r = await listRoleplayScenarios()
        if (!mounted) return
        setScenarios(r.items || [])
        if (r.items?.length && !scenarioId) setScenarioId(r.items[0].id)
      } catch (e) {
        console.warn('Failed to load scenarios', e)
      }
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    try {
      listRef.current?.scrollTo({ top: 999999, behavior: 'smooth' })
    } catch {}
  }, [messages])

  const scenario = useMemo(() => scenarios.find(s => s.id === scenarioId), [scenarios, scenarioId])

  function reset() {
    setMessages([])
    setFeedback(null)
    setActiveSessionId(null)
  }

  async function send() {
    const text = input.trim()
    if (!text || !scenarioId) return
    setInput('')
    setMessages(m => [...m, { role: 'user', content: text }])
    setLoading(true)
    try {
      const { reply, feedback } = await roleplayNext({ scenarioId, sessionId: activeSessionId || undefined, messages: [{ role: 'user', content: text }, ...messages], assess: true })
      setMessages(m => [...m, { role: 'assistant', content: reply }])
      setFeedback(feedback || null)
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: 'Sorry, I had trouble responding. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  // Voice integration via modular call session
  const call = useCallSession({
    userId: undefined,
    sessionId: useMemo(()=> crypto.randomUUID(), []),
    customProcess: async (text: string) => {
      setMessages(m => [...m, { role: 'user', content: text }])
      const { reply, feedback } = await roleplayNext({ scenarioId, sessionId: activeSessionId || undefined, messages: [{ role: 'user', content: text }, ...messages], assess: true })
      setMessages(m => [...m, { role: 'assistant', content: reply }])
      setFeedback(feedback || null)
      return reply
    },
    onTranscript: ()=>{},
    onReply: ()=>{},
  })

  async function ensureSession() {
    if (activeSessionId) return
    try {
      const r = await fetch('/api/roleplay/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ scenarioId }) })
      if (r.ok) {
        const data = await r.json()
        setActiveSessionId(data.session?.id || null)
      }
    } catch {}
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="jarvis-title">Role‑play Simulator</h1>
        <Link to="/study" className="text-sm text-slate-300 hover:text-white">Back to Study</Link>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-1 rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <div className="text-sm text-slate-300 mb-2">Scenario</div>
          <select value={scenarioId} onChange={e=>{ setScenarioId(e.target.value); reset() }} className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-sm">
            {scenarios.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
          {scenario && (
            <p className="text-xs text-slate-400 mt-3 whitespace-pre-wrap">{scenario.description}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={reset} className="px-3 py-2 text-sm rounded-lg bg-slate-800/80 border border-white/10 hover:bg-slate-700/60">Reset</button>
            <button onClick={()=>setVoiceMode(v=>!v)} className={`px-3 py-2 text-sm rounded-lg border ${voiceMode? 'bg-emerald-600/80 border-emerald-400/30' : 'bg-slate-800/80 border-white/10'}`}>{voiceMode? 'Voice: ON' : 'Voice: OFF'}</button>
            <button onClick={async ()=>{
              await ensureSession()
              try {
                const id = activeSessionId
                if (!id) return
                const r = await fetch(`/api/roleplay/sessions/${id}/export`, { method: 'POST', credentials: 'include' })
                if (r.ok) alert('Saved to Study Set!')
              } catch {}
            }} className="px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500">Save to Study Set</button>
          </div>

          <div className="mt-6 border-t border-white/10 pt-4">
            <div className="text-sm font-medium mb-2">Create custom scenario</div>
            <CustomScenarioForm onCreated={(s)=> setScenarios(prev=>[...prev, s])} />
          </div>
          {feedback && (
            <div className="mt-4 rounded-lg bg-slate-800/60 border border-emerald-400/20 p-3">
              <div className="text-sm font-medium text-emerald-300 mb-1">Rubric Feedback</div>
              {feedback.summary && <p className="text-xs text-slate-300 mb-2">{feedback.summary}</p>}
              {Array.isArray(feedback.scores) && feedback.scores.length > 0 && (
                <div className="space-y-1">
                  {feedback.scores.map((s, i) => (
                    <div key={i} className="text-xs text-slate-300 flex items-center justify-between">
                      <span className="text-slate-400">{s.criterion || 'Criterion'}</span>
                      <span className="font-semibold">{Number(s.score || 0).toFixed(0)}/5</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="md:col-span-2 rounded-xl border border-white/10 bg-slate-900/60 p-4 flex flex-col">
          <div ref={listRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
            {messages.length === 0 && (
              <div className="text-sm text-slate-400">Start by sending a message in the selected scenario. The AI will respond in character.</div>
            )}
            {messages.map((m, idx) => (
              <div key={idx} className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.role==='user'? 'jarvis-bubble-user ml-auto' : 'jarvis-bubble-ai'}`}>
                <div className="whitespace-pre-wrap text-sm">{m.content}</div>
              </div>
            ))}
          </div>
          {!voiceMode ? (
            <div className="mt-3 flex gap-2">
              <input
                value={input}
                onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Type your message..."
                className="flex-1 bg-slate-800/80 border border-white/10 rounded-lg p-2 text-sm"
              />
              <button onClick={send} disabled={!input.trim() || loading || !scenarioId} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">Send</button>
            </div>
          ) : (
            <div className="mt-3 flex gap-2 items-center">
              <button onClick={async ()=>{ await ensureSession(); call.startListening() }} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500">Hold Space to Talk</button>
              <span className="text-xs text-slate-400">PTT: Hold or Toggle (see Settings). Replies will speak automatically.</span>
              {call.state === 'speaking' && <span className="text-xs text-emerald-300">Speaking…</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CustomScenarioForm({ onCreated }: { onCreated: (s: RoleplayScenario)=>void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [system, setSystem] = useState('You are a helpful interlocutor. Stay in character. Keep replies concise.')
  const [rubric, setRubric] = useState('Score clarity, correctness, empathy, and structure (1-5). Provide one concrete improvement suggestion.')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setError(null)
    if (!title.trim() || !system.trim()) {
      setError('Title and system prompt are required')
      return
    }
    setSubmitting(true)
    try {
      const r = await fetch('/api/roleplay/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title, description, system, rubric })
      })
      if (!r.ok) throw new Error('Failed to create')
      const data = await r.json()
      const created = { id: data.scenario?.id as string, title, description }
      onCreated(created)
      setTitle('')
      setDescription('')
      // system/rubric intentionally kept to speed repeated creates
    } catch (e: any) {
      setError(e?.message || 'Failed to create')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-2 text-xs">
      {error && <div className="text-rose-300">{error}</div>}
      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title" className="w-full bg-slate-800/80 border border-white/10 rounded p-2" />
      <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Short description" className="w-full bg-slate-800/80 border border-white/10 rounded p-2" />
      <textarea value={system} onChange={e=>setSystem(e.target.value)} placeholder="System prompt" className="w-full bg-slate-800/80 border border-white/10 rounded p-2" />
      <textarea value={rubric} onChange={e=>setRubric(e.target.value)} placeholder="Rubric (optional)" className="w-full bg-slate-800/80 border border-white/10 rounded p-2" />
      <button disabled={submitting} onClick={create} className="px-3 py-2 rounded bg-slate-800/80 border border-white/10 disabled:opacity-50">{submitting? 'Creating...' : 'Create'}</button>
    </div>
  )
}
