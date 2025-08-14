import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import AudioVisualizer from './AudioVisualizer'
import { setAudioLevelListener } from '../lib/audio'
import { useCallSession } from '../hooks/useCallSession'

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

  return (
    <AnimatePresence mode="wait">
      <motion.div key="call" variants={variants} initial="initial" animate="enter" exit="exit" className="fixed inset-0 z-40 grid place-items-center">
        <div className="glass p-6 rounded-2xl w-full max-w-xl mx-auto grid place-items-center">
          <AudioVisualizer level={level} mode={state === 'speaking' ? 'speaking' : (state === 'listening' ? 'listening' : 'idle')} onPointerPTT={(down)=> down ? startListening() : stopAndSend()} />
          <div className="mt-12 flex items-center gap-3">
            <button className="jarvis-btn" onClick={()=>startListening()} disabled={state==='listening'}>PTT</button>
            <button className="jarvis-btn jarvis-btn-primary" onClick={async()=>{ await stopAll(); onEnd() }}>End Call</button>
          </div>
          {error && (
            <div className="mt-3 text-sm text-red-300">{error.message} <button className="ml-2 underline" onClick={()=>resetError()}>Retry</button></div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
