import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Mic, MessageSquare, LogOut, Sparkles, Palette } from 'lucide-react'
import { useRecorder } from './hooks/useRecorder'
import { WEBHOOK_URL, PROD_WEBHOOK_URL, TEST_WEBHOOK_URL, CALLBACK_URL, SOURCE_NAME, CHAT_INACTIVITY_RESET_MS } from './lib/config'
import { storage } from './lib/storage'
import { Link, useNavigate } from 'react-router-dom'

function useUser() {
  const [user, setUser] = useState(null)
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(async r => {
        if (!r.ok) return null
        const txt = await r.text()
        return txt ? JSON.parse(txt) : null
      })
      .then(setUser)
      .catch(()=>{})
  }, [])
  return { user, refresh: async () => {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      const txt = await r.text()
      setUser(txt ? JSON.parse(txt) : null)
    } catch {}
  } }
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

function ChatSheet({ open, onClose, webhookUrl }) {
  const { user } = useUser()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState(() => {
    const saved = storage.get('jarvis_chat_v1', [])
    const lastActive = Number(storage.get('jarvis_chat_lastActive_v1', 0) || 0)
    const now = Date.now()
    if (!Array.isArray(saved)) return []
    if (!lastActive || now - lastActive > CHAT_INACTIVITY_RESET_MS) {
      try {
        storage.remove('jarvis_chat_v1')
        storage.remove('jarvis_chat_lastActive_v1')
      } catch {}
      return []
    }
    return saved
  })
  useEffect(()=> storage.set('jarvis_chat_v1', messages), [messages])
  const scrollRef = useRef(null)
  // Auto-scroll to newest message
  useEffect(() => {
    try {
      const el = scrollRef.current
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } catch {}
  }, [messages.length, open])

  // Only update inactivity timer when USER sends a message
  const markUserSent = () => {
    try { storage.set('jarvis_chat_lastActive_v1', Date.now()) } catch {}
  }

  // On open/focus, check inactivity and reset if needed
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
    if (open) checkAndMaybeReset()
    const onVis = () => { if (!document.hidden) checkAndMaybeReset() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return ()=> {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [open, messages.length])

  function retryFrom(msg) {
    const text = msg?.origText || messages.find(m => m.role==='user' && m.correlationId===msg?.correlationId)?.content || ''
    if (text) send(text)
  }

  async function send(text) {
    const correlationId = crypto.randomUUID()
  markUserSent()
    // Add the user message with its own unique id
    setMessages(m => [
      ...m,
      { id: `${correlationId}:user`, role: 'user', content: text, at: Date.now(), correlationId }
    ])

    let res
    try {
      res = await fetch(webhookUrl, {
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
    } catch (e) {
      // Network error reaching webhook
      setMessages(m => [
        ...m,
        { id: `${correlationId}:assistant`, role: 'assistant', content: `Error contacting webhook: ${String(e)}`,
          at: Date.now(), correlationId, ack: false, pending: false, done: true, error: true, origText: text }
      ])
      return
    }

    if (res.ok) {
      // Try to use a synchronous response first (some workflows respond immediately)
      let immediateText = ''
      try {
        const bodyTxt = await res.text()
        if (bodyTxt) {
          try {
            const data = JSON.parse(bodyTxt)
            if (Array.isArray(data)) {
              const parts = data.map(d => {
                if (!d) return ''
                if (typeof d === 'string') return d
                if (typeof d === 'object') return d.output || d.result || d.text || ''
                return ''
              }).filter(Boolean)
              immediateText = parts.join('\n\n') || (data.length ? JSON.stringify(data) : '')
            } else if (typeof data === 'object') {
              if (data.error) immediateText = `Error: ${data.error}`
              else immediateText = data.result || data.output || data.text || ''
            } else if (typeof data === 'string') {
              immediateText = data
            }
          } catch {
            // Not JSON; plain text body
            immediateText = bodyTxt
          }
        }
      } catch {}

      if (immediateText) {
        // Show reply immediately and mark done
        setMessages(m => [
          ...m,
          { id: `${correlationId}:assistant`, role: 'assistant', content: immediateText, at: Date.now(), correlationId, ack: true, pending: false, done: true, origText: text }
        ])
      } else {
        // Insert a pending assistant bubble tracked by correlationId, to await callback
        setMessages(m => [
          ...m,
          { id: `${correlationId}:assistant`, role: 'assistant', content: '', at: Date.now(), correlationId, ack: true, pending: true, done: false, origText: text }
        ])
      }
    } else {
      let bodyText = ''
      try { bodyText = await res.text() } catch {}
      setMessages(m => [
        ...m,
        { id: `${correlationId}:assistant`, role: 'assistant', content: `Webhook error ${res.status}: ${bodyText || res.statusText}`,
          at: Date.now(), correlationId, ack: false, pending: false, done: true, error: true, origText: text }
      ])
    }
  }

  useEffect(()=>{
    const timeoutMs = 30000 // 30s timeout to avoid infinite spinner
    const i = setInterval(async ()=>{
      const pend = messages.filter(m => m.ack && !m.done)
      for (const p of pend) {
        // Timeout handling
        if (Date.now() - (p.at || 0) > timeoutMs) {
          setMessages(m => m.map(x => x.id===p.id ? { ...x, content: 'Request timed out. Please try again.', done: true, pending: false, error: true } : x))
          continue
        }

        let r
        try {
          r = await fetch(`${CALLBACK_URL}/${p.correlationId}`)
        } catch (e) {
          setMessages(m => m.map(x => x.id===p.id ? { ...x, content: `Error polling callback: ${String(e)}`, done: true, pending: false, error: true } : x))
          continue
        }

        if (!r.ok) {
          setMessages(m => m.map(x => x.id===p.id ? { ...x, content: `Callback error ${r.status}: ${r.statusText}`, done: true, pending: false, error: true } : x))
          continue
        }

        let resolvedText = ''
        try {
          const data = await r.json()
          if (data == null) {
            // Still pending at the server
            continue
          }
          if (Array.isArray(data)) {
            // Expecting [{ output: "text" }, ...] but fallback to stringifying items
            const parts = data.map(d => {
              if (!d) return ''
              if (typeof d === 'string') return d
              if (typeof d === 'object') return d.output || d.result || d.text || ''
              return ''
            }).filter(Boolean)
            resolvedText = parts.join('\n\n') || (data.length ? JSON.stringify(data) : '')
          } else if (typeof data === 'object') {
            if (data.error) {
              resolvedText = `Error: ${data.error}`
            } else {
              resolvedText = data.result || data.output || data.text || ''
              if (!resolvedText) resolvedText = JSON.stringify(data)
            }
          } else if (typeof data === 'string') {
            resolvedText = data
          }
        } catch (e) {
          // Not JSON or parse failed; try text
          try { resolvedText = await r.text() } catch {}
        }

  if (resolvedText) {
          // Update the pending assistant bubble in place
          setMessages(m => m.map(x => x.id===p.id ? { ...x, content: resolvedText, done: true, pending: false } : x))
        }
      }
    }, 2000)
    return ()=> clearInterval(i)
  }, [messages])

  return (
    <div className={`fixed inset-0 bg-black/40 transition ${open?'opacity-100 pointer-events-auto':'opacity-0 pointer-events-none'}`} onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-full sm:w-[460px] glass p-4 flex flex-col" onClick={e=>e.stopPropagation()}>
        <h2 className="jarvis-title mb-2">Chat</h2>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1" ref={scrollRef}>
          {messages.map((m)=> (
            <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.role==='user'? 'jarvis-bubble-user ml-auto' : (m.error ? 'bg-red-900/30 border border-red-500/30' : 'jarvis-bubble-ai')}`}>
              {m.audioUrl ? (
                <audio controls src={m.audioUrl} className="w-full">
                  Your browser does not support the audio element.
                </audio>
              ) : (
                <div className="text-sm flex items-center gap-2">
                  <span className="flex-1">
                    {m.role==='assistant' ? (
                      <>
                        {/** Render Markdown so links become clickable and styled */}
                        {React.createElement(require('./components/ui/Markdown').default, { content: m.content || '' })}
                      </>
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content || (m.pending ? '' : '')}</span>
                    )}
                  </span>
                  {m.pending && (
                    <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" aria-label="Loading" />
                  )}
                  {m.role==='assistant' && m.error && (
                    <button className="ml-2 px-2 py-1 rounded border text-xs bg-red-500/20 hover:bg-red-500/30" onClick={()=>retryFrom(m)}>
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <form className="mt-2 flex gap-2" onSubmit={e=>{e.preventDefault(); if(input.trim()) { send(input.trim()); setInput('') }}}>
          <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Type a message..." className="jarvis-input" />
          <button className="jarvis-btn jarvis-btn-primary">Send</button>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const nav = useNavigate()
  const { user, refresh } = useUser()
  const [open, setOpen] = useState(false)
  const rec = useRecorder()
  const [theme, setTheme] = useState(() => localStorage.getItem('jarvis_theme') || 'theme-blue')
  const [useTest, setUseTest] = useState(() => storage.get('jarvis_use_test_url', false))
  const [dynamicUrls, setDynamicUrls] = useState({ prod: '', test: '' })
  const currentWebhookUrl = (useTest ? (dynamicUrls.test || TEST_WEBHOOK_URL) : (dynamicUrls.prod || PROD_WEBHOOK_URL))
  useEffect(()=>{
    (async()=>{
      try {
        // Prefer local cache first to avoid flicker
        const cached = {
          prod: localStorage.getItem('jarvis_webhook_prod') || '',
          test: localStorage.getItem('jarvis_webhook_test') || ''
        }
        if (cached.prod || cached.test) setDynamicUrls(cached)
        const r = await fetch('/api/webhook-urls', { cache: 'no-store' }).catch(()=>null)
        if (r?.ok) {
          const data = await r.json()
          setDynamicUrls({ prod: data.prod || '', test: data.test || '' })
          try {
            localStorage.setItem('jarvis_webhook_prod', data.prod || '')
            localStorage.setItem('jarvis_webhook_test', data.test || '')
          } catch {}
        }
      } catch {}
    })()
  }, [])
  useEffect(()=>{
    localStorage.setItem('jarvis_theme', theme)
    // Also toggle Tailwind's dark class
    const root = document.documentElement
    if (theme === 'theme-dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [theme])
  useEffect(()=>{ storage.set('jarvis_use_test_url', useTest) }, [useTest])

  async function handleStop(blob) {
    if (!user) return
    const correlationId = crypto.randomUUID()
    const form = new FormData()
    form.append('file', blob, `voice-${correlationId}.webm`)
    form.append('correlationId', correlationId)
    form.append('callbackUrl', CALLBACK_URL)
    form.append('source', SOURCE_NAME)
  const r = await fetch('/api/transcribe', { method: 'POST', body: form, credentials: 'include' })
    if (r.ok) {
      const { text } = await r.json()
      await fetch(currentWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': localStorage.getItem('jarvis_apikey') || '' },
        body: JSON.stringify({ chatInput: text, userid: user?.id || 'anon', correlationId, callbackUrl: CALLBACK_URL, source: SOURCE_NAME, messageType: 'CallMessage' })
      })
    }
  }

  useEffect(()=>{ refresh() }, [])

  return (
  <div className={`min-h-screen ${theme} ${theme==='theme-dark'?'dark':''}`}>
      <BubblesBg />
      <header className="p-4 flex items-center justify-between">
        <div className="font-bold text-xl flex items-center gap-2 jarvis-title">
          <Sparkles className="text-cyan-300" size={20}/> Jarvis Portal
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <Link to="/interstellar" className="jarvis-btn jarvis-btn-primary flex items-center gap-2">
              <Sparkles size={18}/> Interstellar Manager
            </Link>
          )}
          <div className="flex items-center gap-1 rounded-xl border px-2 py-2 bg-white/5 backdrop-blur-md border-cyan-200/20">
            <label className="text-xs mr-1 jarvis-subtle">Webhook:</label>
            <button type="button" onClick={()=>setUseTest(false)} className={`px-2 py-1 rounded text-xs border ${!useTest?'bg-blue-600 text-white':'border-cyan-200/20 hover:bg-white/10'}`}>Prod</button>
            <button type="button" onClick={()=>setUseTest(true)} className={`px-2 py-1 rounded text-xs border ${useTest?'bg-blue-600 text-white':'border-cyan-200/20 hover:bg-white/10'}`}>Test</button>
          </div>
          <div className="relative">
            <select aria-label="Theme" className="appearance-none rounded-xl border bg-white/5 px-8 py-2 pr-10 backdrop-blur-md border-cyan-200/20"
              value={theme} onChange={e=>setTheme(e.target.value)}>
              <option value="theme-blue">Blue</option>
              <option value="theme-light">Light</option>
              <option value="theme-dark">Dark</option>
            </select>
          </div>
          <button
            className="jarvis-btn disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={()=> user && setOpen(true)}
            disabled={!user}
            title={user ? '' : 'Sign in to chat'}
          >
            <MessageSquare size={18}/> UI Chat
          </button>
          <button
            className={`rounded-xl px-3 py-2 flex items-center gap-2 backdrop-blur-md border ${rec.isRecording?'bg-red-600 text-white':'bg-white/5 border-cyan-200/20'} disabled:opacity-50 disabled:cursor-not-allowed`}
            onClick={()=> user && (rec.isRecording ? rec.stop(handleStop) : rec.start())}
            disabled={!user}
            title={user ? '' : 'Sign in to use voice'}
          >
            <Mic size={18}/> Voice {rec.isRecording ? `(${rec.level}%)` : ''}
          </button>
          {user ? (
            <button className="jarvis-btn" onClick={async ()=>{ await fetch('/api/auth/signout',{method:'POST'}); nav('/signin') }}>
              <LogOut size={18}/> Logout
            </button>
          ) : (
            <button className="jarvis-btn" onClick={()=>nav('/signin')}>Sign in</button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl glass p-6">
          <h3 className="text-lg font-semibold mb-2 text-cyan-300">Welcome</h3>
          <p className="jarvis-subtle mb-4">Use the header to open UI Chat or start a Voice recording. Messages go to your n8n webhook with the exact payload fields required.</p>
          {user && (
            <div className="flex gap-2">
              <Link to="/interstellar" className="jarvis-btn jarvis-btn-primary flex items-center gap-2">
                <Sparkles size={18}/> Interstellar Manager
              </Link>
            </div>
          )}
        </div>
        <div className="rounded-2xl glass p-6">
          <h3 className="text-lg font-semibold mb-2 text-cyan-300">Live Status</h3>
          <ul className="text-sm jarvis-subtle list-disc ml-5 space-y-1">
            <li>Signed in: {user? 'yes' : 'no'}</li>
            <li>User: {user? `${user.username} (${user.role})` : '-'}</li>
            <li>Mic level: {rec.level}%</li>
          </ul>
        </div>
      </main>

  <ChatSheet open={open} onClose={()=>setOpen(false)} webhookUrl={currentWebhookUrl} />
    </div>
  )
}
