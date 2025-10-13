import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError, sendToWebhook, synthesizeTTS, transcribeAudio, getTtsStreamUrl } from '../lib/api'
import { stopAudio, playStreamUrl, enqueueStreamUrl, setOnQueueIdleListener, primeAudio, playPresetChime } from '../lib/audio'
import { CALLBACK_URL, PROD_WEBHOOK_URL, TEST_WEBHOOK_URL, SOURCE_NAME } from '../lib/config'
import { useResolvedWebhookUrls } from './useWebhookUrls'
import { parseVoiceMacro } from '../lib/commands'
import { storage } from '../lib/storage'

export type CallState = 'idle' | 'listening' | 'processing' | 'speaking'

export function useCallSession(opts: { userId: string | undefined; sessionId: string; useTestWebhook?: boolean; onTranscript?: (t: string)=>void; onReply?: (t: string)=>void; setStatus?: (s: string)=>void; customProcess?: (text: string) => Promise<string | void> }) {
  const { currentWebhookUrl } = useResolvedWebhookUrls(!!opts.useTestWebhook)
  const [state, setState] = useState<CallState>('idle')
  const [error, setError] = useState<AppError | null>(null)
  const mediaRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const keyHoldRef = useRef<boolean>(false)
  const shouldBeListeningRef = useRef<boolean>(false)
  const restartBackoffRef = useRef<number>(0)
  const resumeGuardRef = useRef<boolean>(false)
  const wakeLockRef = useRef<any>(null)
  const preferredInputIdRef = useRef<string | null>(null)
  // PTT behavior + chime (reads from Settings via localStorage)
  const pttModeRef = useRef<'hold' | 'toggle'>('hold')
  const pttChimeEnabledRef = useRef<boolean>(false)
  const chimePresetRef = useRef<string>('ding')
  const chimeVolumeRef = useRef<number>(0.2)
  const lastReplyRef = useRef<string>('')
  useEffect(() => {
    try { preferredInputIdRef.current = localStorage.getItem('ux_audio_input_device_id') } catch { preferredInputIdRef.current = null }
    // Read PTT + chime settings
    const readPrefs = () => {
      try { pttModeRef.current = (localStorage.getItem('ux_ptt_mode') as any) || 'hold' } catch {}
      try { pttChimeEnabledRef.current = JSON.parse(localStorage.getItem('ux_ptt_chime_enabled') || 'false') } catch {}
      try { chimePresetRef.current = localStorage.getItem('ux_wake_chime_preset') || 'ding' } catch {}
      try { chimeVolumeRef.current = Number(localStorage.getItem('ux_wake_chime_volume') || '0.2') } catch {}
    }
    readPrefs()
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return
      if (e.key.startsWith('ux_ptt_') || e.key.startsWith('ux_wake_chime_')) readPrefs()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(()=>()=>cleanup(), [])

  const acquireWakeLock = useCallback(async () => {
    try {
      if (document.visibilityState !== 'visible') return
      // @ts-ignore experimental API
      if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
        // @ts-ignore
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
        wakeLockRef.current?.addEventListener?.('release', () => { wakeLockRef.current = null })
      }
    } catch {}
  }, [])
  const releaseWakeLock = useCallback(()=>{ try { wakeLockRef.current?.release?.() } catch {}; wakeLockRef.current = null }, [])

  const restartWithBackoff = useCallback(()=>{
    if (!shouldBeListeningRef.current) return
    if (resumeGuardRef.current) return
    resumeGuardRef.current = true
    const next = restartBackoffRef.current > 0 ? Math.min(30000, restartBackoffRef.current * 2) : 500
    restartBackoffRef.current = next
    window.setTimeout(async ()=>{
      resumeGuardRef.current = false
      if (!shouldBeListeningRef.current) return
      await startListening()
    }, next)
  }, [])

  const startListening = useCallback(async ()=>{
    if (state === 'listening') return
    try {
      // Barge-in: cut any TTS as soon as user starts talking
      try { await stopAudio() } catch {}
      // Ensure AudioContext is primed to reduce first-utterance latency
      try { await primeAudio() } catch {}
      // Optional PTT start chime – play before mic starts to avoid recording the chime
      try {
        if (pttChimeEnabledRef.current) {
          await playPresetChime((chimePresetRef.current as any) || 'ding', Math.max(0, Math.min(1, Number(chimeVolumeRef.current) || 0.2)))
        }
      } catch {}
      const base: MediaStreamConstraints = { audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true, sampleRate: 48000 } as any }
      const withDevice: MediaStreamConstraints = preferredInputIdRef.current ? { audio: { ...(base.audio as any), deviceId: preferredInputIdRef.current } } : base
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(withDevice)
      } catch {
        // Safari/iOS or strict constraint failure fallback
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      }
      mediaRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e)=> e.data && chunksRef.current.push(e.data)
      rec.onerror = () => { if (shouldBeListeningRef.current) restartWithBackoff() }
      rec.onstop = () => {
        // If we didn't explicitly stop, try to recover
        if (shouldBeListeningRef.current) restartWithBackoff()
      }
      // If underlying track ends (sleep, device detach), attempt to resume
      stream.getTracks().forEach(t => t.addEventListener('ended', () => { if (shouldBeListeningRef.current) restartWithBackoff() }))
      recorderRef.current = rec
      rec.start()
      shouldBeListeningRef.current = true
      restartBackoffRef.current = 0
      try { await acquireWakeLock() } catch {}
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
    shouldBeListeningRef.current = false
    const blob = await stopRecorderAndGetBlob()
    // Optional PTT stop chime – mic is stopped now, so it won't be recorded
    try {
      if (pttChimeEnabledRef.current) {
        await playPresetChime((chimePresetRef.current as any) || 'ding', Math.max(0, Math.min(1, Number(chimeVolumeRef.current) || 0.2)))
      }
    } catch {}
    cleanup()
    releaseWakeLock()
    setState('processing')
    try {
      const { text } = await transcribeAudio(blob)
      // Voice macros: handle locally before contacting webhook
      const macro = parseVoiceMacro(text)
      if (macro) {
        if (macro.type === 'repeat') {
          const last = (lastReplyRef.current || '').trim()
          if (last) {
            setState('speaking')
            setOnQueueIdleListener(() => setState('idle'))
            await enqueueStreamUrl(getTtsStreamUrl(last))
          } else {
            setState('idle')
          }
          return
        }
        if (macro.type === 'bookmark') {
          const arr = storage.get('jarvis_bookmarks_v1', []) as Array<{ id: string; at: number; label?: string; transcript?: string }>
          arr.push({ id: crypto.randomUUID(), at: Date.now(), label: macro.label || 'Bookmark', transcript: lastReplyRef.current || undefined })
          storage.set('jarvis_bookmarks_v1', arr)
          setState('idle')
          return
        }
      }
      opts.onTranscript?.(text)
      // If a custom processor is provided, bypass webhook and let the feature handle the reply
      if (opts.customProcess) {
        let reply = ''
        try { reply = (await opts.customProcess(text)) || '' } catch {}
        if (reply && reply.trim()) {
          opts.onReply?.(reply)
          setState('speaking')
          setOnQueueIdleListener(() => setState('idle'))
          await enqueueStreamUrl(getTtsStreamUrl(reply))
          lastReplyRef.current = reply
        } else {
          setState('idle')
        }
        return
      }
      const { correlationId, immediateText } = await sendToWebhook(text, {
        userId: opts.userId || 'anon',
        webhookUrl: currentWebhookUrl,
        callbackUrl: CALLBACK_URL,
        source: SOURCE_NAME,
        sessionId: opts.sessionId,
        messageType: 'CallMessage'
      })
      let reply = immediateText || ''
      // If we received an immediateText, start speaking right away while we poll callback
      if (reply && reply.trim()) {
        try {
          setState('speaking')
          setOnQueueIdleListener(() => setState('idle'))
          await enqueueStreamUrl(getTtsStreamUrl(reply))
          lastReplyRef.current = reply
        } catch {/* non-fatal; we'll still poll */}
      }
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
      // If we didn't have immediateText and just resolved, speak now
      if (reply && reply.trim()) {
        opts.onReply?.(reply)
        // Queue the audio so multiple replies play sequentially
        setState('speaking')
        setOnQueueIdleListener(() => setState('idle'))
        await enqueueStreamUrl(getTtsStreamUrl(reply))
        lastReplyRef.current = reply
      } else {
        setState('idle')
      }
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
    releaseWakeLock()
  }

  // Space PTT
  useEffect(()=>{
    // Respect settings toggle for Spacebar PTT
    let enabled = false
    try { enabled = JSON.parse(localStorage.getItem('ux_space_ptt_enabled') || 'false') } catch {}
    if (!enabled) return
    const down = (e: KeyboardEvent)=>{
      if (e.code !== 'Space') return
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      const mode = pttModeRef.current
      if (mode === 'hold') {
        if (keyHoldRef.current) return
        keyHoldRef.current = true
        e.preventDefault()
        startListening()
      } else {
        // toggle mode – act on keydown (ignore repeats)
        if ((e as any).repeat) return
        e.preventDefault()
        if (state !== 'listening') startListening()
        else stopAndSend()
      }
    }
    const up = (e: KeyboardEvent)=>{
      if (e.code !== 'Space') return
      if (pttModeRef.current !== 'hold') return
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

  // Auto-resume after sleep/tab hidden if user expected to be listening
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (shouldBeListeningRef.current && state !== 'listening') restartWithBackoff()
        acquireWakeLock()
      } else {
        releaseWakeLock()
      }
    }
    const onPageShow = () => { if (shouldBeListeningRef.current && state !== 'listening') restartWithBackoff() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [state, restartWithBackoff, acquireWakeLock, releaseWakeLock])

  return {
    state,
    error,
    startListening,
    stopAndSend,
    resetError: ()=>setError(null),
    stopAll: async ()=>{ cleanup(); await stopAudio(); setState('idle') }
  }
}
