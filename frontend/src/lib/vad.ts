/*
  VAD Controller
  - Provides a unified interface for Voice Activity Detection in the browser
  - Engines:
    - 'js': Time-domain RMS + adaptive noise floor using AnalyserNode
    - 'wasm': Optional MicVAD from @ricky0123/vad-web
  - Emits:
    - onSpeechStart()
    - onSpeechEnd()
    - onMetrics({ levelDb, noiseFloorDb, snrDb, speechPeakDb, inSpeech, silenceMs, speechMs })

  Notes:
  - The JS engine works against a provided MediaStream and never touches the mic on its own
  - The WASM engine manages its own mic stream internally (MicVAD limitation/design)
*/

export type VadEngine = 'js' | 'wasm'

export type VadMetrics = {
  levelDb: number
  noiseFloorDb: number
  snrDb: number
  speechPeakDb: number
  inSpeech: boolean
  silenceMs: number
  speechMs: number
}

export type VadConfig = {
  engine?: VadEngine
  // JS engine tuning
  calibrationMs?: number
  enterSnrDb?: number
  exitSnrDb?: number
  relativeDropDb?: number
  minSpeechMs?: number
  silenceHangoverMs?: number
  absSilenceDb?: number
  checkIntervalMs?: number
  maxUtteranceMs?: number
  // WASM engine tuning
  wasmGuardMs?: number
  wasmMinSpeechMs?: number
  // Callbacks
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onMetrics?: (m: VadMetrics) => void
}

export class VADController {
  private engine: VadEngine
  private onSpeechStart?: () => void
  private onSpeechEnd?: () => void
  private onMetrics?: (m: VadMetrics) => void

  // JS engine state
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private rafId: number | null = null
  private speechStartTime = 0
  private silenceStart = 0
  private hasDetectedSpeech = false
  private inSpeech = false
  private noiseFloorDb = -60
  private speechPeakDb = -90
  private lastCheck = 0
  private floatData?: Float32Array
  private byteData?: Uint8Array
  private recordingStartAt = 0
  private jsConfig: Required<Pick<VadConfig,
    'calibrationMs' | 'enterSnrDb' | 'exitSnrDb' | 'relativeDropDb' | 'minSpeechMs' | 'silenceHangoverMs' | 'absSilenceDb' | 'checkIntervalMs' | 'maxUtteranceMs'
  >>

  // WASM engine
  private wasmVad: any = null
  private wasmConfig: { guardMs: number; minSpeechMs: number }

  constructor(cfg: VadConfig = {}) {
    this.engine = cfg.engine ?? 'js'
    this.onSpeechStart = cfg.onSpeechStart
    this.onSpeechEnd = cfg.onSpeechEnd
    this.onMetrics = cfg.onMetrics

    // Defaults tuned to be forgiving to prevent premature cutoffs
    this.jsConfig = {
      calibrationMs: cfg.calibrationMs ?? this.lnum('vad_calibration_ms', 1000),
      enterSnrDb: cfg.enterSnrDb ?? this.lnum('vad_enter_snr_db', 4.0),
      exitSnrDb: cfg.exitSnrDb ?? this.lnum('vad_exit_snr_db', 2.0),
      relativeDropDb: cfg.relativeDropDb ?? this.lnum('vad_relative_drop_db', 10),
      minSpeechMs: cfg.minSpeechMs ?? this.lnum('vad_min_speech_ms', 450),
      silenceHangoverMs: cfg.silenceHangoverMs ?? this.lnum('vad_silence_hangover_ms', 900),
      absSilenceDb: cfg.absSilenceDb ?? this.lnum('vad_abs_silence_db', -55),
      checkIntervalMs: cfg.checkIntervalMs ?? this.lnum('vad_check_interval_ms', 45),
      maxUtteranceMs: cfg.maxUtteranceMs ?? this.lnum('vad_max_utter_ms', 7000),
    }
    this.wasmConfig = {
      guardMs: cfg.wasmGuardMs ?? this.lnum('vad_wasm_guard_ms', 600),
      minSpeechMs: cfg.wasmMinSpeechMs ?? this.lnum('vad_wasm_min_speech_ms', 600),
    }
  }

  setEngine(engine: VadEngine) { this.engine = engine }

  async start(stream?: MediaStream) {
    if (this.engine === 'wasm') {
      await this.startWasm()
      // Also start a lightweight JS meter for metrics display if stream is provided
      if (stream) this.startJs(stream, { meterOnly: true })
      return
    }
    if (!stream) throw new Error('VADController.start(js): MediaStream is required')
    this.startJs(stream)
  }

  async stop() {
    // Stop JS path
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { await this.audioContext.close() } catch {}
      this.audioContext = null
    }
    this.analyser = null
    this.floatData = undefined
    this.byteData = undefined
    this.inSpeech = false
    this.hasDetectedSpeech = false
    this.silenceStart = 0
    this.speechStartTime = 0

    // Stop WASM path
    if (this.wasmVad) {
      try { this.wasmVad.pause?.() } catch {}
      try { this.wasmVad.stop?.() } catch {}
      try { this.wasmVad.destroy?.() } catch {}
      this.wasmVad = null
    }
  }

  private lnum(key: string, def: number) {
    try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) ? v : def } catch { return def }
  }

  private startJs(stream: MediaStream, opts?: { meterOnly?: boolean }) {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const analyser = audioContext.createAnalyser()
    const source = audioContext.createMediaStreamSource(stream)
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.0
    source.connect(analyser)
    // Best-effort resume in case the AudioContext starts suspended
    try { if ((audioContext as any).state === 'suspended') audioContext.resume?.() } catch {}
    this.audioContext = audioContext
    this.analyser = analyser

    const bufferLength = analyser.fftSize
    this.floatData = new Float32Array(bufferLength)
    this.byteData = new Uint8Array(bufferLength)

    const now = () => performance.now()
    const ema = (prev: number, next: number, alpha: number) => prev * (1 - alpha) + next * alpha

    this.noiseFloorDb = -60
    this.inSpeech = false
    this.hasDetectedSpeech = false
    this.silenceStart = 0
    this.speechStartTime = 0
    this.speechPeakDb = -90
    this.lastCheck = performance.now()
    const calibratedUntil = now() + this.jsConfig.calibrationMs
    this.recordingStartAt = performance.now()

    const rmsDbFromBuffer = () => {
      if ((this.analyser as any)?.getFloatTimeDomainData) {
        // Cast to any to accommodate differing lib DOM typings across environments
        ;(this.analyser as any).getFloatTimeDomainData(this.floatData as any)
        let sum = 0
        for (let i = 0; i < this.floatData!.length; i++) sum += this.floatData![i] * this.floatData![i]
        const rms = Math.sqrt(sum / this.floatData!.length) + 1e-8
        return 20 * Math.log10(rms)
      } else {
        ;(this.analyser as any).getByteTimeDomainData(this.byteData as any)
        let sum = 0
        for (let i = 0; i < this.byteData!.length; i++) {
          const v = (this.byteData![i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / this.byteData!.length) + 1e-8
        return 20 * Math.log10(rms)
      }
    }

    const tick = () => {
      if (!this.analyser) return
      const t = performance.now()
      if (t - this.lastCheck < this.jsConfig.checkIntervalMs) {
        this.rafId = requestAnimationFrame(tick)
        return
      }
      this.lastCheck = t

      const levelDb = rmsDbFromBuffer()
      const snrDb = levelDb - this.noiseFloorDb

      if (t < calibratedUntil) this.noiseFloorDb = Math.max(-90, ema(this.noiseFloorDb, levelDb, 0.3))
      else if (!this.inSpeech) this.noiseFloorDb = Math.max(-90, ema(this.noiseFloorDb, levelDb, 0.05))
      else if (snrDb < 4) this.noiseFloorDb = Math.max(-90, ema(this.noiseFloorDb, levelDb, 0.008))

      // Small sensitivity boost for first ~1.2s after start
      const sinceStart = t - this.recordingStartAt
      const enterBoost = sinceStart < 1200 ? 2 : 0
      const exitBoost = sinceStart < 1200 ? 1 : 0
      const isAboveEnter = snrDb >= (this.jsConfig.enterSnrDb - enterBoost)
      const isAboveExit = snrDb >= (this.jsConfig.exitSnrDb - exitBoost)

      if (!this.inSpeech) {
        if (isAboveEnter) {
          this.inSpeech = true
          this.hasDetectedSpeech = true
          this.speechStartTime = t
          this.speechPeakDb = levelDb
          this.silenceStart = 0
          this.onSpeechStart?.()
        }
      } else {
        // Track peak with mild decay
        this.speechPeakDb = Math.max(levelDb, this.speechPeakDb - 0.15)
        // Hard cutoff for very long utterances (safety net for environments with no clean silence)
        const speechDurationNow = t - this.speechStartTime
        if (speechDurationNow >= this.jsConfig.maxUtteranceMs && (t - (this.silenceStart || t)) > 300) {
          this.inSpeech = false
          this.onSpeechEnd?.()
        } else {
        const relativeDrop = (this.speechPeakDb - levelDb) >= this.jsConfig.relativeDropDb
        const absSilent = levelDb <= this.jsConfig.absSilenceDb
        const silentCandidate = !isAboveExit || relativeDrop || absSilent
        if (silentCandidate) {
          if (this.silenceStart === 0) this.silenceStart = t
          else {
            const silenceDuration = t - this.silenceStart
            const speechDuration = t - this.speechStartTime
            if (speechDuration > this.jsConfig.minSpeechMs && silenceDuration > this.jsConfig.silenceHangoverMs) {
              this.inSpeech = false
              this.onSpeechEnd?.()
              // Do not return; continue emitting metrics
            }
          }
        } else {
          this.silenceStart = 0
        }
        }
      }

      const silenceMs = this.silenceStart ? (t - this.silenceStart) : 0
      const speechMs = this.speechStartTime ? (t - this.speechStartTime) : 0
      this.onMetrics?.({
        levelDb,
        noiseFloorDb: this.noiseFloorDb,
        snrDb,
        speechPeakDb: this.speechPeakDb,
        inSpeech: this.inSpeech,
        silenceMs,
        speechMs,
      })

      this.rafId = requestAnimationFrame(tick)
    }

    // Begin loop
    this.rafId = requestAnimationFrame(tick)
  }

  private async startWasm() {
    const mod: any = await import(/* @vite-ignore */ '@ricky0123/vad-web')
    const MicVAD = (mod && (mod.MicVAD || mod.default?.MicVAD || mod.default || mod)) as any
    if (!MicVAD || !MicVAD.new) throw new Error('MicVAD not available')

    let speechStartAt = 0
    const vad = await MicVAD.new({
      startOnLoad: true,
      positiveSpeechThreshold: 0.45,
      negativeSpeechThreshold: 0.35,
      preSpeechPadMs: 800,
      redemptionMs: 1500,
      minSpeechMs: this.wasmConfig.minSpeechMs,
      onSpeechStart: () => {
        speechStartAt = performance.now()
        this.hasDetectedSpeech = true
        this.inSpeech = true
        this.onSpeechStart?.()
      },
      onSpeechEnd: () => {
        const sinceStart = performance.now() - speechStartAt
        if (sinceStart < this.wasmConfig.guardMs) return
        if (sinceStart < this.wasmConfig.minSpeechMs) return
        this.inSpeech = false
        this.onSpeechEnd?.()
      }
    })
    this.wasmVad = vad
  }
}
