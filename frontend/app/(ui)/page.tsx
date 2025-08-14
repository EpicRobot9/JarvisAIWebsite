import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import MicToggleButton from '../../src/components/MicToggleButton'
import SettingsPanel from '../../src/components/SettingsPanel'
import ErrorToast from '../../src/components/ErrorToast'
import ErrorCard from '../../src/components/ErrorCard'
import { AppError, sendToRouter, sendToWebhook, synthesizeTTS, transcribeAudio, getTtsStreamUrl } from '../../src/lib/api'
import { playAudioBuffer, stopAudio, playStreamUrl } from '../../src/lib/audio'
import { useEventChannel } from '../../src/lib/events'
import { useSession } from '../../src/lib/session'
import { CALLBACK_URL, PROD_WEBHOOK_URL, TEST_WEBHOOK_URL, SOURCE_NAME } from '../../src/lib/config'
import { motion, AnimatePresence } from 'framer-motion'
import CallMode from '../../src/components/CallMode'

type Me = { id: string; email: string; role: string; status: string } | null

export default function Page() {
  const nav = useNavigate()
  const session = useSession()
  const [me, setMe] = useState<Me>(null)
  const [loadingMe, setLoadingMe] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [toast, setToast] = useState<string>('')
  // Webhook environment toggle
  const [useTestWebhook, setUseTestWebhook] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('jarvis_use_test_url') || 'false') } catch { return false }
  })
  const currentWebhookUrl = useTestWebhook ? TEST_WEBHOOK_URL : PROD_WEBHOOK_URL
  useEffect(()=>{ try { localStorage.setItem('jarvis_use_test_url', JSON.stringify(useTestWebhook)) } catch {} }, [useTestWebhook])
  const lastBlobRef = useRef<Blob | null>(null)
  const lastTextRef = useRef<string>('')
  const lastReplyRef = useRef<string>('')
  const [callSummary, setCallSummary] = useState<string>('')

  // Fetch current user
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
        const t = await r.text()
        setMe(t ? JSON.parse(t) : null)
      } catch { setMe(null) }
      finally { setLoadingMe(false) }
    })()
  }, [])

  // Event channel: push/push-voice/call-end
  useEventChannel(session.sessionId, {
    onPush: (ev) => {
      session.appendMessage({ role: ev.role || 'assistant', text: ev.text, via: 'api' })
    },
    onCallEnd: (ev) => {
      setCallSummary(ev.reason || 'Call ended')
      session.setInCall(false)
      setSpeaking(false)
      stopAudio()
    },
    setSpeaking,
  })

  // Retry wiring
  const [retry, setRetry] = useState<{ label: string; fn: () => Promise<void> } | null>(null)

  // Send typed text
  async function sendText(text: string, source: 'typed' | 'voice' = 'typed') {
    if (!text.trim()) return
    session.appendMessage({ role: 'user', text, via: source })
    session.setStatus('sending')
    lastTextRef.current = text
    try {
      // Send to selected n8n webhook (direct), then poll callback if needed
      const { correlationId, immediateText } = await sendToWebhook(text, {
        userId: me?.id || 'anon',
        webhookUrl: currentWebhookUrl,
        callbackUrl: CALLBACK_URL,
        source: SOURCE_NAME,
        sessionId: session.sessionId,
      })

      if (immediateText && immediateText.trim()) {
        session.appendMessage({ role: 'assistant', text: immediateText, via: 'api' })
        lastReplyRef.current = immediateText
        // Speak
        session.setStatus('speaking')
        setSpeaking(true)
  await playStreamUrl(getTtsStreamUrl(immediateText))
        setSpeaking(false)
        session.setStatus('idle')
        setRetry(null)
      } else {
        // Poll callback until resolved or timeout
        const start = Date.now()
        const timeoutMs = 30000
        let resolved = ''
        while (Date.now() - start < timeoutMs) {
          const r = await fetch(`${CALLBACK_URL}/${correlationId}`)
          if (r.ok) {
            try {
              const data = await r.json()
              if (data) {
                if (Array.isArray(data)) {
                  const parts = data.map((d:any)=> typeof d==='string'? d : (d?.output||d?.result||d?.text||'')).filter(Boolean)
                  resolved = parts.join('\n\n') || (data.length? JSON.stringify(data): '')
                } else if (typeof data === 'object') {
                  resolved = data.result || data.output || data.text || ''
                  if (!resolved) resolved = JSON.stringify(data)
                } else if (typeof data === 'string') {
                  resolved = data
                }
                if (resolved) break
              }
            } catch {}
          }
          await new Promise(r=>setTimeout(r, 2000))
        }
        if (resolved) {
          session.appendMessage({ role:'assistant', text: resolved, via:'api' })
          lastReplyRef.current = resolved
          session.setStatus('speaking')
          setSpeaking(true)
          await playStreamUrl(getTtsStreamUrl(resolved))
          setSpeaking(false)
          session.setStatus('idle')
          setRetry(null)
        } else {
          const msg = 'Request timed out. Please try again.'
          session.appendMessage({ role:'assistant', text: msg, via:'api' })
          session.setStatus('idle')
          setRetry({ label: 'Retry send', fn: () => sendText(lastTextRef.current) })
        }
      }
    } catch (e) {
      const err = AppError.from(e)
      session.setError(err)
      setToast(err.message)
      setRetry({ label: 'Retry send', fn: () => sendText(lastTextRef.current) })
      session.setStatus('idle')
    }
  }

  // Handle audio blob flow
  async function handleAudio(blob: Blob) {
    lastBlobRef.current = blob
    session.setStatus('transcribing')
    try {
  const { text } = await transcribeAudio(blob)
  if (!text) throw new AppError('stt_failed', 'No speech detected.')
  // Reuse text sending path for webhook + callback (handles append/speak/idle)
  await sendText(text, 'voice')
      setSpeaking(false)
      session.setStatus('idle')
      setRetry(null)
    } catch (e) {
      const err = AppError.from(e)
      session.setError(err)
      setToast(err.message)
      // Stage-specific retry
      if (err.kind === 'stt_failed') setRetry({ label: 'Retry STT', fn: () => handleAudio(lastBlobRef.current!) })
      else if (err.kind === 'router_failed') setRetry({ label: 'Retry send', fn: () => sendText(lastTextRef.current) })
      else if (err.kind === 'tts_failed' || err.kind === 'play_failed') setRetry({ label: 'Retry speak', fn: () => speak(lastReplyRef.current) })
      session.setStatus('idle')
    }
  }

  async function speak(text: string) {
    if (!text) return
    try {
      session.setStatus('speaking')
      setSpeaking(true)
  await playStreamUrl(getTtsStreamUrl(text))
    } catch (e) {
      const err = AppError.from(e)
      session.setError(err)
      setToast(err.message)
      setRetry({ label: 'Retry speak', fn: () => speak(text) })
    } finally {
      setSpeaking(false)
      session.setStatus('idle')
    }
  }

  const [input, setInput] = useState('')
  const canUse = useMemo(() => !!me && me.status === 'active', [me])

  async function signOut() {
    try {
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' })
      setMe(null)
      nav('/signin')
    } catch {}
  }

  return (
    <div className="h-screen relative p-4">
      <AnimatePresence initial={false}>
        {/* Chat shell */}
    {session.mode !== 'call' && (
      <motion.div
            key="chat-shell"
    className="grid grid-cols-1 md:grid-cols-[260px_1fr_280px] gap-4 h-full"
            initial={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
            animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
            exit={{ opacity: 0.4, filter: 'blur(8px)', scale: 0.98, transition: { duration: 0.35, ease: 'easeInOut' } }}
          >
      {/* Left sidebar */}
  <aside className="glass rounded-2xl p-4 h-full overflow-y-auto">
        <h2 className="jarvis-title mb-3">J.A.R.V.I.S.</h2>
        <div className="text-sm jarvis-subtle">
          <div>Status: <span className="font-medium">{session.status}</span></div>
          <div>Speaking: {speaking ? 'yes' : 'no'}</div>
          <div>In call: {session.inCall ? 'yes' : 'no'}</div>
        </div>
        <div className="mt-4 space-y-2">
          <MicToggleButton disabled={!canUse || loadingMe} onAudioReady={handleAudio} />
          <button
            className="w-full jarvis-btn jarvis-btn-primary"
            onClick={()=>{
              // Save UI context for restore
              const active = document.activeElement as HTMLElement | null
              ;(window as any).__jarvis_restore_focus = active && active.focus ? active : null
              ;(window as any).__jarvis_scroll_y = window.scrollY
              session.setInCall(true)
              session.setMode('connecting')
              setTimeout(()=> session.setMode('call'), 350)
            }}
            disabled={!canUse}
          >Start Call</button>
          <button
            className="w-full jarvis-btn disabled:opacity-50"
            onClick={() => input.trim() && (sendText(input.trim(), 'typed'), setInput(''))}
            disabled={!canUse || !input.trim()}
          >Send text</button>
          <div className="flex items-center gap-2 text-xs">
            <span>Webhook:</span>
            <button className={`px-2 py-1 rounded border ${!useTestWebhook?'bg-blue-600 text-white':'border-cyan-200/20'}`} onClick={()=>setUseTestWebhook(false)}>Prod</button>
            <button className={`px-2 py-1 rounded border ${useTestWebhook?'bg-blue-600 text-white':'border-cyan-200/20'}`} onClick={()=>setUseTestWebhook(true)}>Test</button>
          </div>
          {!canUse && <div className="text-xs text-red-500">Sign in and be active to interact.</div>}
          <div className="pt-2 border-t">
            <SettingsPanel />
          </div>
        </div>
      </aside>

  {/* Main chat */}
  <main className="glass rounded-2xl p-4 h-full flex flex-col overflow-hidden">
  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {session.messages.map(m => (
    <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${m.role==='user'?'jarvis-bubble-user ml-auto':'jarvis-bubble-ai'}`}>
              {m.text}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
    className="jarvis-input flex-1"
            placeholder={canUse? 'Type a message…' : 'Sign in to chat'}
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={(e)=>{
              if ((e as any).isComposing) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const text = input.trim()
                if (canUse && text) {
                  sendText(text)
                  setInput('')
                }
              }
            }}
            disabled={!canUse}
          />
      <button className="jarvis-btn jarvis-btn-primary disabled:opacity-50" disabled={!canUse || !input.trim()} onClick={()=>{ sendText(input.trim()); setInput('') }}>Send</button>
        </div>
      </main>

      {/* Right panel */}
  <aside className="glass rounded-2xl p-4 h-full space-y-3 overflow-y-auto">
        <h3 className="text-cyan-300 font-semibold">Status</h3>
        <div className="text-sm">User: {loadingMe ? 'loading…' : (me ? `${me.email} (${me.status})` : 'guest')}</div>
        {!loadingMe && !me && (
          <div className="flex gap-2">
            <Link to="/signin" className="px-3 py-2 rounded-xl border border-cyan-200/20">Sign in</Link>
            <Link to="/signup" className="px-3 py-2 rounded-xl bg-blue-600 text-white">Sign up</Link>
          </div>
        )}
        {!loadingMe && me && (
          <div>
            <button className="px-3 py-2 rounded-xl border border-cyan-200/20" onClick={signOut}>Sign out</button>
          </div>
        )}
        {callSummary && (
          <div className="border rounded-lg p-2 text-sm">{callSummary}</div>
        )}
        {session.lastError && (
          <ErrorCard title={session.lastError.message} tech={`Kind: ${session.lastError.kind}`} details={String(session.lastError.detail||'')} onRetry={retry?.fn} />
        )}
        {retry && (
          <button className="px-3 py-2 rounded-xl border border-cyan-200/20" onClick={()=>retry.fn()}>{retry.label}</button>
        )}
        <div className="pt-2 border-t text-xs text-slate-500">
          Session: {session.sessionId.slice(0,8)}…
        </div>
      </aside>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Call Mode overlay */}
        <AnimatePresence>
          {session.mode === 'call' && (
            <CallMode
              key="call-mode"
              userId={me?.id}
              sessionId={session.sessionId}
              useTestWebhook={useTestWebhook}
              onTranscript={(t)=> session.appendMessage({ role: 'user', text: t, via: 'voice' })}
              onReply={(t)=> session.appendMessage({ role: 'assistant', text: t, via: 'api' })}
              onEnd={()=>{
                session.setInCall(false)
                session.setMode('chat')
                // Restore scroll and focus
                const y = (window as any).__jarvis_scroll_y
                if (typeof y === 'number') window.scrollTo({ top: y, behavior: 'instant' as any })
                const el = (window as any).__jarvis_restore_focus as HTMLElement | null
                try { el?.focus?.() } catch {}
              }}
            />
          )}
        </AnimatePresence>

        {toast && <ErrorToast message={toast} onClose={()=>setToast('')} />}
      </div>
  )
}
