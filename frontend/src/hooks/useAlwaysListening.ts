import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError, sendToWebhook, transcribeAudio, getTtsStreamUrl, synthesizeTTS } from '../lib/api'
import { stopAudio, enqueueStreamUrl, enqueueAudioBuffer, enqueuePlayback, setOnQueueIdleListener, primeAudio, playChime, playPresetChime, playDataUrlWithVolume, speakWithWebSpeech } from '../lib/audio'
import { shouldSpeak, suppressSpeakingFor } from '../lib/speechGuard'
import { CALLBACK_URL, PROD_WEBHOOK_URL, TEST_WEBHOOK_URL, SOURCE_NAME } from '../lib/config'
import { useWakeWordDetection } from './useWakeWordDetection'
import { VADController, VadMetrics } from '../lib/vad'

export type AlwaysListeningState = 'idle' | 'wake_listening' | 'recording' | 'processing' | 'speaking'

export function useAlwaysListening(opts: { 
  userId: string | undefined
  sessionId: string
  useTestWebhook?: boolean
  onTranscript?: (t: string) => void
  onInterimTranscript?: (t: string) => void
  onReply?: (t: string) => void
  onSubtitle?: (t: string, isUser?: boolean) => void
  // Optional command router: if it handles the text, the hook will not send to n8n
  commandRouter?: (text: string) => Promise<{ handled: boolean; speak?: string } | null> | { handled: boolean; speak?: string } | null
  enabled?: boolean
  vadConfig?: Partial<{
    calibrationMs: number
    enterSnrDb: number
    exitSnrDb: number
    relativeDropDb: number
    minSpeechMs: number
    silenceHangoverMs: number
    absSilenceDb: number
    checkIntervalMs: number
    engine: 'js' | 'wasm'
  }>
  endpointingConfig?: Partial<{
    watchdogMs: number
  }>
  recordingHardStopMs?: number
  onVadMetrics?: (m: {
    levelDb: number
    noiseFloorDb: number
    snrDb: number
    speechPeakDb: number
    inSpeech: boolean
    silenceMs: number
    speechMs: number
  }) => void
}) {
  // Debug logging helper; toggled by localStorage key and evaluated dynamically
  const isDebug = () => {
    try { return localStorage.getItem('jarvis_debug_vad') === 'true' } catch { return false }
  }
  const dlog = (...args: any[]) => { if (isDebug()) console.log('[VAD-DEBUG]', ...args) }

  const [urls, setUrls] = useState<{ prod: string; test: string }>({ prod: '', test: '' })
  const currentWebhookUrl = opts.useTestWebhook ? (urls.test || TEST_WEBHOOK_URL) : (urls.prod || PROD_WEBHOOK_URL)
  const [vadEngine, setVadEngine] = useState<'js' | 'wasm'>(() => opts.vadConfig?.engine ?? 'js')
  const [wasmActive, setWasmActive] = useState<boolean>(false)
  // Track WASM VAD speech timings to guard against premature stop
  const wasmSpeechStartAtRef = useRef<number>(0)
  // Conversation toggles
  const isContinuousConversation = useRef<boolean>((() => {
    try { return JSON.parse(localStorage.getItem('ux_continuous_conversation') || 'false') } catch { return false }
  })())
  const isFollowupChimeEnabled = useRef<boolean>((() => {
    try { return JSON.parse(localStorage.getItem('ux_followup_chime_enabled') || 'true') } catch { return true }
  })())
  useEffect(() => {
    const t = setInterval(() => {
      try { isContinuousConversation.current = JSON.parse(localStorage.getItem('ux_continuous_conversation') || 'false') } catch {}
      try { isFollowupChimeEnabled.current = JSON.parse(localStorage.getItem('ux_followup_chime_enabled') || 'true') } catch {}
    }, 1000)
    return () => clearInterval(t)
  }, [])
  
  useEffect(() => {
    (async () => {
      try {
        const cached = {
          prod: localStorage.getItem('jarvis_webhook_prod') || '',
          test: localStorage.getItem('jarvis_webhook_test') || ''
        }
        if (cached.prod || cached.test) setUrls(cached)
        const r = await fetch('/api/webhook-urls', { cache: 'no-store' }).catch(() => null)
        if (r?.ok) {
          const data = await r.json()
          setUrls({ prod: data.prod || '', test: data.test || '' })
          try {
            localStorage.setItem('jarvis_webhook_prod', data.prod || '')
            localStorage.setItem('jarvis_webhook_test', data.test || '')
          } catch {}
        }
      } catch {}
    })()
  }, [])

  const [state, setState] = useState<AlwaysListeningState>('idle')
  // Keep an imperative ref of state to avoid stale closures in timers/callbacks
  const stateRef = useRef<AlwaysListeningState>('idle')
  useEffect(() => { stateRef.current = state }, [state])
  const setAppState = (s: AlwaysListeningState) => { stateRef.current = s; setState(s) }
  const [error, setError] = useState<AppError | null>(null)
  const [isWakeWordEnabled, setIsWakeWordEnabled] = useState(false)
  // Guards to avoid early finalize while arranging TTS fallback
  const fallbackSchedulingRef = useRef<boolean>(false)
  
  // Audio recording refs
  const mediaRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const recordingTimeoutRef = useRef<number | null>(null)
  const recordingStartRef = useRef<number>(0)
  const shouldBeRunningRef = useRef<boolean>(false)
  const restartBackoffRef = useRef<number>(0)
  const resumeGuardRef = useRef<boolean>(false)
  const wakeLockRef = useRef<any>(null)
  // Optional override for initial no-speech window (used for follow-up recordings)
  const noSpeechOverrideMsRef = useRef<number | null>(null)
  // Endpointing via Web Speech API during recording
  const endpointRecognitionRef = useRef<any>(null)
  const endpointWatchdogRef = useRef<number | null>(null)
  
  // Voice Activity Detection refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vadCheckRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number>(0)
  const hasDetectedSpeechRef = useRef<boolean>(false)
  const wasmVadRef = useRef<any>(null)
  const vadControllerRef = useRef<VADController | null>(null)
  const vadEndedLatchRef = useRef<boolean>(false)
  const noSpeechWatchdogRef = useRef<number | null>(null)
  const vadMetricsRef = useRef<{
    levelDb: number
    noiseFloorDb: number
    snrDb: number
    speechPeakDb: number
    inSpeech: boolean
    silenceMs: number
    speechMs: number
  }>({ levelDb: -90, noiseFloorDb: -90, snrDb: 0, speechPeakDb: -90, inSpeech: false, silenceMs: 0, speechMs: 0 })

  // Wake word detection
  console.log('[Always Listening] Wake word enabled calculation:', {
    'opts.enabled': opts.enabled,
    'isWakeWordEnabled': isWakeWordEnabled,
    'combined': opts.enabled && isWakeWordEnabled
  })
  
  const wakeWordDetection = useWakeWordDetection({
    enabled: opts.enabled && isWakeWordEnabled,
    onWakeWord: handleWakeWordDetected,
    wakeWords: ['jarvis', 'hey jarvis', 'okay jarvis']
  })

  function handleWakeWordDetected() {
    console.log('Wake word detected - starting recording...')
    dlog('Wake word detected: enabling recording flow')
    opts.onSubtitle?.('🎤 Recording... (speak now, auto-stops when you finish)', false)
    // Apply initial no-speech window from settings for the first turn
    try {
      const secRaw = Number(localStorage.getItem('ux_initial_no_speech_sec') || '8')
      const sec = Number.isFinite(secRaw) ? Math.max(1, Math.min(15, Math.round(secRaw))) : 8
      noSpeechOverrideMsRef.current = sec * 1000
    } catch { noSpeechOverrideMsRef.current = 8000 }
    startRecording()
  }

  const startRecording = useCallback(async () => {
    if (stateRef.current === 'recording') return
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 48000 } })
      mediaRef.current = stream
      chunksRef.current = []
      dlog('Acquired mic stream; creating MediaRecorder and starting')
      // Temporarily disable wake word while recording to avoid API conflicts
      setIsWakeWordEnabled(false)
      // Aggressively stop any existing wake word recognition instance
      try { wakeWordDetection.stopListening?.() } catch {}
      try { wakeWordDetection.cleanup?.() } catch {}
      
    const rec = new MediaRecorder(stream)
  rec.ondataavailable = (e) => e.data && chunksRef.current.push(e.data)
    rec.onerror = () => { if (shouldBeRunningRef.current) restartWithBackoff() }
    rec.onstop = () => { if (shouldBeRunningRef.current && stateRef.current === 'recording') restartWithBackoff() }
    // Track end -> attempt resume after sleep/device change
    stream.getTracks().forEach(t => t.addEventListener('ended', () => { if (shouldBeRunningRef.current) restartWithBackoff() }))
      recorderRef.current = rec
  // Add a small timeslice to flush chunks regularly to avoid long encoder stalls in some browsers
  const timeslice = (() => { const v = Number(localStorage.getItem('rec_timeslice_ms') || '0'); return Number.isFinite(v) && v >= 100 ? v : undefined })()
  try { rec.start(timeslice as any) } catch { rec.start() }
  dlog('MediaRecorder started; state=', rec.state)
      
  recordingStartRef.current = performance.now()
  setAppState('recording')
  dlog('Entered recording state')
    shouldBeRunningRef.current = true
    restartBackoffRef.current = 0
    try { await acquireWakeLock() } catch {}
      
      // Start voice activity detection for auto-stop
      startVoiceActivityDetection(stream)
      // Start endpointing recognizer as an additional end-of-utterance signal
  try { startEndpointing() } catch {}
      
      // Fallback timeout (hard stop)
      const hardStop = opts.recordingHardStopMs ?? 10000
      recordingTimeoutRef.current = setTimeout(() => {
        console.log('[Always Listening] Fallback timeout - auto-stopping recording after', hardStop, 'ms')
        dlog('Hard-stop timeout fired; invoking stopRecordingAndProcess')
        stopRecordingAndProcess()
      }, hardStop) as unknown as number
      
    } catch (e) {
      const err = new AppError('mic_denied', 'Microphone permission denied.', e)
      setError(err)
    }
  }, [])

  const stopRecordingAndProcess = useCallback(async () => {
    console.log('[Always Listening] stopRecordingAndProcess called, current state:', stateRef.current)
    dlog('stopRecordingAndProcess invoked; tearing down timers, endpointing, and recorder')
    if (stateRef.current !== 'recording') {
      console.log('[Always Listening] Not in recording state, returning')
      dlog('Ignored stop; not in recording state')
      return
    }
    
    console.log('[Always Listening] Stopping recording and processing...')
    
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = null
    }
    // Stop endpointing recognizer to avoid races
    if (endpointWatchdogRef.current) {
      clearTimeout(endpointWatchdogRef.current)
      endpointWatchdogRef.current = null
    }
    if (endpointRecognitionRef.current) {
      try { endpointRecognitionRef.current.onend = null } catch {}
      try { endpointRecognitionRef.current.onerror = null } catch {}
      try { endpointRecognitionRef.current.onresult = null } catch {}
      try { endpointRecognitionRef.current.stop() } catch {}
      endpointRecognitionRef.current = null
    }

    const blob = await stopRecorderAndGetBlob()
    console.log('[Always Listening] Audio blob size:', blob.size, 'bytes')
    dlog('Recorder stopped; received blob bytes=', blob.size)
    // If VAD never detected speech, do NOT send to STT/router; resume wake listening
    if (!hasDetectedSpeechRef.current || blob.size < 500) {
      dlog('No speech detected during segment; skipping STT and resuming wake listening')
      cleanup()
      setAppState('wake_listening')
      opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
      setIsWakeWordEnabled(true)
      setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
      return
    }

  cleanup()
  setAppState('processing')
  shouldBeRunningRef.current = true // still running overall; we're processing between recordings
  opts.onSubtitle?.('📝 Transcribing…', false)
  // Clear any interim transcript now that we're finalizing
  try { opts.onInterimTranscript?.('') } catch {}

    try {
      const { text } = await transcribeAudio(blob)
      if (text.trim()) {
        opts.onTranscript?.(text)
        opts.onSubtitle?.(text, true) // Show user's transcript
        opts.onSubtitle?.('🤔 Thinking…', false)
        // First, give a command router a chance to handle this utterance
        try {
          const route = await (typeof opts.commandRouter === 'function' ? opts.commandRouter(text) : null)
          if (route && route.handled) {
            // If the router wants Jarvis to speak a confirmation, enqueue it similar to reply flow
            if (route.speak) {
              if (!shouldSpeak(route.speak)) {
                setAppState('wake_listening')
                opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
                setIsWakeWordEnabled(true)
                setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
                return
              }
              suppressSpeakingFor(600)
              setIsWakeWordEnabled(false)
              try { wakeWordDetection.stopListening?.() } catch {}
              setAppState('speaking')
              let speakingWatchdog: any = setTimeout(() => {
                if (stateRef.current === 'speaking') finalizeListening()
              }, (() => { const v = Number(localStorage.getItem('ux_speaking_watchdog_ms') || '15000'); return Number.isFinite(v) ? Math.max(3000, Math.min(60000, Math.round(v))) : 15000 })())
              const finalizeListening = () => {
                try { clearTimeout(speakingWatchdog) } catch {}
                speakingWatchdog = null
                setAppState('wake_listening')
                opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
                setIsWakeWordEnabled(true)
                setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
              }
              setOnQueueIdleListener(() => {
                try { finalizeListening() } catch {}
              })
              try {
                try { await primeAudio() } catch {}
                await enqueueStreamUrl(getTtsStreamUrl(route.speak))
              } catch (streamErr) {
                try {
                  fallbackSchedulingRef.current = true
                  const buf = await synthesizeTTS(route.speak)
                  if (buf && buf.byteLength > 0) await enqueueAudioBuffer(buf)
                  else await enqueuePlayback(async () => { await speakWithWebSpeech(route.speak!) })
                  fallbackSchedulingRef.current = false
                } catch (fallbackErr) {
                  console.error('[Audio] Command speak failed:', fallbackErr)
                  fallbackSchedulingRef.current = false
                  // Even if speak fails, resume listening
                  setAppState('wake_listening')
                  opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
                  setIsWakeWordEnabled(true)
                  setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
                }
              }
            } else {
              // No speech needed; resume wake listening
              setAppState('wake_listening')
              opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
              setIsWakeWordEnabled(true)
              setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
            }
            return
          }
        } catch (cmdErr) {
          console.warn('[Always Listening] commandRouter error, falling through to webhook:', cmdErr)
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
        if (!reply) {
          const start = Date.now()
          // Allow overriding callback wait timeout via localStorage (5s..60s)
          const cbRaw = Number(localStorage.getItem('ux_callback_timeout_ms') || '30000')
          const timeoutMs = Number.isFinite(cbRaw) ? Math.max(5000, Math.min(60000, cbRaw)) : 30000
          while (Date.now() - start < timeoutMs) {
            const r = await fetch(`${CALLBACK_URL}/${correlationId}`)
            if (r.ok) {
              try {
                const data = await r.json()
                if (data) {
                  if (Array.isArray(data)) {
                    reply = data.map((d: any) => typeof d === 'string' ? d : (d?.output || d?.result || d?.text || '')).filter(Boolean).join('\n\n')
                  } else if (typeof data === 'object') {
                    reply = data.result || data.output || data.text || JSON.stringify(data)
                  } else if (typeof data === 'string') reply = data
                  if (reply) break
                }
              } catch {}
            }
            await new Promise(r => setTimeout(r, 1200))
          }
        }

        if (reply) {
          // Deduplicate against rapid same-text replies
          if (!shouldSpeak(reply)) {
            setAppState('wake_listening')
            opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
            setIsWakeWordEnabled(true)
            setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
            return
          }
          opts.onReply?.(reply)
          opts.onSubtitle?.(reply, false) // Show AI's reply

          // Queue the audio so multiple replies play sequentially
          // Avoid echo if an overlapping push event arrives with same text
          suppressSpeakingFor(800)
          // While Jarvis is speaking, disable wake word to avoid barge-in
          setIsWakeWordEnabled(false)
          try { wakeWordDetection.stopListening?.() } catch {}
          setAppState('speaking')
          // Watchdog: if for any reason onQueueIdle doesn't fire, force finalize
          let speakingWatchdog: any = setTimeout(() => {
            if (stateRef.current === 'speaking') {
              dlog('speaking watchdog elapsed -> forcing finalize listening state')
              try { finalizeListening() } catch {}
            }
          }, (() => {
            const v = Number(localStorage.getItem('ux_speaking_watchdog_ms') || '15000')
            return Number.isFinite(v) ? Math.max(3000, Math.min(60000, Math.round(v))) : 15000
          })())
          const finalizeListening = () => {
            try { clearTimeout(speakingWatchdog) } catch {}
            speakingWatchdog = null
            if (isContinuousConversation.current) {
              // Continuous conversation: optionally play follow-up chime then start recording immediately
              (async () => {
                try {
                  // Small delay to ensure clean transition after TTS ends
                  await new Promise(r => setTimeout(r, 150))
                  if (isFollowupChimeEnabled.current) {
                    const volRaw = Number(localStorage.getItem('ux_wake_chime_volume') || '0.2')
                    const vol = Number.isFinite(volRaw) ? Math.max(0, Math.min(1, volRaw)) : 0.2
                    const dataUrl = localStorage.getItem('ux_wake_chime_data_url')
                    const preset = localStorage.getItem('ux_wake_chime_preset') || 'ding'
                    await primeAudio()
                    if (dataUrl) {
                      await playDataUrlWithVolume(dataUrl, vol)
                    } else if (preset) {
                      await playPresetChime(preset as any, vol)
                    } else {
                      await playChime({ volume: vol })
                    }
                  }
                } catch {}
                // Respect user-tunable no-speech timeout for the follow-up
                try {
                  const secRaw = Number(localStorage.getItem('ux_followup_no_speech_sec') || '7')
                  const sec = Number.isFinite(secRaw) ? Math.max(1, Math.min(15, Math.round(secRaw))) : 7
                  noSpeechOverrideMsRef.current = sec * 1000
                } catch { noSpeechOverrideMsRef.current = 7000 }
                // Disable wake word during active recording
                setIsWakeWordEnabled(false)
                opts.onSubtitle?.('🎤 Follow-up: speak now…', false)
                // Start a fresh recording for the user's follow-up
                startRecording()
              })()
            } else {
              // Default: return to wake listening
              setAppState('wake_listening')
              opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
              setIsWakeWordEnabled(true)
              setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
            }
          }
          setOnQueueIdleListener(() => {
            if (fallbackSchedulingRef.current) {
              dlog('onQueueIdle fired during fallback scheduling; ignoring early idle')
              return
            }
            dlog('onQueueIdle fired -> finalize listening state; current state=', stateRef.current)
            // Always finalize: after TTS, resume correct listening state
            // Always call finalize, even if queue was interrupted or errored
            try {
              finalizeListening()
              dlog('finalizeListening complete; new state=', stateRef.current)
            } catch (e) {
              // As a last resort, force wake listening
              setAppState('wake_listening')
              opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
              setIsWakeWordEnabled(true)
              setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
              dlog('finalizeListening threw; forced wake_listening; err=', e)
            }
          })
          try {
            try { await primeAudio() } catch {}
            await enqueueStreamUrl(getTtsStreamUrl(reply))
          } catch (streamErr) {
            console.warn('[Audio] Stream playback failed, falling back to buffered/Web Speech:', streamErr)
            try {
              fallbackSchedulingRef.current = true
              const buf = await synthesizeTTS(reply)
              if (buf && buf.byteLength > 0) {
                await enqueueAudioBuffer(buf)
              } else {
                // Web Speech fallback: keep queue semantics by enqueuing a task that waits for speech end
                await enqueuePlayback(async () => { await speakWithWebSpeech(reply) })
              }
              // Fallback is now enqueued; allow idle to finalize after playback ends
              fallbackSchedulingRef.current = false
            } catch (fallbackErr) {
              console.error('[Audio] All playback methods failed:', fallbackErr)
              setError(AppError.from(fallbackErr, 'play_failed'))
              try { opts.onSubtitle?.('⚠️ Audio playback failed. Check TTS config or try again.', false) } catch {}
              // Nothing will play; clear scheduling flag so idle path can restore wake listening
              fallbackSchedulingRef.current = false
            }
          }
        } else {
          setAppState('wake_listening')
          opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
          setIsWakeWordEnabled(true)
          setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
        }
      } else {
        setAppState('wake_listening')
        opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
        setIsWakeWordEnabled(true)
        setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
      }
    } catch (e) {
      setError(AppError.from(e))
      setAppState('wake_listening')
      opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
      setIsWakeWordEnabled(true)
      setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
    }
  }, [opts.userId, opts.sessionId, currentWebhookUrl, opts])

  async function stopRecorderAndGetBlob(): Promise<Blob> {
    const rec = recorderRef.current
    if (!rec) return new Blob(chunksRef.current, { type: 'audio/webm' })
    return new Promise<Blob>((resolve) => {
      const finalize = () => {
        dlog('MediaRecorder onstop -> finalize blob; chunks=', chunksRef.current.length)
        setTimeout(async () => {
          let blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          // If the blob is too small, wait a short moment for straggler chunks (some browsers flush late)
          if (blob.size < 500) {
            await new Promise(r => setTimeout(r, 80))
            if (chunksRef.current.length > 0) blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          }
          resolve(blob)
        }, 0)
      }
      dlog('Stopping MediaRecorder... current state=', rec.state)
      rec.addEventListener('stop', finalize, { once: true })
      try { rec.stop() } catch { finalize() }
    })
  }

  function cleanup() {
    mediaRef.current?.getTracks?.().forEach(t => t.stop())
    mediaRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    try { wakeLockRef.current?.release?.() } catch {}
    wakeLockRef.current = null
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = null
    }
    // Also cleanup VAD
    stopVoiceActivityDetection()
    // Cleanup WASM VAD if it was started
    if (wasmVadRef.current) {
      try { wasmVadRef.current.pause?.() } catch {}
      try { wasmVadRef.current.stop?.() } catch {}
      try { wasmVadRef.current.destroy?.() } catch {}
      wasmVadRef.current = null
    }
    // Cleanup endpointing recognizer
    if (endpointWatchdogRef.current) {
      clearTimeout(endpointWatchdogRef.current)
      endpointWatchdogRef.current = null
    }
    if (endpointRecognitionRef.current) {
      try { endpointRecognitionRef.current.onend = null } catch {}
      try { endpointRecognitionRef.current.onerror = null } catch {}
      try { endpointRecognitionRef.current.onresult = null } catch {}
      try { endpointRecognitionRef.current.stop() } catch {}
      endpointRecognitionRef.current = null
    }
    // Reset any follow-up no-speech override after session ends
    noSpeechOverrideMsRef.current = null
  }

  // Voice Activity Detection - automatically stops when user stops speaking
  const startVoiceActivityDetection = useCallback((stream: MediaStream) => {
    try {
      const engineLs = (() => { try { return (localStorage.getItem('vad_engine') || '').toLowerCase() } catch { return '' } })()
      const engine = (opts.vadConfig?.engine ?? (engineLs === 'wasm' || engineLs === 'js' ? engineLs : 'js'))
      setVadEngine(engine)
      dlog('Starting VADController; engine=', engine)

      // Clear any previous
      try { vadControllerRef.current?.stop() } catch {}
      // Endpoint guard window for VAD-driven end events
      const vadEndpointGuardMs = (() => {
        const v = Number(localStorage.getItem('ux_vad_endpoint_guard_ms') || localStorage.getItem('ux_endpoint_guard_ms') || '1800')
        return Number.isFinite(v) ? Math.max(300, Math.min(5000, Math.round(v))) : 1800
      })()

      vadControllerRef.current = new VADController({
        engine,
        calibrationMs: opts.vadConfig?.calibrationMs,
        enterSnrDb: opts.vadConfig?.enterSnrDb,
        exitSnrDb: opts.vadConfig?.exitSnrDb,
        relativeDropDb: opts.vadConfig?.relativeDropDb,
        minSpeechMs: opts.vadConfig?.minSpeechMs,
        silenceHangoverMs: opts.vadConfig?.silenceHangoverMs,
        absSilenceDb: opts.vadConfig?.absSilenceDb,
        checkIntervalMs: opts.vadConfig?.checkIntervalMs,
        onSpeechStart: () => {
          dlog('VADController onSpeechStart')
          wasmSpeechStartAtRef.current = performance.now()
          hasDetectedSpeechRef.current = true
          // Cancel no-speech watchdog if running
          if (noSpeechWatchdogRef.current) {
            clearTimeout(noSpeechWatchdogRef.current)
            noSpeechWatchdogRef.current = null
          }
          opts.onSubtitle?.('🎤 Recording... (detected speech)', false)
        },
        onSpeechEnd: () => {
          dlog('VADController onSpeechEnd -> stopRecordingAndProcess if recording')
          // Ignore very early end events immediately after recording starts
          const sinceStart = performance.now() - recordingStartRef.current
          if (sinceStart < vadEndpointGuardMs) {
            dlog('VAD onSpeechEnd during guard window -> ignoring (sinceStart=', Math.round(sinceStart), 'ms)')
            return
          }
          if (stateRef.current === 'recording' && !vadEndedLatchRef.current) {
            vadEndedLatchRef.current = true
            stopVoiceActivityDetection()
            // Short pre-roll to ensure tail end of speech is captured
            setTimeout(() => { try { stopRecordingAndProcess() } catch {} }, 120)
          }
        },
        onMetrics: (m: VadMetrics) => {
          vadMetricsRef.current = m
          try { opts.onVadMetrics?.(m) } catch {}
        }
      })
      if (engine === 'wasm') setWasmActive(true); else setWasmActive(false)
      // Start VAD
      vadControllerRef.current.start(stream).catch((err) => {
        console.error('[VAD] Controller start failed:', err)
        // If WASM fails, automatically fall back to JS VAD
        if (engine === 'wasm') {
          try {
            dlog('Falling back to JS VAD engine after WASM init failure')
            setVadEngine('js')
            setWasmActive(false)
            vadControllerRef.current = new VADController({
              engine: 'js',
              calibrationMs: opts.vadConfig?.calibrationMs,
              enterSnrDb: opts.vadConfig?.enterSnrDb,
              exitSnrDb: opts.vadConfig?.exitSnrDb,
              relativeDropDb: opts.vadConfig?.relativeDropDb,
              minSpeechMs: opts.vadConfig?.minSpeechMs,
              silenceHangoverMs: opts.vadConfig?.silenceHangoverMs,
              absSilenceDb: opts.vadConfig?.absSilenceDb,
              checkIntervalMs: opts.vadConfig?.checkIntervalMs,
              onSpeechStart: () => {
                hasDetectedSpeechRef.current = true
                if (noSpeechWatchdogRef.current) { clearTimeout(noSpeechWatchdogRef.current); noSpeechWatchdogRef.current = null }
                opts.onSubtitle?.('🎤 Recording... (detected speech)', false)
              },
              onSpeechEnd: () => {
                const sinceStart = performance.now() - recordingStartRef.current
                if (sinceStart < vadEndpointGuardMs) return
                if (stateRef.current === 'recording' && !vadEndedLatchRef.current) {
                  vadEndedLatchRef.current = true
                  stopVoiceActivityDetection()
                  setTimeout(() => { try { stopRecordingAndProcess() } catch {} }, 120)
                }
              },
              onMetrics: (m: VadMetrics) => {
                vadMetricsRef.current = m
                try { opts.onVadMetrics?.(m) } catch {}
              }
            })
            vadControllerRef.current.start(stream).catch((e2) => {
              console.error('[VAD] JS fallback also failed:', e2)
              opts.onSubtitle?.('⚠️ Voice activity detection failed, using fallback timeout', false)
              if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current)
              recordingTimeoutRef.current = setTimeout(() => {
                console.log('[Always Listening] Fallback timeout (VAD failed) - auto-stopping recording after 10 seconds')
                stopRecordingAndProcess()
              }, 10000) as unknown as number
            })
          } catch (e) {
            console.error('[VAD] Failed creating JS fallback VADController:', e)
            opts.onSubtitle?.('⚠️ Voice activity detection failed, using fallback timeout', false)
            if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current)
            recordingTimeoutRef.current = setTimeout(() => {
              console.log('[Always Listening] Fallback timeout (VAD failed) - auto-stopping recording after 10 seconds')
              stopRecordingAndProcess()
            }, 10000) as unknown as number
          }
        } else {
          opts.onSubtitle?.('⚠️ Voice activity detection failed, using fallback timeout', false)
          if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current)
          recordingTimeoutRef.current = setTimeout(() => {
            console.log('[Always Listening] Fallback timeout (VAD failed) - auto-stopping recording after 10 seconds')
            stopRecordingAndProcess()
          }, 10000) as unknown as number
        }
      })

  // No-speech watchdog: auto stop if no speech soon after start
      const defaultWindow = 4500
      const windowMs = noSpeechOverrideMsRef.current ?? defaultWindow
      const noSpeechMs = (opts.vadConfig?.minSpeechMs ?? 250) + Math.max(1000, Math.min(5000, windowMs))
      if (noSpeechWatchdogRef.current) {
        clearTimeout(noSpeechWatchdogRef.current)
        noSpeechWatchdogRef.current = null
      }
      hasDetectedSpeechRef.current = false
      noSpeechWatchdogRef.current = setTimeout(() => {
        if (!hasDetectedSpeechRef.current && stateRef.current === 'recording') {
          console.log('[VAD] ⏱️ No speech detected soon after start — auto-stopping')
          dlog('no-speech watchdog -> stopping')
          stopVoiceActivityDetection()
          setTimeout(() => { try { stopRecordingAndProcess() } catch {} }, 80)
        }
      }, noSpeechMs) as unknown as number
    } catch (error) {
      console.error('[VAD] Failed to setup VADController:', error)
      opts.onSubtitle?.('⚠️ Voice activity detection failed, using fallback timeout', false)
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = setTimeout(() => {
        console.log('[Always Listening] Fallback timeout (VAD failed) - auto-stopping recording after 10 seconds')
        stopRecordingAndProcess()
      }, 10000) as unknown as number
    }
  }, [opts, stopRecordingAndProcess])

  const stopVoiceActivityDetection = useCallback(() => {
    console.log('[VAD] Stopping voice activity detection')
    dlog('stopVoiceActivityDetection invoked')
    // Stop controller
    try { vadControllerRef.current?.stop() } catch {}
    vadControllerRef.current = null
    // Clear any JS loop artifacts from legacy path
    if (vadCheckRef.current) { cancelAnimationFrame(vadCheckRef.current); vadCheckRef.current = null }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close() } catch {}
      audioContextRef.current = null
    }
    analyserRef.current = null
    // Clear no-speech watchdog
    if (noSpeechWatchdogRef.current) { clearTimeout(noSpeechWatchdogRef.current); noSpeechWatchdogRef.current = null }
    silenceStartRef.current = 0
    hasDetectedSpeechRef.current = false
  vadEndedLatchRef.current = false
    // Clear any old WASM instance tracking
    if (wasmVadRef.current) {
      try { wasmVadRef.current.pause?.() } catch {}
      try { wasmVadRef.current.stop?.() } catch {}
      try { wasmVadRef.current.destroy?.() } catch {}
      wasmVadRef.current = null
    }
    setWasmActive(false)
  }, [])

  // Hybrid endpointing using Web Speech API during recording
  const startEndpointing = useCallback(() => {
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (!SpeechRecognition) {
        console.log('[Endpoint] SpeechRecognition not supported - using VAD only')
        return
      }
      // Ensure any previous instance is stopped
      if (endpointRecognitionRef.current) {
        try { endpointRecognitionRef.current.stop() } catch {}
        endpointRecognitionRef.current = null
      }
      const recognition = new SpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = 'en-US'
      // Introduce a short guard period after recording starts during which
      // endpointing "no-speech" or early "onend" will be ignored to prevent
      // immediate auto-stops before the user begins speaking.
      const endpointGuardMs = (() => {
        const v = Number(localStorage.getItem('ux_endpoint_guard_ms') || '1800')
        return Number.isFinite(v) ? Math.max(300, Math.min(5000, Math.round(v))) : 1800
      })()
      recognition.onstart = () => {
        console.log('[Endpoint] SpeechRecognition endpointing started')
        dlog('endpointing started')
      }
      recognition.onresult = (event: any) => {
        try {
          if (typeof opts.onInterimTranscript === 'function') {
            const partial = Array.from(event.results)
              .map((r: any) => r[0]?.transcript || '')
              .join(' ')
              .trim()
            if (partial) opts.onInterimTranscript(partial)
          }
        } catch {}
        // Partial results indicate ongoing speech; onend signals silence
      }
      recognition.onerror = (event: any) => {
        console.log('[Endpoint] Recognition error:', event.error)
        dlog('endpointing error:', event.error)
        if (event.error === 'no-speech') {
          // Ignore very early no-speech errors within guard period
          const sinceStart = performance.now() - recordingStartRef.current
          if (sinceStart < endpointGuardMs) {
            dlog('endpointing no-speech during guard window -> ignoring (sinceStart=', Math.round(sinceStart), 'ms)')
            return
          }
          // Treat as silence; stop recording if still ongoing
          if (stateRef.current === 'recording') {
            console.log('[Endpoint] no-speech -> stopping recording')
            dlog('endpointing no-speech -> stopping')
            stopRecordingAndProcess()
          }
        }
      }
      recognition.onend = () => {
        console.log('[Endpoint] Recognition ended (likely silence)')
        dlog('endpointing ended')
        // Ignore very early end events within guard period
        const sinceStart = performance.now() - recordingStartRef.current
        if (sinceStart < endpointGuardMs) {
          dlog('endpointing ended during guard window -> ignoring (sinceStart=', Math.round(sinceStart), 'ms)')
          return
        }
        if (stateRef.current === 'recording') {
          stopRecordingAndProcess()
        }
      }
      endpointRecognitionRef.current = recognition
      try {
        recognition.start()
      } catch (err) {
        console.log('[Endpoint] Failed to start endpointing:', err)
      }
      // Watchdog: if it doesn't end by itself, let VAD/timeout handle
      const watchdogMs = opts.endpointingConfig?.watchdogMs ?? 15000
      endpointWatchdogRef.current = setTimeout(() => {
        console.log('[Endpoint] Watchdog elapsed - stopping endpointing')
        dlog('endpointing watchdog elapsed')
        if (endpointRecognitionRef.current) {
          try { endpointRecognitionRef.current.stop() } catch {}
          endpointRecognitionRef.current = null
        }
      }, watchdogMs) as unknown as number
    } catch (err) {
      console.log('[Endpoint] Unexpected error starting endpointing:', err)
      dlog('endpointing init failed', err)
    }
  }, [stopRecordingAndProcess, opts.endpointingConfig])

  const start = useCallback(async () => {
    console.log('[Always Listening] Start function called!')
    console.log('[Always Listening] Current state:', stateRef.current)
    console.log('[Always Listening] opts.enabled:', opts.enabled)
    console.log('[Always Listening] isWakeWordEnabled before:', isWakeWordEnabled)
    
    if (stateRef.current !== 'idle') {
      console.log('[Always Listening] Already running, current state:', stateRef.current)
      return
    }
    
    console.log('[Always Listening] Setting wake word enabled and state to wake_listening')
  setIsWakeWordEnabled(true)
    setAppState('wake_listening')
    opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
  shouldBeRunningRef.current = true
  restartBackoffRef.current = 0
  try { await acquireWakeLock() } catch {}
    
    // Proactively ensure the wake word engine is started
    try {
      await wakeWordDetection.ensureStarted?.()
    } catch {}
    console.log('[Always Listening] After setting - ensured wake word engine attempted to start')
  }, [opts])

  const stop = useCallback(async () => {
    console.log('[Always Listening] Stopping always listening mode...')
    setIsWakeWordEnabled(false)
    cleanup()
    await stopAudio()
    setAppState('idle')
    opts.onSubtitle?.('', false)
    shouldBeRunningRef.current = false
  }, [opts])

  // Cleanup on unmount
  useEffect(() => () => cleanup(), [])

  // Wake Lock helpers and auto-resume
  const acquireWakeLock = useCallback(async () => {
    try {
      if (document.visibilityState !== 'visible') return
      // @ts-ignore
      if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
        // @ts-ignore
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
        wakeLockRef.current?.addEventListener?.('release', () => { wakeLockRef.current = null })
      }
    } catch {}
  }, [])
  const restartWithBackoff = useCallback(() => {
    if (!shouldBeRunningRef.current) return
    if (resumeGuardRef.current) return
    resumeGuardRef.current = true
    const next = restartBackoffRef.current > 0 ? Math.min(30000, restartBackoffRef.current * 2) : 500
    restartBackoffRef.current = next
    window.setTimeout(async () => {
      resumeGuardRef.current = false
      if (!shouldBeRunningRef.current) return
      // Only restart recording if we were in recording when it failed; otherwise keep wake listening
      if (stateRef.current === 'recording' || stateRef.current === 'wake_listening') {
        try {
          if (stateRef.current !== 'recording') {
            // Return to wake listening and let wake word trigger next turn
            setAppState('wake_listening')
            setIsWakeWordEnabled(true)
            setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
          } else {
            await startRecording()
          }
        } catch {}
      }
    }, next)
  }, [startRecording, wakeWordDetection])
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (shouldBeRunningRef.current && stateRef.current !== 'idle') restartWithBackoff()
        acquireWakeLock()
      } else {
        try { wakeLockRef.current?.release?.() } catch {}
        wakeLockRef.current = null
      }
    }
    const onPageShow = () => { if (shouldBeRunningRef.current && stateRef.current !== 'idle') restartWithBackoff() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [restartWithBackoff, acquireWakeLock])

  // When combined enabled flips true (opts.enabled && isWakeWordEnabled), proactively ensure wake word engine is started
  useEffect(() => {
    const combinedEnabled = !!(opts.enabled && isWakeWordEnabled)
    console.log('[Always Listening] Combined enabled effect:', { combinedEnabled, optsEnabled: opts.enabled, isWakeWordEnabled })
    if (combinedEnabled) {
      // Small defer to ensure the detection hook saw enabled=true
      setTimeout(() => {
        wakeWordDetection.ensureStarted?.()
      }, 0)
    }
  }, [opts.enabled, isWakeWordEnabled])

  const forceReinitialize = useCallback(() => {
    console.log('[Always Listening] Force reinitialization requested')
    wakeWordDetection.cleanup()
    // Force re-initialization by toggling the internal state
    setIsWakeWordEnabled(false)
    setTimeout(() => {
      if (opts.enabled) { // Only restart if the main enabled flag is still true
        console.log('[Always Listening] Restarting after cleanup...')
        setIsWakeWordEnabled(true)
        // Also explicitly ensure it starts
        setTimeout(() => {
          wakeWordDetection.ensureStarted?.()
        }, 50)
      }
    }, 100)
  }, [opts.enabled, wakeWordDetection])

  return {
    state,
    error,
    isWakeWordListening: wakeWordDetection.isListening,
    wakeWordError: wakeWordDetection.error,
    wakeWordDetection, // Expose the full wake word detection object
    vadEngine,
    wasmActive,
    start,
    stop,
    forceReinitialize,
    resetError: () => setError(null),
    stopRecordingAndProcess,
    // Speak a short message using the same queuing and wake-word pause/resume semantics as replies
    speak: async (text: string) => {
      if (!text) return
      if (!shouldSpeak(text)) return
      suppressSpeakingFor(500)
      setIsWakeWordEnabled(false)
      try { wakeWordDetection.stopListening?.() } catch {}
      setAppState('speaking')
      let speakingWatchdog: any = setTimeout(() => {
        if (stateRef.current === 'speaking') finalizeListening()
      }, (() => { const v = Number(localStorage.getItem('ux_speaking_watchdog_ms') || '15000'); return Number.isFinite(v) ? Math.max(3000, Math.min(60000, Math.round(v))) : 15000 })())
      const finalizeListening = () => {
        try { clearTimeout(speakingWatchdog) } catch {}
        speakingWatchdog = null
        setAppState('wake_listening')
        opts.onSubtitle?.('👂 Listening for "Jarvis"...', false)
        setIsWakeWordEnabled(true)
        setTimeout(() => wakeWordDetection.ensureStarted?.(), 0)
      }
      setOnQueueIdleListener(() => { try { finalizeListening() } catch {} })
      try {
        try { await primeAudio() } catch {}
        await enqueueStreamUrl(getTtsStreamUrl(text))
      } catch (streamErr) {
        try {
          fallbackSchedulingRef.current = true
          const buf = await synthesizeTTS(text)
          if (buf && buf.byteLength > 0) await enqueueAudioBuffer(buf)
          else await enqueuePlayback(async () => { await speakWithWebSpeech(text) })
          fallbackSchedulingRef.current = false
        } catch {
          fallbackSchedulingRef.current = false
          finalizeListening()
        }
      }
    }
  }
}
