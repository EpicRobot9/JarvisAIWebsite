import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import MicToggleButton from '../../src/components/MicToggleButton'
import SettingsPanel from '../../src/components/SettingsPanel'
import ErrorToast from '../../src/components/ErrorToast'
import ErrorCard from '../../src/components/ErrorCard'
import { AppError, sendToRouter, sendToWebhook, synthesizeTTS, transcribeAudio } from '../../src/lib/api'
import { stopAudio, cacheTts, hasCachedTts, playCachedTts, isPlayingMessage, playAudioBufferForMessage } from '../../src/lib/audio'
import { useEventChannel } from '../../src/lib/events'
import { useSession } from '../../src/lib/session'
import { CALLBACK_URL, PROD_WEBHOOK_URL, TEST_WEBHOOK_URL, SOURCE_NAME } from '../../src/lib/config'
import { motion, AnimatePresence } from 'framer-motion'
import CallMode from '../../src/components/CallMode'
import Markdown from '../../src/components/ui/Markdown'
import { Play as PlayIcon, Square as StopIcon, Mic as MicIcon, MicOff as MicOffIcon } from 'lucide-react'

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
  const lastAssistantIdRef = useRef<string>('')
  const [callSummary, setCallSummary] = useState<string>('')
  const [ttsLoading, setTtsLoading] = useState<Set<string>>(new Set())

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

  // Event channel: push/push-voice/call-end with delegated speaking
  useEventChannel(session.sessionId, {
    onPush: async (ev) => {
      const id = crypto.randomUUID()
      session.appendMessage({ id, role: ev.role || 'assistant', text: ev.text, via: 'api' })
      lastAssistantIdRef.current = id
    },
    onCallEnd: (ev) => {
      setCallSummary(ev.reason || 'Call ended')
      session.setInCall(false)
      setSpeaking(false)
      stopAudio()
    },
    setSpeaking,
    onSpeak: async (text: string) => {
      if (session.muted) return
      try {
        session.setStatus('speaking')
        setSpeaking(true)
        await stopAudio() // interrupt any current
        // Cache and play for the most recent assistant message id
        const mid = lastAssistantIdRef.current || crypto.randomUUID()
        // Synthesize and cache if needed
        if (!hasCachedTts(mid)) {
          const buf = await synthesizeTTS(text)
          cacheTts(mid, buf)
          await playAudioBufferForMessage(mid, buf)
        } else {
          await playCachedTts(mid)
        }
      } finally {
        setSpeaking(false)
        session.setStatus('idle')
      }
    }
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
        const id = crypto.randomUUID()
        session.appendMessage({ id, role: 'assistant', text: immediateText, via: 'api' })
        lastAssistantIdRef.current = id
        lastReplyRef.current = immediateText
        // Speak with interrupt + cache if not muted
        if (!session.muted) {
          session.setStatus('speaking')
          setSpeaking(true)
          await stopAudio()
          const buf = await synthesizeTTS(immediateText)
          cacheTts(id, buf)
          await playAudioBufferForMessage(id, buf)
          setSpeaking(false)
          session.setStatus('idle')
        } else {
          session.setStatus('idle')
        }
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
          const id = crypto.randomUUID()
          session.appendMessage({ id, role:'assistant', text: resolved, via:'api' })
          lastAssistantIdRef.current = id
          lastReplyRef.current = resolved
          if (!session.muted) {
            session.setStatus('speaking')
            setSpeaking(true)
            await stopAudio()
            const buf = await synthesizeTTS(resolved)
            cacheTts(id, buf)
            await playAudioBufferForMessage(id, buf)
            setSpeaking(false)
            session.setStatus('idle')
          } else {
            session.setStatus('idle')
          }
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
  if (session.muted) return
  session.setStatus('speaking')
  setSpeaking(true)
  await stopAudio()
  const id = crypto.randomUUID()
  const buf = await synthesizeTTS(text)
  cacheTts(id, buf)
  await playAudioBufferForMessage(id, buf)
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
            <div key={m.id} className="flex items-start gap-2">
              {m.role === 'assistant' && (
                <div className="pt-1">
                  {!session.muted ? (
                    isPlayingMessage(m.id) ? (
                      <button
                        className="px-2 py-1 rounded border border-cyan-200/20 text-xs"
                        title="Stop playback"
                        aria-label="Stop"
                        onClick={async ()=>{ await stopAudio() }}
                      >
                        <StopIcon className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        className="px-2 py-1 rounded border border-cyan-200/20 text-xs disabled:opacity-50"
                        disabled={ttsLoading.has(m.id)}
                        title="Play message"
                        aria-label="Play"
                        onClick={async ()=>{
                          if (session.muted) return
                          await stopAudio()
                          if (!hasCachedTts(m.id)) {
                            setTtsLoading(s => new Set([...s, m.id]))
                            try {
                              const buf = await synthesizeTTS(m.text)
                              cacheTts(m.id, buf)
                              await playAudioBufferForMessage(m.id, buf)
                            } catch (e) {
                              const err = AppError.from(e)
                              session.setError(err)
                              setToast(err.message)
                            } finally {
                              setTtsLoading(s => { const n = new Set(s); n.delete(m.id); return n })
                            }
                          } else {
                            await playCachedTts(m.id)
                          }
                        }}
                      >
                        <PlayIcon className={`w-4 h-4 ${ttsLoading.has(m.id) ? 'opacity-60 animate-pulse' : ''}`} />
                      </button>
                    )
                  ) : (
                    <span className="text-slate-400 text-xs">Muted</span>
                  )}
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${m.role==='user'?'jarvis-bubble-user ml-auto':'jarvis-bubble-ai'}`}>
                <Markdown content={m.text} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2 items-center">
          <MicToggleButton disabled={!canUse || loadingMe} onAudioReady={handleAudio} />
          <button
            className={`inline-flex items-center justify-center h-10 w-10 rounded-xl border transition-colors ${session.muted ? 'bg-red-600 text-white border-red-500 hover:bg-red-500' : 'border-cyan-200/20 text-slate-200 hover:bg-white/5'}`}
            title={session.muted ? 'Unmute assistant voice' : 'Mute assistant voice'}
            aria-label={session.muted ? 'Unmute assistant voice' : 'Mute assistant voice'}
            onClick={() => session.setMuted(!session.muted)}
          >
            {session.muted ? (
              <MicOffIcon className="w-5 h-5" />
            ) : (
              <MicIcon className="w-5 h-5" />
            )}
          </button>
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
            {me.role === 'admin' && (
              <div className="mt-2">
                <Link to="/admin" className="px-3 py-2 inline-block rounded-xl border border-cyan-200/20">Admin Panel</Link>
              </div>
            )}
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
