import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import AudioVisualizer from './AudioVisualizer'
import AnimatedBackground from './AnimatedBackground'
import SubtitleDisplay from './SubtitleDisplay'
import WakeWordDebug from './WakeWordDebug'
import VADOverlay from './VADOverlay'
import { EFFECTS } from './effects'
import { storage } from '../lib/storage'
import { setAudioLevelListener } from '../lib/audio'
import { useCallSession } from '../hooks/useCallSession'
import { useAlwaysListening } from '../hooks/useAlwaysListening'
import NotesTranscriptPanel from './NotesTranscriptPanel'
import { parseNotesCommand } from '../lib/commands'
import { createNote, getNotesSettings, summarizeTranscript } from '../lib/api'

export default function AlwaysListeningMode({ userId, sessionId, useTestWebhook, onEnd, onTranscript, onReply }: {
  userId?: string,
  sessionId: string,
  useTestWebhook?: boolean,
  onEnd: () => void,
  onTranscript?: (t: string) => void,
  onReply?: (t: string) => void,
}) {
  const [level, setLevel] = useState(0)
  const [subtitle, setSubtitle] = useState('')
  const [isUserSubtitle, setIsUserSubtitle] = useState(false)
  const [showFollowupNudge, setShowFollowupNudge] = useState(false)
  const [mode, setMode] = useState<'ptt' | 'always_listening'>('ptt')
  const [vadMetrics, setVadMetrics] = useState<{ levelDb: number; noiseFloorDb: number; snrDb: number; speechPeakDb: number; inSpeech: boolean; silenceMs: number; speechMs: number } | null>(null)
  // Notes UI state
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesPaused, setNotesPaused] = useState(false)
  const [notesSummarizing, setNotesSummarizing] = useState(false)
  // Track a persisted note id for this call's notes to prevent duplicate creations
  const [noteIdForSession, setNoteIdForSession] = useState<string | null>(null)
  const [notesTranscript, setNotesTranscript] = useState('')
  const [notesInterim, setNotesInterim] = useState('')
  const [notesTitle, setNotesTitle] = useState<string>('Call Notes')
  const [showVadOverlay, setShowVadOverlay] = useState<boolean>(() => {
    try { return localStorage.getItem('jarvis_debug_vad') === 'true' } catch { return false }
  })
  const [showWakeDebug, setShowWakeDebug] = useState<boolean>(() => {
    try { return localStorage.getItem('ux_show_wake_debug') === 'true' } catch { return false }
  })
  useEffect(() => {
    const i = setInterval(() => {
      try {
        const v = localStorage.getItem('jarvis_debug_vad') === 'true'
        setShowVadOverlay(v)
        const w = localStorage.getItem('ux_show_wake_debug') === 'true'
        setShowWakeDebug(w)
      } catch {}
    }, 1000)
    return () => clearInterval(i)
  }, [])
  const rafRef = useRef<number | null>(null)
  
  const uid = (userId || (typeof window !== 'undefined' && (window as any).__jarvis_user_id) || 'anon') as string
  const [fx, setFx] = useState<keyof typeof EFFECTS>(() => {
    const v = storage.get(`jarvis_fx_effect:${uid}`, 'Lotus Bloom')
    return (Object.keys(EFFECTS) as Array<keyof typeof EFFECTS>).includes(v) ? (v as keyof typeof EFFECTS) : 'Lotus Bloom'
  })

  // PTT mode (existing functionality)
  const pttSession = useCallSession({ 
    userId, 
    sessionId, 
    useTestWebhook, 
    onTranscript, 
    onReply 
  })

  // Tuning state (persisted)
  const [showTuning, setShowTuning] = useState(false)
  const [vadConfig, setVadConfig] = useState(() => storage.get(`jarvis_vad_config:${uid}`, {}))
  const [endpointConfig, setEndpointConfig] = useState(() => storage.get(`jarvis_endpoint_config:${uid}`, {}))
  const [hardStopMs, setHardStopMs] = useState<number>(() => storage.get(`jarvis_recording_hard_stop_ms:${uid}`, 10000))
  const [debugVad, setDebugVad] = useState<boolean>(() => {
    try { return localStorage.getItem('jarvis_debug_vad') === 'true' } catch { return false }
  })
  // Quick sensitivity adjustments without full settings panel
  const [enterSnr, setEnterSnr] = useState<number>(() => { const v = Number(localStorage.getItem('vad_enter_snr_db')||''); return Number.isFinite(v)? v : 6 })
  const [exitSnr, setExitSnr] = useState<number>(() => { const v = Number(localStorage.getItem('vad_exit_snr_db')||''); return Number.isFinite(v)? v : 4 })
  useEffect(()=>{ try { localStorage.setItem('vad_enter_snr_db', String(enterSnr)) } catch {} }, [enterSnr])
  useEffect(()=>{ try { localStorage.setItem('vad_exit_snr_db', String(exitSnr)) } catch {} }, [exitSnr])
  // Quick-access conversation tuning (persist in localStorage so hook can read dynamically)
  const [initialNoSpeechSecUI, setInitialNoSpeechSecUI] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_initial_no_speech_sec') || '3')
    return Number.isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : 3
  })
  const [followupNoSpeechSecUI, setFollowupNoSpeechSecUI] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_followup_no_speech_sec') || '3')
    return Number.isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : 3
  })
  useEffect(() => { storage.set(`jarvis_vad_config:${uid}`, vadConfig) }, [vadConfig, uid])
  useEffect(() => { storage.set(`jarvis_endpoint_config:${uid}`, endpointConfig) }, [endpointConfig, uid])
  useEffect(() => { storage.set(`jarvis_recording_hard_stop_ms:${uid}`, hardStopMs) }, [hardStopMs, uid])
  useEffect(() => { try { localStorage.setItem('jarvis_debug_vad', debugVad ? 'true' : 'false') } catch {} }, [debugVad])
  useEffect(() => { try { localStorage.setItem('ux_initial_no_speech_sec', String(initialNoSpeechSecUI)) } catch {} }, [initialNoSpeechSecUI])
  useEffect(() => { try { localStorage.setItem('ux_followup_no_speech_sec', String(followupNoSpeechSecUI)) } catch {} }, [followupNoSpeechSecUI])
  
  // Inline mini-controls to help tune sensitivity quickly (optional)
  const TuningMini = () => (
    <div className="mt-2 flex items-center gap-3 text-xs text-slate-300">
      <span>VAD sensitivity:</span>
      <label className="flex items-center gap-1">Enter SNR
        <input type="number" step="0.5" className="w-16 bg-slate-800/60 border border-white/10 rounded px-1 py-0.5"
          value={enterSnr} onChange={e=>setEnterSnr(Number(e.target.value))} />
      </label>
      <label className="flex items-center gap-1">Exit SNR
        <input type="number" step="0.5" className="w-16 bg-slate-800/60 border border-white/10 rounded px-1 py-0.5"
          value={exitSnr} onChange={e=>setExitSnr(Number(e.target.value))} />
      </label>
    </div>
  )

  // Always listening mode (new functionality)
  console.log('[UI Component] Rendering - mode:', mode, 'enabled prop will be:', mode === 'always_listening')

  const alwaysListening = useAlwaysListening({
    userId,
    sessionId,
    useTestWebhook,
    onTranscript: (t) => {
      // Append to transcript buffer when notes are open and not paused
      if (notesOpen && !notesPaused) setNotesTranscript(prev => (prev ? prev + '\n' : '') + t)
      onTranscript?.(t)
    },
    onReply,
    onSubtitle: (text, isUser = false) => {
      setSubtitle(text)
      setIsUserSubtitle(isUser)
    },
    onInterimTranscript: (partial) => {
      if (notesOpen && !notesPaused) setNotesInterim(partial)
    },
    commandRouter: async (text) => {
      const cmd = parseNotesCommand(text)
      if (!cmd) return null
      // Handle commands locally
      if (cmd.type === 'notes_start' || cmd.type === 'notes_show') {
        setNotesOpen(true)
        setNotesPaused(false)
        // Begin capturing immediately so the transcript reflects the user's speech right away
        try {
          await alwaysListening.startImmediateRecording()
        } catch {}
        return { handled: true, speak: 'Starting notes. I will capture your transcript on the right.' }
      }
      if (cmd.type === 'notes_pause') {
        if (notesOpen) setNotesPaused(true)
        return { handled: true, speak: 'Paused notes.' }
      }
      if (cmd.type === 'notes_resume') {
        if (notesOpen) setNotesPaused(false)
        return { handled: true, speak: 'Resumed notes.' }
      }
      if (cmd.type === 'notes_hide') {
        setNotesOpen(false)
        return { handled: true }
      }
      if (cmd.type === 'notes_stop') {
        // If notes open, close and summarize; else treat as normal
        if (notesOpen) {
          await handleCloseNotes(true)
          return { handled: true, speak: 'Okay, I have summarized your notes.' }
        }
        return { handled: false }
      }
      return { handled: false }
    },
    enabled: mode === 'always_listening',
    vadConfig,
    endpointingConfig: endpointConfig,
    recordingHardStopMs: hardStopMs,
    onVadMetrics: (m) => setVadMetrics(m)
  })

  useEffect(() => { storage.set(`jarvis_fx_effect:${uid}`, fx) }, [fx, uid])
  
  useEffect(() => {
    const v = storage.get(`jarvis_fx_effect:${uid}`, fx)
    if ((Object.keys(EFFECTS) as Array<keyof typeof EFFECTS>).includes(v)) setFx(v as keyof typeof EFFECTS)
  }, [uid])


  // Visual feedback for audio levels
  useEffect(() => {
    const currentState = mode === 'always_listening' ? alwaysListening.state : pttSession.state
    
    if (currentState === 'listening' || currentState === 'recording' || currentState === 'speaking' || currentState === 'wake_listening') {
      const tick = () => {
        setLevel(l => Math.max(0, Math.min(1, l * 0.8 + Math.random() * 0.25)))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      setLevel(0.1)
    }
  }, [mode, alwaysListening.state, pttSession.state])

  // Subscribe to TTS playback levels
  useEffect(() => {
    setAudioLevelListener((v) => setLevel(prev => Math.max(prev * 0.6, Math.min(1, v))))
    return () => setAudioLevelListener(null)
  }, [])

  // Nudge logic moved below where currentState is defined

  // Optional keyboard shortcuts for always listening mode (VAD handles auto-stop)
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      const t = el as HTMLElement | null
      if (!t) return false
      const tag = (t.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return true
      if ((t as HTMLElement).isContentEditable) return true
      return false
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (mode !== 'always_listening') return
      // Ignore while typing in inputs/areas/contenteditable
      if (isTypingTarget(event.target)) return

      // T toggles transcript panel anytime during always-listening calls
      if (event.key.toLowerCase() === 't') {
        event.preventDefault()
        setNotesOpen(o => !o)
        return
      }

      // Only handle stop shortcut when actively recording
      if (alwaysListening.state === 'recording') {
        if (event.code === 'Space' || event.key === 'Enter') {
          event.preventDefault()
          console.log('[Always Listening] Manual stop triggered by', event.key)
          alwaysListening.stopRecordingAndProcess()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, alwaysListening.state, alwaysListening])

  const handleToggleMode = async () => {
    console.log('[UI] Toggle mode clicked, current mode:', mode)
    if (mode === 'ptt') {
      console.log('[UI] Switching to always listening mode...')
      // Set the UI mode first so hooks receive enabled=true on next render
      setMode('always_listening')
      // Stop any PTT activity
      await pttSession.stopAll()
      // Defer start slightly to allow re-render with enabled=true
      setTimeout(() => {
        alwaysListening.start()
      }, 0)
      console.log('[UI] Mode set to always_listening and start requested')
    } else {
      console.log('[UI] Switching to PTT mode...')
      await alwaysListening.stop()
      setMode('ptt')
      console.log('[UI] Mode set to ptt')
    }
  }

  const handleEndCall = async () => {
    // If notes are open, summarize before ending
    if (notesOpen && notesTranscript.trim()) {
      try { await handleCloseNotes(true) } catch {}
    }
    if (mode === 'always_listening') {
      await alwaysListening.stop()
    } else {
      await pttSession.stopAll()
    }
    onEnd()
  }

  // Close transcript panel; if summarize=true and we have content, call backend summarizer and save note, then speak confirmation
  const handleCloseNotes = async (summarize: boolean) => {
    setNotesOpen(false)
    setNotesPaused(false)
    setNotesInterim('')
    const text = notesTranscript.trim()
    if (!summarize || !text) {
      return
    }
    try {
      setNotesSummarizing(true)
      const prefs = await fetchPrefs()
      const { notes } = await summarizeTranscript(text, {
        instructions: prefs.instructions,
        collapsible: prefs.collapsible,
        categories: prefs.categories,
      })
      // Persist note: update existing for this session if set; else create once and remember ID
      try {
        if (noteIdForSession) {
          // Lazy import to avoid circular import warnings
          const { updateNote } = await import('../lib/api')
          await updateNote(noteIdForSession, { transcript: text, notes, title: (notesTitle || 'Call Notes').trim() })
        } else {
          const { createNote } = await import('../lib/api')
          const created = await createNote({ transcript: text, notes, title: (notesTitle || 'Call Notes').trim() })
          setNoteIdForSession(created.id)
        }
      } catch {}
      // Clear local buffer after saving
      setNotesTranscript('')
      // Speak confirmation inside the call
      try { await alwaysListening.speak('Your notes have been summarized.') } catch {}
    } finally {
      setNotesSummarizing(false)
    }
  }

  const variants = {
    initial: { opacity: 0, scale: 0.95, filter: 'blur(8px)' },
    enter: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.4, ease: 'easeOut' } },
    exit: { opacity: 0, scale: 0.95, filter: 'blur(8px)', transition: { duration: 0.25, ease: 'easeIn' } },
  }

  const effectHue: Record<keyof typeof EFFECTS, { hue: number; altHue?: number }> = {
    'Lotus Bloom': { hue: 195 },
    'Neon Tunnel': { hue: 200, altHue: 230 },
    'Radial Spectrum (Mic)': { hue: 195, altHue: 220 },
    'Dual Energy Ribbon': { hue: 200, altHue: 260 },
    'Neon Pulses': { hue: 195, altHue: 220 },
    'Particle Orbitals': { hue: 195, altHue: 210 },
    'Hex Grid Glow': { hue: 200, altHue: 230 },
    'Circuit Rain': { hue: 200, altHue: 210 },
    'Aurora Waves': { hue: 210, altHue: 220 },
    'Swirl Sprites': { hue: 210, altHue: 240 },
    'Photon Streaks': { hue: 260, altHue: 220 },
    'Halo Portal': { hue: 45, altHue: 55 },
  } as const

  const currentState = mode === 'always_listening' ? alwaysListening.state : pttSession.state
  const currentError = mode === 'always_listening' ? alwaysListening.error : pttSession.error
  const isActive = currentState === 'listening' || currentState === 'recording' || currentState === 'speaking' || currentState === 'wake_listening'

  // Get visualizer mode
  const visualizerMode = 
    currentState === 'speaking' ? 'speaking' :
    currentState === 'listening' || currentState === 'recording' || currentState === 'wake_listening' ? 'listening' :
    'idle'

  // Show a brief "Speak now…" nudge when entering a follow-up recording right after speaking state
  const prevStateRef = useRef(currentState)
  useEffect(() => {
    if (prevStateRef.current === 'speaking' && currentState === 'recording') {
      // Heuristic: if we went from speaking -> recording in always-listening mode, it's likely a follow-up
      if (mode === 'always_listening') {
        setShowFollowupNudge(true)
        const dur = (() => {
          const v = Number(localStorage.getItem('ux_followup_nudge_duration_ms') || '1500')
          return Number.isFinite(v) ? Math.max(300, Math.min(5000, Math.round(v))) : 1500
        })()
        const t = setTimeout(() => setShowFollowupNudge(false), dur)
        return () => clearTimeout(t)
      }
    }
    prevStateRef.current = currentState
  }, [currentState, mode])

  return (
    <AnimatePresence mode="wait">
      <motion.div key="call" variants={variants} initial="initial" animate="enter" exit="exit" className="fixed inset-0 z-40 grid place-items-center">
        {/* Animated background */}
        <div className="absolute inset-0 z-0">
          <AnimatedBackground effect={fx} micEnabled={isActive} />
        </div>
        
        <div className="relative z-10 w-full max-w-2xl mx-auto overflow-hidden rounded-2xl ring-1 ring-white/10 bg-slate-950/70 backdrop-blur">
          {/* Controls bar */}
          <div className="absolute left-4 top-4 z-30 flex items-center gap-2 rounded-2xl bg-slate-900/70 p-2 ring-1 ring-white/10 backdrop-blur">
            <label className="sr-only" htmlFor="fx-select">Effect</label>
            <select
              id="fx-select"
              value={fx}
              onChange={(e) => setFx(e.target.value as keyof typeof EFFECTS)}
              className="rounded-xl bg-slate-800/80 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-white/10"
            >
              {Object.keys(EFFECTS).map(k => <option key={k}>{k}</option>)}
            </select>
          </div>

          {/* Status indicator */}
          <div className="absolute right-4 top-4 z-30 rounded-2xl bg-slate-900/70 px-3 py-2 ring-1 ring-white/10 backdrop-blur">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                mode === 'always_listening' && alwaysListening.isWakeWordListening ? 'bg-green-400 animate-pulse' :
                isActive ? 'bg-blue-400' : 'bg-slate-500'
              }`} />
              <span className="text-xs text-slate-300">
                {mode === 'always_listening' ? 
                  (currentState === 'wake_listening' ? 'Wake Word' :
                   currentState === 'recording' ? 'Recording' :
                   currentState === 'processing' ? 'Processing' :
                   currentState === 'speaking' ? 'Speaking' : 'Always Listening') :
                  (currentState === 'listening' ? 'Listening' :
                   currentState === 'processing' ? 'Processing' :
                   currentState === 'speaking' ? 'Speaking' : 'Push to Talk')
                }
              </span>
              {mode === 'always_listening' && (() => { try { return JSON.parse(localStorage.getItem('ux_continuous_conversation') || 'false') } catch { return false } })() && (
                <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full ring-1 ring-emerald-400/20 bg-emerald-500/10 text-emerald-200">
                  Continuous
                </span>
              )}
              {mode === 'always_listening' && (
                <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full ring-1 ring-white/10 bg-slate-800/60 text-slate-300">
                  VAD: {alwaysListening.vadEngine?.toUpperCase()} {alwaysListening.vadEngine === 'wasm' && (
                    <>
                      • {alwaysListening.wasmActive ? 'active' : 'fallback'}
                    </>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="relative z-10 p-6 grid place-items-center">
            {/* Follow-up nudge */}
            <AnimatePresence>
              {showFollowupNudge && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-200 text-xs ring-1 ring-emerald-400/20"
                >
                  Speak now…
                </motion.div>
              )}
            </AnimatePresence>
            {/* Tuning toggle */}
            <div className="w-full mb-4 flex justify-end">
              <button className="jarvis-btn" onClick={() => setShowTuning(s => !s)}>
                {showTuning ? 'Hide Tuning' : 'Show Tuning'}
              </button>
            </div>
            {showTuning && (
              <div className="w-full mb-4 grid grid-cols-2 gap-3 text-xs bg-slate-900/70 p-3 rounded-xl ring-1 ring-white/10">
                <div className="col-span-2 text-slate-300 font-semibold">VAD</div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={debugVad} onChange={e => setDebugVad(e.target.checked)} />
                  <span>Verbose VAD logs</span>
                </label>
                <label className="flex items-center gap-2">
                  <span>Engine</span>
                  <select
                    className="jarvis-input"
                    value={vadConfig.engine ?? 'js'}
                    onChange={e => setVadConfig({ ...vadConfig, engine: e.target.value as 'js' | 'wasm' })}
                  >
                    <option value="js">JS (built-in)</option>
                    <option value="wasm">WASM (MicVAD)</option>
                  </select>
                </label>
                <div className="col-span-2 text-[10px] text-slate-400 -mt-2">
                  Tip: WASM uses a small model downloaded on first use and manages its own mic. If it fails, we automatically fall back to JS.
                </div>
                <label className="flex items-center gap-2">
                  <span>Enter SNR (dB)</span>
                  <input type="number" className="jarvis-input" defaultValue={vadConfig.enterSnrDb ?? 10} onChange={e => setVadConfig({ ...vadConfig, enterSnrDb: Number(e.target.value) })} />
                </label>
                <label className="flex items-center gap-2">
                  <span>Exit SNR (dB)</span>
                  <input type="number" className="jarvis-input" defaultValue={vadConfig.exitSnrDb ?? 6} onChange={e => setVadConfig({ ...vadConfig, exitSnrDb: Number(e.target.value) })} />
                </label>
                <label className="flex items-center gap-2">
                  <span>Rel. Drop (dB)</span>
                  <input type="number" className="jarvis-input" defaultValue={vadConfig.relativeDropDb ?? 12} onChange={e => setVadConfig({ ...vadConfig, relativeDropDb: Number(e.target.value) })} />
                </label>
                <label className="flex items-center gap-2">
                  <span>Silence Hangover (ms)</span>
                  <input type="number" className="jarvis-input" defaultValue={vadConfig.silenceHangoverMs ?? 700} onChange={e => setVadConfig({ ...vadConfig, silenceHangoverMs: Number(e.target.value) })} />
                </label>
                <label className="flex items-center gap-2">
                  <span>Abs Silence (dB)</span>
                  <input type="number" className="jarvis-input" defaultValue={vadConfig.absSilenceDb ?? -55} onChange={e => setVadConfig({ ...vadConfig, absSilenceDb: Number(e.target.value) })} />
                </label>
                <label className="flex items-center gap-2">
                  <span>Check Interval (ms)</span>
                  <input type="number" className="jarvis-input" defaultValue={vadConfig.checkIntervalMs ?? 30} onChange={e => setVadConfig({ ...vadConfig, checkIntervalMs: Number(e.target.value) })} />
                </label>
                <div className="col-span-2 text-slate-300 font-semibold mt-2">Endpointing</div>
                <label className="flex items-center gap-2">
                  <span>Watchdog (ms)</span>
                  <input type="number" className="jarvis-input" defaultValue={endpointConfig.watchdogMs ?? 15000} onChange={e => setEndpointConfig({ ...endpointConfig, watchdogMs: Number(e.target.value) })} />
                </label>
                <div className="col-span-2 text-slate-300 font-semibold mt-2">Hard Stop</div>
                <label className="flex items-center gap-2">
                  <span>Recording hard stop (ms)</span>
                  <input type="number" className="jarvis-input" value={hardStopMs} onChange={e => setHardStopMs(Number(e.target.value))} />
                </label>
                <div className="col-span-2 text-slate-300 font-semibold mt-2">Conversation</div>
                <label className="flex items-center gap-2">
                  <span>Initial no‑speech (s)</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    className="flex-1"
                    value={initialNoSpeechSecUI}
                    onChange={e => setInitialNoSpeechSecUI(Number(e.target.value))}
                  />
                  <span className="w-6 text-right">{initialNoSpeechSecUI}</span>
                </label>
                <label className="flex items-center gap-2">
                  <span>Follow‑up no‑speech (s)</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    className="flex-1"
                    value={followupNoSpeechSecUI}
                    onChange={e => setFollowupNoSpeechSecUI(Number(e.target.value))}
                  />
                  <span className="w-6 text-right">{followupNoSpeechSecUI}</span>
                </label>
                <div className="col-span-2 flex items-center justify-end gap-2">
                  <button className="jarvis-btn" onClick={() => {
                    // Reset to defaults
                    const defVad = {}
                    const defEndpoint = {}
                    const defHard = 10000
                    setVadConfig(defVad)
                    setEndpointConfig(defEndpoint)
                    setHardStopMs(defHard)
                    storage.remove(`jarvis_vad_config:${uid}`)
                    storage.remove(`jarvis_endpoint_config:${uid}`)
                    storage.remove(`jarvis_recording_hard_stop_ms:${uid}`)
                    // Re-render hook with defaults
                    if (mode === 'always_listening') {
                      setMode('ptt')
                      setTimeout(() => setMode('always_listening'), 0)
                    }
                  }}>Reset Defaults</button>
                  <button className="jarvis-btn jarvis-btn-primary" onClick={() => {
                    // Re-render hook with latest configs by toggling mode quickly if active
                    if (mode === 'always_listening') {
                      setMode('ptt')
                      setTimeout(() => setMode('always_listening'), 0)
                    }
                  }}>Apply</button>
                </div>
              </div>
            )}
            <AudioVisualizer
              level={level}
              mode={visualizerMode}
              onPointerPTT={(down) => {
                if (mode === 'ptt') {
                  down ? pttSession.startListening() : pttSession.stopAndSend()
                }
              }}
              hue={effectHue[fx]?.hue ?? 195}
              altHue={effectHue[fx]?.altHue}
            />
            
            <div className="mt-12 flex items-center gap-3">
              {mode === 'ptt' && (
                <button 
                  className="jarvis-btn" 
                  onClick={() => pttSession.startListening()} 
                  disabled={currentState === 'listening'}
                >
                  PTT
                </button>
              )}
              
              {mode === 'always_listening' && currentState === 'recording' && (
                <button 
                  className="jarvis-btn jarvis-btn-danger animate-pulse" 
                  onClick={() => alwaysListening.stopRecordingAndProcess()}
                >
                  🛑 Stop Recording (or just stop talking)
                </button>
              )}
              
              <button 
                className={`jarvis-btn ${mode === 'always_listening' ? 'jarvis-btn-primary' : ''}`}
                onClick={handleToggleMode}
              >
                {mode === 'always_listening' ? 'Always Listening ON' : 'Enable Always Listening'}
              </button>
              
              <button className="jarvis-btn jarvis-btn-primary" onClick={handleEndCall}>
                End Call
              </button>
              {/* Quick toggle for notes */}
              <button className="jarvis-btn" onClick={() => setNotesOpen(o => !o)}>
                {notesOpen ? 'Hide Transcript' : 'Show Transcript'}
              </button>
            </div>
            
            {currentError && (
              <div className="mt-3 text-sm text-red-300">
                {currentError.message} 
                <button 
                  className="ml-2 underline" 
                  onClick={() => {
                    if (mode === 'always_listening') {
                      alwaysListening.resetError()
                    } else {
                      pttSession.resetError()
                    }
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {alwaysListening.wakeWordError && (
              <div className="mt-2 text-sm text-yellow-300">
                Wake word detection: {alwaysListening.wakeWordError}
              </div>
            )}
          </div>
        </div>

        {/* Subtitle display */}
        <SubtitleDisplay 
          text={subtitle} 
          isUser={isUserSubtitle}
        />
      </motion.div>

      {/* Notes transcript side panel */}
      <NotesTranscriptPanel
        open={notesOpen}
        onClose={() => handleCloseNotes(true)}
        transcript={notesTranscript}
        interim={notesInterim}
        paused={notesPaused}
        onTogglePause={() => setNotesPaused(p => !p)}
        summarizing={notesSummarizing}
        title={notesTitle}
        onChangeTitle={setNotesTitle}
      />

      {/* Edge handle to reopen transcript when hidden */}
      {!notesOpen && (
        <button
          className="fixed right-0 top-1/2 -translate-y-1/2 z-50 px-2 py-3 rounded-l-xl bg-slate-900/80 text-slate-200 ring-1 ring-white/10 hover:bg-slate-800/80"
          aria-label="Show transcript"
          onClick={() => setNotesOpen(true)}
        >
          Transcript
        </button>
      )}
      
      {/* Wake Word Debug Panel - hidden by default; enable in Settings */}
      {showWakeDebug && (
        <WakeWordDebug 
          externalWakeWordDetection={alwaysListening.wakeWordDetection}
          enabled={mode === 'always_listening'}
          onForceReinitialize={alwaysListening.forceReinitialize}
          // @ts-ignore - extend debug to show VAD meters if present
          vadMetrics={vadMetrics}
          // @ts-ignore - additional debug props for engine status
          vadEngine={alwaysListening.vadEngine}
          wasmActive={alwaysListening.wasmActive}
        />
      )}

      {/* Minimal on-screen VAD overlay (follows the same debug toggle) */}
      {showVadOverlay && (
        <VADOverlay
          vadMetrics={vadMetrics || undefined}
          vadEngine={alwaysListening.vadEngine}
          wasmActive={alwaysListening.wasmActive}
        />
      )}
    </AnimatePresence>
  )
}

// Summarize then optionally persist note, and speak confirmation via the listening hook
async function fetchPrefs(): Promise<Awaited<ReturnType<typeof getNotesSettings>>> {
  try { return await getNotesSettings() } catch { return { instructions: '', collapsible: true, categories: true } as any }
}

