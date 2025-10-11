import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import AudioVisualizer from './AudioVisualizer'
import AnimatedBackground from './AnimatedBackground'
import { EFFECTS } from './effects'
import { storage } from '../lib/storage'
import { setAudioLevelListener } from '../lib/audio'
import { useCallSession } from '../hooks/useCallSession'
import { useStreamingCall } from '../hooks/useStreamingCall'

export default function CallMode({ userId, sessionId, useTestWebhook, onEnd, onTranscript, onReply }: {
  userId?: string,
  sessionId: string,
  useTestWebhook?: boolean,
  onEnd: ()=>void,
  onTranscript?: (t: string)=>void,
  onReply?: (t: string)=>void,
}) {
  const { state, error, resetError, startListening, stopAndSend, stopAll } = useCallSession({ userId, sessionId, useTestWebhook, onTranscript, onReply })
  const [level, setLevel] = useState(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const uid = (userId || (typeof window !== 'undefined' && (window as any).__jarvis_user_id) || 'anon') as string
  const [fx, setFx] = useState<keyof typeof EFFECTS>(() => {
    const v = storage.get(`jarvis_fx_effect:${uid}`, 'Lotus Bloom')
    return (Object.keys(EFFECTS) as Array<keyof typeof EFFECTS>).includes(v) ? (v as keyof typeof EFFECTS) : 'Lotus Bloom'
  })
  // Background mic reactivity disabled per request; rely on PTT only
  const [streamingEnabled, setStreamingEnabled] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('ux_streaming_mode') || 'false') } catch { return false }
  })
  const { state: streamState, partials: streamPartials, finals: streamFinals, connect: streamConnect, disconnect: streamDisconnect, sendText: streamSend } = useStreamingCall()
  const [streamInput, setStreamInput] = useState('')

  // Keep streaming flag in sync if user toggles settings while call is open
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ux_streaming_mode' && e.newValue != null) {
        try { setStreamingEnabled(JSON.parse(e.newValue)) } catch {}
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Auto-connect streaming channel when enabled
  useEffect(() => {
    if (streamingEnabled) {
      streamConnect()
      return () => { try { streamDisconnect() } catch {} }
    }
  }, [streamingEnabled])

  useEffect(() => { storage.set(`jarvis_fx_effect:${uid}`, fx) }, [fx, uid])
  // If user changes mid-session, reload their prefs
  useEffect(() => {
    const v = storage.get(`jarvis_fx_effect:${uid}`, fx)
    if ((Object.keys(EFFECTS) as Array<keyof typeof EFFECTS>).includes(v)) setFx(v as keyof typeof EFFECTS)
  }, [uid])

  // Fake/approximate animation input level (visual feedback) when we don't have analyser
  useEffect(()=>{
    if (state === 'listening' || state === 'speaking') {
      const tick = ()=>{
        setLevel(l => Math.max(0, Math.min(1, l*0.8 + Math.random()*0.25)))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      return ()=>{ if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      setLevel(0.1)
    }
  }, [state])

  // Subscribe to TTS playback levels
  useEffect(()=>{
    setAudioLevelListener((v)=> setLevel(prev => Math.max(prev*0.6, Math.min(1, v))))
    return ()=> setAudioLevelListener(null)
  }, [])

  const variants = {
    initial: { opacity: 0, scale: 0.95, filter: 'blur(8px)' },
    enter: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.4, ease: 'easeOut' } },
    exit: { opacity: 0, scale: 0.95, filter: 'blur(8px)', transition: { duration: 0.25, ease: 'easeIn' } },
  }

  // Map effect -> primary/secondary hues to match background palette
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

  return (
    <AnimatePresence mode="wait">
      <motion.div key="call" variants={variants} initial="initial" animate="enter" exit="exit" className="fixed inset-0 z-40 grid place-items-center">
        {/* Make the animated effects cover the entire background of the call overlay */}
        <div className="absolute inset-0 z-0">
          <AnimatedBackground effect={fx} micEnabled={state === 'listening' || state === 'speaking'} />
        </div>
        <div className="relative z-10 w-full max-w-2xl mx-auto overflow-hidden rounded-2xl ring-1 ring-white/10 bg-slate-950/70 backdrop-blur">
          {/* Controls bar */}
          <div className="absolute left-4 top-4 z-30 flex items-center gap-2 rounded-2xl bg-slate-900/70 p-2 ring-1 ring-white/10 backdrop-blur">
            <label className="sr-only" htmlFor="fx-select">Effect</label>
            <select
              id="fx-select"
              value={fx}
              onChange={(e)=>setFx(e.target.value as keyof typeof EFFECTS)}
              className="rounded-xl bg-slate-800/80 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-white/10"
            >
              {Object.keys(EFFECTS).map(k => <option key={k}>{k}</option>)}
            </select>
          </div>

          <div className="relative z-10 p-6 grid place-items-center">
          <AudioVisualizer
            level={level}
            mode={state === 'speaking' ? 'speaking' : (state === 'listening' ? 'listening' : 'idle')}
            onPointerPTT={(down)=> down ? startListening() : stopAndSend()}
            hue={effectHue[fx]?.hue ?? 195}
            altHue={effectHue[fx]?.altHue}
          />
          {streamingEnabled && (
            <div className="mt-3 px-2 py-1 text-[11px] rounded-full bg-emerald-900/40 ring-1 ring-emerald-400/30 text-emerald-200">
              Streaming {streamState === 'connected' ? '●' : streamState === 'connecting' ? '…' : '○'}
            </div>
          )}
          <div className="mt-12 flex items-center gap-3">
            <button className="jarvis-btn" onClick={()=>startListening()} disabled={state==='listening'}>PTT</button>
            <button className="jarvis-btn jarvis-btn-primary" onClick={async()=>{ await stopAll(); onEnd() }}>End Call</button>
          </div>
          {streamingEnabled && (
            <div className="mt-6 w-full max-w-xl mx-auto">
              <div className="text-xs text-slate-300 mb-1">Streaming test</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded bg-slate-800/70 ring-1 ring-white/10 px-3 py-2 text-sm outline-none"
                  placeholder={streamState==='connected' ? 'Type text to stream…' : 'Connecting…'}
                  value={streamInput}
                  onChange={(e)=>setStreamInput(e.target.value)}
                  disabled={streamState!=='connected'}
                />
                <button
                  className="jarvis-btn"
                  disabled={streamState!=='connected' || !streamInput.trim()}
                  onClick={()=>{ if (streamInput.trim()) { streamSend(streamInput.trim()); setStreamInput('') } }}
                >Send</button>
              </div>
              {(streamPartials || (streamFinals && streamFinals.length)) && (
                <div className="mt-3 rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-3 text-left text-sm text-slate-200 max-h-40 overflow-auto">
                  {streamFinals.map((t, i) => (
                    <div key={i} className="mb-1"><span className="text-emerald-300">Final:</span> {t}</div>
                  ))}
                  {streamPartials && (<div className="opacity-80"><span className="text-cyan-300">Partial:</span> {streamPartials}</div>)}
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="mt-3 text-sm text-red-300">{error.message} <button className="ml-2 underline" onClick={()=>resetError()}>Retry</button></div>
          )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
