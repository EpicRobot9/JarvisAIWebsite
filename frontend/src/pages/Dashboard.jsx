import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, MessageSquare, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { useRecorder } from '../hooks/useRecorder'
import { WEBHOOK_URL, CALLBACK_URL, SOURCE_NAME, CHAT_INACTIVITY_RESET_MS } from '../lib/config'
import { storage } from '../lib/storage'

function ChatSheet({ open, onClose, user, onDebug }) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState(() => {
    const saved = storage.get('jarvis_chat_v1', [])
    const lastActive = Number(storage.get('jarvis_chat_lastActive_v1', 0) || 0)
    const now = Date.now()
    if (!Array.isArray(saved)) return []
    if (!lastActive || now - lastActive > CHAT_INACTIVITY_RESET_MS) {
      // Too much time since last activity; reset persisted chat
      try {
        storage.remove('jarvis_chat_v1')
        storage.remove('jarvis_chat_lastActive_v1')
      } catch {}
      return []
    }
    return saved
  })
  const [error, setError] = useState('')
  useEffect(()=> { storage.set('jarvis_chat_v1', messages) }, [messages])

  // Only mark last activity when the USER sends a message (not on focus/open/assistant reply)
  const markUserSent = () => {
    try { storage.set('jarvis_chat_lastActive_v1', Date.now()) } catch {}
  }

  // Check inactivity on open/focus and reset if needed
  useEffect(()=> {
    const checkAndMaybeReset = () => {
      const lastActive = Number(storage.get('jarvis_chat_lastActive_v1', 0) || 0)
      const now = Date.now()
      if (!lastActive || now - lastActive > CHAT_INACTIVITY_RESET_MS) {
        try {
          storage.remove('jarvis_chat_v1')
          storage.remove('jarvis_chat_lastActive_v1')
        } catch {}
        if (messages.length) setMessages([])
      }
    }
    // run when sheet opens
    if (open) checkAndMaybeReset()
    const onVis = () => { if (!document.hidden) checkAndMaybeReset() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return ()=> {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [open, messages.length])

  async function send(text) {
    markUserSent()
    const correlationId = crypto.randomUUID()
    setMessages(m => [...m, { id: correlationId, role: 'user', content: text, at: Date.now() }])
    onDebug?.({ kind: 'request', at: Date.now(), correlationId, payload: { chatInput: text, userid: user?.id || 'anon' } })
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': localStorage.getItem('jarvis_apikey') || ''
      },
      body: JSON.stringify({
        chatInput: text,
        userid: user?.id || 'anon',
        correlationId,
        callbackUrl: CALLBACK_URL,
        source: SOURCE_NAME,
        messageType: 'TextMessage'
      })
    })
  if (res.ok) {
      setMessages(m => [...m, { id: correlationId, role: 'assistant', content: "On it! I’ll follow up as soon as I have results.", at: Date.now(), ack: true, startedAt: Date.now(), delay: 2000, lastPollAt: 0, attempts: 0, origText: text, origUserId: user?.id || 'anon' }])
      onDebug?.({ kind: 'ack', at: Date.now(), correlationId, status: res.status })
    } else {
      onDebug?.({ kind: 'error', at: Date.now(), correlationId, status: res.status })
      setError('Webhook request failed. Please check VITE_WEBHOOK_URL or your API key.')
    }
  }

  function resendFrom(msg) {
    if (!msg?.origText) return
    setError('')
    send(msg.origText)
  }

  async function copyPayloadFrom(msg) {
    try {
      const payload = {
        chatInput: msg.origText,
        userid: msg.origUserId || user?.id || 'anon',
        correlationId: msg.id,
        callbackUrl: CALLBACK_URL,
        source: SOURCE_NAME,
      }
      await navigator.clipboard?.writeText?.(JSON.stringify(payload, null, 2))
      onDebug?.({ kind: 'copied', at: Date.now(), correlationId: msg.id })
    } catch {}
  }

  useEffect(()=>{
    const i = setInterval(async ()=>{
      const pend = messages.filter(m => m.ack && !m.done)
      for (const p of pend) {
        const now = Date.now()
        const delay = p.delay ?? 2000
        const last = p.lastPollAt ?? 0
        if (now - last < delay) continue
        let got = false
        try {
          const r = await fetch(`${CALLBACK_URL}/${p.id}`)
          if (r.ok) {
            const data = await r.json()
            if (data?.result) {
              got = true
              onDebug?.({ kind: 'response', at: Date.now(), correlationId: p.id, payload: data })
              const audioUrl = await (async ()=>{
                try {
                  const t = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ text: data.result }) })
                  if (!t.ok) return null
                  const blob = await t.blob()
                  return URL.createObjectURL(blob)
                } catch { return null }
              })()
              setMessages(m => m
                .map(x => x.id===p.id ? { ...x, done: true } : x)
                .concat([
                  { id: crypto.randomUUID(), role: 'assistant', content: data.result, at: Date.now() },
                  ...(audioUrl ? [{ id: crypto.randomUUID(), role: 'system', audioUrl, at: Date.now() }] : [])
                ]))
              // Do not update inactivity timer on assistant reply; only on user sends
            }
          }
        } finally {
          if (!got) {
            if (p.startedAt && now - p.startedAt > 60_000) {
              onDebug?.({ kind: 'timeout', at: now, correlationId: p.id })
              setError('Callback timed out (no response within 60s).')
              setMessages(m => m.map(x => x.id===p.id ? { ...x, done: true, error: true } : x))
            } else {
              const nextDelay = Math.min(30_000, Math.round((p.delay ?? 2000) * 1.7))
              setMessages(m => m.map(x => x.id===p.id ? { ...x, delay: nextDelay, lastPollAt: now, attempts: (x.attempts||0)+1 } : x))
            }
          }
        }
      }
    }, 1000)
    return ()=> clearInterval(i)
  }, [messages])

  return (
    <div className={`fixed inset-0 bg-black/40 transition ${open?'opacity-100 pointer-events-auto':'opacity-0 pointer-events-none'}`} onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-full sm:w-[460px] glass p-4 flex flex-col" onClick={e=>e.stopPropagation()}>
        <h2 className="jarvis-title mb-2">Chat</h2>
        {error && (
          <div className="mb-2 text-sm text-red-700 bg-red-100 border border-red-300 rounded p-2">
            {error}
          </div>
        )}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {messages.map((m)=> (
            <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.role==='user'?'jarvis-bubble-user ml-auto':'jarvis-bubble-ai'}`}>
              {m.audioUrl ? (
                <audio controls src={m.audioUrl} className="w-full">
                  Your browser does not support the audio element.
                </audio>
              ) : (
                <div className="text-sm">
                  {m.role==='assistant' ? (
                    <>
                      {React.createElement(require('../components/ui/Markdown').default, { content: (m.content || '') + (m.error ? ' (timed out)' : '') })}
                    </>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}{m.error ? ' (timed out)' : ''}</span>
                  )}
                  {m.ack && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      {m.error && (
                        <button onClick={()=>resendFrom(m)} className="px-2 py-1 rounded border border-cyan-200/20 bg-white/10">Resend</button>
                      )}
                      {m.origText && (
                        <button onClick={()=>copyPayloadFrom(m)} className="px-2 py-1 rounded border border-cyan-200/20 bg-white/10">Copy payload</button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <form className="mt-2 flex gap-2" onSubmit={e=>{e.preventDefault(); if(input.trim()) { send(input.trim()); setInput(''); }}}>
          <input value={input} onChange={e=>{ setInput(e.target.value); markActive(); }} placeholder="Type a message..." className="jarvis-input flex-1" />
          <button className="jarvis-btn jarvis-btn-primary">Send</button>
        </form>
      </div>
    </div>
  )
}

function BubblesBg() {
  const blobs = new Array(6).fill(0).map((_,i)=>({
    delay: i*0.3,
    size: 200 + Math.random()*200,
    x: Math.random()*100,
    y: Math.random()*100,
    opacity: 0.15
  }))
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {blobs.map((b,i)=> (
        <motion.div key={i}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: b.opacity, scale: 1 }}
          transition={{ duration: 2, delay: b.delay }}
          className="absolute rounded-full blur-3xl bg-blue-500/30"
          style={{ width: b.size, height: b.size, left: `${b.x}%`, top: `${b.y}%` }}
        />
      ))}
      <div className="sparkles" />
    </div>
  )
}

export default function Dashboard() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState([])
  const [open, setOpen] = useState(false)
  const rec = useRecorder()
  const [debug, setDebug] = useState(() => storage.get('jarvis_debug_v1', []))
  const [debugOpen, setDebugOpen] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('jarvis_theme') || 'theme-blue')

  useEffect(()=>{
    const handler = (e) => setDebug(d=>[{...e.detail}, ...d].slice(0,50))
    window.addEventListener('jarvis-debug', handler)
    return ()=> window.removeEventListener('jarvis-debug', handler)
  }, [])
  useEffect(()=>{ storage.set('jarvis_debug_v1', debug) }, [debug])

  useEffect(()=>{ (async()=>{
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      let u = null
      if (r.ok) {
        const txt = await r.text()
        u = txt ? JSON.parse(txt) : null
      }
      setMe(u)
      if (u?.role === 'admin') {
        const res = await fetch('/api/admin/pending', { credentials: 'include', cache: 'no-store' }).catch(()=>null)
        if (res?.ok) {
          const txt = await res.text()
          setPending(txt ? JSON.parse(txt) : [])
        } else setPending([])
      }
    } catch { setMe(null) }
    finally { setLoading(false) }
  })() }, [])

  // If we've determined the user is not signed in, send them to Sign In.
  useEffect(()=>{
    if (!loading && !me) {
      // Don't hard-block the UI; allow redirect while still showing content briefly
      nav('/signin')
    }
  }, [loading, me])

  useEffect(()=>{
    localStorage.setItem('jarvis_theme', theme)
    const root = document.documentElement
    if (theme === 'theme-dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [theme])

  async function approve(userId) {
    await fetch('/api/admin/approve', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId }) })
    setPending(p => p.filter(u => u.id !== userId))
  }
  async function deny(userId) {
    await fetch('/api/admin/deny', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId }) })
    setPending(p => p.filter(u => u.id !== userId))
  }

  // Render the dashboard shell for both authed and unauth users; show banners instead of hard returns.
  const showStatusBanner = !!me && me.status !== 'active'

  return (
    <div className={`min-h-screen ${theme} ${theme==='theme-dark'?'dark':''}`}>
      <BubblesBg />
      <div className="max-w-5xl mx-auto p-6">
        <header className="flex items-center justify-between mb-4">
          <div className="font-bold text-xl flex items-center gap-2 jarvis-title">
            <Sparkles className="text-cyan-300" size={20}/> Jarvis Portal — Dashboard
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <select aria-label="Theme" className="appearance-none rounded-xl border bg-white/5 px-8 py-2 pr-10 backdrop-blur-md border-cyan-200/20"
                value={theme} onChange={e=>setTheme(e.target.value)}>
                <option value="theme-blue">Blue</option>
                <option value="theme-light">Light</option>
                <option value="theme-dark">Dark</option>
              </select>
            </div>
            <button className={`jarvis-btn ${debugOpen?'ring-2 ring-blue-400':''}`} onClick={()=>setDebugOpen(v=>!v)}>
              Debug {debugOpen ? 'On' : 'Off'}
            </button>
            <button className="jarvis-btn flex items-center gap-2" onClick={()=>setOpen(true)}>
              <MessageSquare size={18}/> UI Chat
            </button>
            <button className={`rounded-xl px-3 py-2 flex items-center gap-2 backdrop-blur-md border ${rec.isRecording?'bg-red-600 text-white':'bg-white/5 border-cyan-200/20'}`} onClick={()=> rec.isRecording ? rec.stop(onVoiceStop) : rec.start()}>
              <Mic size={18}/> Voice {rec.isRecording ? `(${rec.level}%)` : ''}
            </button>
            {me ? (
              <button className="jarvis-btn flex items-center gap-2" onClick={async ()=>{ await fetch('/api/auth/signout',{method:'POST'}); nav('/signin') }}>
                Logout
              </button>
            ) : (
              <button className="jarvis-btn" onClick={()=>nav('/signin')}>Sign in</button>
            )}
          </div>
        </header>

        <ChatSheet open={open} onClose={()=>setOpen(false)} user={me} onDebug={(e)=>setDebug(d=>[{...e}, ...d].slice(0,50))} />

        <main className="grid gap-4 md:grid-cols-2">
          {loading && (
            <div className="md:col-span-2 rounded-2xl glass p-4 text-sm">Checking session…</div>
          )}
          {showStatusBanner && (
            <div className="md:col-span-2 rounded-2xl glass p-4 text-sm">Account status: {me.status}</div>
          )}
          <div className="rounded-2xl glass p-6">
            <h3 className="text-lg font-semibold mb-2">Welcome</h3>
            <p className="jarvis-subtle">Use the header to open UI Chat or start a Voice recording. Messages go to your n8n webhook with the exact payload fields required.</p>
          </div>
          <div className="rounded-2xl glass p-6">
            <h3 className="text-lg font-semibold mb-2 text-cyan-300">Live Status</h3>
            <ul className="text-sm jarvis-subtle list-disc ml-5 space-y-1">
              <li>Signed in: {me? 'yes' : (loading ? 'checking…' : 'no')}</li>
              <li>User: {me? `${me.email} (${me.role})` : '-'}</li>
              <li>Mic level: {rec.level}%</li>
            </ul>
          </div>

          {me?.role === 'admin' && (
            <div className="rounded-2xl glass p-6 md:col-span-2">
              <h2 className="font-semibold mb-2">Pending approvals</h2>
              {pending.length === 0 ? <div className="text-sm text-slate-300 dark:text-slate-400">None</div> : (
                <ul className="space-y-2">
                  {pending.map(u => (
                    <li key={u.id} className="flex items-center justify-between">
                      <span>{u.email}</span>
                      <div className="space-x-2">
                        <button className="px-3 py-1 rounded bg-green-600 text-white" onClick={()=>approve(u.id)}>Approve</button>
                        <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={()=>deny(u.id)}>Deny</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {debugOpen && (
          <div className="rounded-2xl glass p-4 md:col-span-2">
            <h2 className="font-semibold mb-2">Webhook Debug</h2>
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 max-h-60 overflow-auto">
              {debug.length === 0 ? (
                <div className="text-slate-400">No events yet</div>
              ) : (
                debug.map((e,i)=> (
                  <div key={i} className="break-words">
                    <span className="mr-2 px-2 py-0.5 rounded-full border text-[10px] uppercase">{e.kind}</span>
                    <span className="opacity-70">{new Date(e.at).toLocaleTimeString()} id={e.correlationId}</span>
                    {e.status ? <span className="ml-2">status={e.status}</span> : null}
                    {e.payload ? (
                      <>
                        <pre className="mt-1 bg-black/5 dark:bg-white/5 rounded p-2 whitespace-pre-wrap">{JSON.stringify(e.payload, null, 2)}</pre>
                        <button className="mt-1 px-2 py-1 rounded border text-xs border-cyan-200/20" onClick={async ()=>{
                          try { await navigator.clipboard?.writeText?.(JSON.stringify(e.payload, null, 2)) } catch {}
                        }}>Copy payload</button>
                      </>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
          )}
        </main>
      </div>
    </div>
  )
}

async function onVoiceStop(blob) {
  const correlationId = crypto.randomUUID()
  const form = new FormData()
  form.append('file', blob, `voice-${correlationId}.webm`)
  form.append('correlationId', correlationId)
  form.append('callbackUrl', CALLBACK_URL)
  form.append('source', SOURCE_NAME)
  const emit = (e) => {
    try { window.dispatchEvent(new CustomEvent('jarvis-debug', { detail: e })) } catch {}
  }
  emit({ kind: 'voice:transcribe:request', at: Date.now(), correlationId })
  const r = await fetch('/api/transcribe', { method: 'POST', body: form })
  if (r.ok) {
    const { text } = await r.json()
    emit({ kind: 'voice:transcribe:response', at: Date.now(), correlationId, payload: { text } })
  const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': localStorage.getItem('jarvis_apikey') || '' },
  body: JSON.stringify({ chatInput: text, userid: 'voice', correlationId, callbackUrl: CALLBACK_URL, source: SOURCE_NAME, messageType: 'CallMessage' })
    })
    emit({ kind: 'voice:webhook:ack', at: Date.now(), correlationId, status: res.status })
  } else {
    emit({ kind: 'voice:transcribe:error', at: Date.now(), correlationId, status: r.status })
  }
}

