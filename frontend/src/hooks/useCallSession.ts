import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError, sendToWebhook, synthesizeTTS, transcribeAudio, getTtsStreamUrl } from '../lib/api'
import { playAudioBuffer, stopAudio, playStreamUrl } from '../lib/audio'
import { CALLBACK_URL, PROD_WEBHOOK_URL, TEST_WEBHOOK_URL, SOURCE_NAME } from '../lib/config'

export type CallState = 'idle' | 'listening' | 'processing' | 'speaking'

export function useCallSession(opts: { userId: string | undefined; sessionId: string; useTestWebhook?: boolean; onTranscript?: (t: string)=>void; onReply?: (t: string)=>void; setStatus?: (s: string)=>void }) {
  const currentWebhookUrl = (opts.useTestWebhook ? TEST_WEBHOOK_URL : PROD_WEBHOOK_URL)
  const [state, setState] = useState<CallState>('idle')
  const [error, setError] = useState<AppError | null>(null)
  const mediaRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const keyHoldRef = useRef<boolean>(false)

  useEffect(()=>()=>cleanup(), [])

  const startListening = useCallback(async ()=>{
    if (state === 'listening') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 48000 } })
      mediaRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e)=> e.data && chunksRef.current.push(e.data)
      recorderRef.current = rec
      rec.start()
      setState('listening')
    } catch (e) {
      const err = new AppError('mic_denied', 'Microphone permission denied.', e)
      setError(err)
    }
  }, [state])

  async function stopRecorderAndGetBlob(): Promise<Blob> {
    const rec = recorderRef.current
    if (!rec) return new Blob(chunksRef.current, { type: 'audio/webm' })
    return new Promise<Blob>((resolve) => {
      const finalize = () => {
        // Give the browser a microtask to deliver any final dataavailable
        setTimeout(() => resolve(new Blob(chunksRef.current, { type: 'audio/webm' })), 0)
      }
      rec.addEventListener('stop', finalize, { once: true })
      try { rec.stop() } catch { finalize() }
    })
  }

  const stopAndSend = useCallback(async ()=>{
    if (state !== 'listening') return
    const blob = await stopRecorderAndGetBlob()
    cleanup()
    setState('processing')
    try {
      const { text } = await transcribeAudio(blob)
      opts.onTranscript?.(text)
  const { correlationId, immediateText } = await sendToWebhook(text, {
        userId: opts.userId || 'anon',
        webhookUrl: currentWebhookUrl,
        callbackUrl: CALLBACK_URL,
        source: SOURCE_NAME,
  sessionId: opts.sessionId,
  messageType: 'CallMessage'
      })
      let reply = immediateText || ''
      if (!reply) {
        const start = Date.now()
        const timeoutMs = 30000
        while (Date.now() - start < timeoutMs) {
          const r = await fetch(`${CALLBACK_URL}/${correlationId}`)
          if (r.ok) {
            try {
              const data = await r.json()
              if (data) {
                if (Array.isArray(data)) {
                  reply = data.map((d:any)=> typeof d==='string'? d : (d?.output||d?.result||d?.text||'')).filter(Boolean).join('\n\n')
                } else if (typeof data === 'object') {
                  reply = data.result || data.output || data.text || JSON.stringify(data)
                } else if (typeof data === 'string') reply = data
                if (reply) break
              }
            } catch {}
          }
          await new Promise(r=>setTimeout(r, 1200))
        }
      }
      opts.onReply?.(reply)
  setState('speaking')
  // Stream sanitized TTS audio (code omitted to save tokens)
  await playStreamUrl(getTtsStreamUrl(reply))
      setState('idle')
    } catch (e) {
      setError(AppError.from(e))
      setState('idle')
    }
  }, [state, opts.userId, opts.sessionId])

  function cleanup() {
    mediaRef.current?.getTracks?.().forEach(t=>t.stop())
    mediaRef.current = null
    recorderRef.current = null
    chunksRef.current = []
  }

  // Space PTT
  useEffect(()=>{
    const down = (e: KeyboardEvent)=>{
      if (e.code !== 'Space') return
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (keyHoldRef.current) return
      keyHoldRef.current = true
      e.preventDefault()
      startListening()
    }
    const up = (e: KeyboardEvent)=>{
      if (e.code !== 'Space') return
      if (!keyHoldRef.current) return
      keyHoldRef.current = false
      e.preventDefault()
      stopAndSend()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return ()=>{
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [startListening, stopAndSend])

  return {
    state,
    error,
    startListening,
    stopAndSend,
    resetError: ()=>setError(null),
    stopAll: async ()=>{ cleanup(); await stopAudio(); setState('idle') }
  }
}
