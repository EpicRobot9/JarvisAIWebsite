/**
 * Audio utilities for encoding and playback.
 */

let audioCtx: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null
let currentMediaEl: HTMLAudioElement | null = null
let currentMediaNode: MediaElementAudioSourceNode | null = null
let levelListener: ((level: number)=>void) | null = null
let rafId: number | null = null
let currentMessageId: string | null = null
const ttsCache = new Map<string, ArrayBuffer>()

// --- Simple playback queue for sequential TTS/streams ---
type QueueTask = () => Promise<void>
// Internal queue stores wrappers that handle resolve/reject per task
const playbackQueue: Array<() => Promise<void>> = []
let processingQueue = false
let onQueueIdle: (() => void) | null = null

async function runQueue() {
  if (processingQueue) return
  processingQueue = true
  try {
    while (playbackQueue.length > 0) {
      const task = playbackQueue.shift()!
      // Wrapper already handles resolve/reject; do not rethrow here
      try { await task() } catch { /* noop: wrapper rejected to caller */ }
    }
  } finally {
    processingQueue = false
    // When nothing queued and nothing playing, notify idle
    if (playbackQueue.length === 0 && !isAudioActive()) {
      // Defer slightly to allow callers to enqueue fallbacks in the same tick
      setTimeout(() => {
        if (playbackQueue.length === 0 && !isAudioActive()) {
          try {
            try { console.debug('[Audio] queue idle (runQueue deferred) – firing onQueueIdle') } catch {}
            onQueueIdle?.()
          } catch {}
        }
      }, 60)
    }
  }
}

export function enqueuePlayback(task: QueueTask): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Wrap the task: propagate success/failure to this promise
    const wrapper = async () => {
      try {
        await task()
        resolve()
      } catch (e) {
        try { reject(e as any) } catch {}
        // Re-throw so runQueue awaits a rejected promise (caught there),
        // preventing premature idle semantics for failed tasks
        throw e
      }
    }
    playbackQueue.push(wrapper)
    // kick runner
    void runQueue()
  })
}

export function enqueueStreamUrl(url: string): Promise<void> {
  return enqueuePlayback(async () => { await playStreamUrl(url) })
}
export function enqueueAudioBuffer(buf: ArrayBuffer): Promise<void> {
  return enqueuePlayback(async () => { await playAudioBuffer(buf) })
}
export function clearPlaybackQueue() {
  playbackQueue.splice(0, playbackQueue.length)
}
export function getPlaybackQueueLength(): number { return playbackQueue.length }
export function setOnQueueIdleListener(fn: (()=>void) | null) { onQueueIdle = fn }
export function isAudioActive(): boolean {
  // Active if a WebAudio BufferSource is playing
  if (currentSource) return true
  // Active if an <audio> element exists and is currently playing
  if (currentMediaEl) {
    try {
      // Consider not active if paused or ended
      if (currentMediaEl.paused || (currentMediaEl as any).ended) return false
    } catch {}
    return true
  }
  return false
}

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 })
  return audioCtx
}

// --- Autoplay unlock helpers ---
let unlocked = false
export async function primeAudio(): Promise<void> {
  try {
    const ctx = getCtx()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    unlocked = ctx.state === 'running'
  } catch { /* ignore */ }
}
export function installAutoplayUnlocker() {
  if (unlocked) return
  const handler = async () => {
    try { await primeAudio() } catch {}
    if (unlocked) {
      document.removeEventListener('click', handler)
      document.removeEventListener('keydown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }
  document.addEventListener('click', handler, { once: false })
  document.addEventListener('keydown', handler, { once: false })
  document.addEventListener('touchstart', handler, { once: false })
}

export function isAudioReady(): boolean {
  try {
    const ctx = getCtx()
    return ctx.state === 'running'
  } catch { return false }
}

/**
 * Convert an audio Blob (webm/opus) to a 16-bit PCM WAV ArrayBuffer.
 * Uses WebAudio to decode and re-encode.
 */
export async function blobToWav(blob: Blob): Promise<ArrayBuffer> {
  const ctx = getCtx()
  const arr = await blob.arrayBuffer()
  const audioBuf = await ctx.decodeAudioData(arr.slice(0))
  const numChannels = Math.min(2, audioBuf.numberOfChannels)
  const sampleRate = 48000
  // Resample to 48k using OfflineAudioContext
  const offline = new OfflineAudioContext(numChannels, Math.ceil(audioBuf.duration * sampleRate), sampleRate)
  const src = offline.createBufferSource()
  src.buffer = audioBuf
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  const wav = encodeWAV(rendered, numChannels, sampleRate)
  return wav
}

function encodeWAV(buffer: AudioBuffer, channels: number, sampleRate: number): ArrayBuffer {
  const frames = buffer.length
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = frames * blockAlign
  const headerSize = 44
  const totalSize = headerSize + dataSize
  const out = new ArrayBuffer(totalSize)
  const view = new DataView(out)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM
  view.setUint16(20, 1, true) // audio format PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // PCM data interleaved by channel
  let offset = 44
  const tmp = new Float32Array(buffer.length)
  for (let ch = 0; ch < channels; ch++) {
    buffer.copyFromChannel(tmp, ch)
    for (let i = 0; i < tmp.length; i++) {
      const sample = Math.max(-1, Math.min(1, tmp[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      offset += 2
    }
  }

  return out
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

/**
 * Decode and play an audio ArrayBuffer via WebAudio. Returns a promise that resolves when playback stops.
 */
export async function playAudioBuffer(arrayBuffer: ArrayBuffer): Promise<void> {
  const ctx = getCtx()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
  await stopAudio()
  const src = ctx.createBufferSource()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  const data = new Uint8Array(analyser.frequencyBinCount)
  src.buffer = audioBuffer
  src.connect(analyser)
  analyser.connect(ctx.destination)
  currentSource = src
  await ctx.resume()
  return new Promise((resolve) => {
    src.onended = () => {
      if (currentSource === src) currentSource = null
  currentMessageId = null
      if (rafId) { cancelAnimationFrame(rafId); rafId = null }
      // If queue has more, runner will pick next; otherwise notify idle
      if (!processingQueue && getPlaybackQueueLength() === 0) {
        try {
          try { console.debug('[Audio] queue idle (buffer onended) – firing onQueueIdle') } catch {}
          onQueueIdle?.()
        } catch {}
      }
      resolve()
    }
    // Visualizer loop
    if (levelListener) {
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i=0;i<data.length;i++) { const v = (data[i]-128)/128; sum += v*v }
        const rms = Math.sqrt(sum / data.length)
        try { levelListener(Math.min(1, rms * 3)) } catch {}
        rafId = requestAnimationFrame(tick)
      }
      tick()
    }
    src.start(0)
  })
}

/** Stop any currently playing audio gracefully. */
export async function stopAudio(): Promise<void> {
  if (currentSource) {
    try { currentSource.stop() } catch {}
    try { currentSource.disconnect() } catch {}
    currentSource = null
  }
  if (currentMediaEl) {
    try { currentMediaEl.pause() } catch {}
    try { currentMediaEl.src = '' } catch {}
    currentMediaEl = null
  }
  if (currentMediaNode) {
    try { currentMediaNode.disconnect() } catch {}
    currentMediaNode = null
  }
  // Also cancel any Web Speech utterances to prevent overlap
  try { (window as any).speechSynthesis?.cancel?.() } catch {}
  currentMessageId = null
}

/** Allow UI to subscribe to playback level [0..1] for visualization. */
export function setAudioLevelListener(listener: ((level:number)=>void) | null) {
  levelListener = listener
}

/**
 * Stream and play audio from a URL (e.g., /api/tts/stream?...),
 * starting playback as soon as data arrives. Uses an HTMLAudioElement
 * connected to WebAudio for visualization.
 */
export async function playStreamUrl(url: string): Promise<void> {
  const ctx = getCtx()
  await stopAudio()
  const audio = new Audio()
  audio.src = url
  audio.preload = 'auto'
  audio.crossOrigin = 'use-credentials'
  // Connect to analyser for level visualization
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  const data = new Uint8Array(analyser.frequencyBinCount)
  const node = ctx.createMediaElementSource(audio)
  node.connect(analyser)
  analyser.connect(ctx.destination)
  currentMediaEl = audio
  currentMediaNode = node
  await ctx.resume()
  return new Promise((resolve, reject) => {
    let started = false
    audio.addEventListener('ended', () => {
      try { console.debug('[Audio] media ended') } catch {}
      if (rafId) { cancelAnimationFrame(rafId); rafId = null }
      currentMessageId = null
      // Clear active media refs so isAudioActive reflects reality
      try { currentMediaEl = null } catch {}
      try { currentMediaNode?.disconnect() } catch {}
      currentMediaNode = null
      if (!processingQueue && getPlaybackQueueLength() === 0) {
        try { onQueueIdle?.() } catch {}
      }
      resolve()
    })
    audio.addEventListener('error', () => {
      try { console.debug('[Audio] media error') } catch {}
      if (rafId) { cancelAnimationFrame(rafId); rafId = null }
      const me = (audio as any).error as MediaError | undefined
      const code = me?.code
      const codeMsg = code === 1 ? 'ABORTED' : code === 2 ? 'NETWORK' : code === 3 ? 'DECODE' : code === 4 ? 'SRC_NOT_SUPPORTED' : 'UNKNOWN'
      const online = typeof navigator !== 'undefined' ? navigator.onLine : undefined
      const src = audio.currentSrc || url
      // Don't fire idle here; let runQueue's deferred idle handle it after any fallback enqueue
      reject(new Error(`Audio playback error (code: ${code ?? 'n/a'} ${codeMsg}, online=${online}) for ${src}`))
    })
    audio.addEventListener('canplay', async () => {
      if (started) return
      started = true
      try { await audio.play() } catch (e) { reject(e) }
    })
    // Visualizer loop
    if (levelListener) {
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i=0;i<data.length;i++) { const v = (data[i]-128)/128; sum += v*v }
        const rms = Math.sqrt(sum / data.length)
        try { levelListener(Math.min(1, rms * 3)) } catch {}
        rafId = requestAnimationFrame(tick)
      }
      tick()
    }
  })
}

/** Get available Web Speech API voices */
export function getWebSpeechVoices(): SpeechSynthesisVoice[] {
  try {
    const synth: SpeechSynthesis | undefined = (window as any).speechSynthesis
    if (!synth) return []
    return synth.getVoices()
  } catch {
    return []
  }
}

/** Fallback: speak via Web Speech API (if available). */
export function speakWithWebSpeech(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const synth: SpeechSynthesis | undefined = (window as any).speechSynthesis
      if (!synth) return reject(new Error('Web Speech not available'))
      
      const utt = new SpeechSynthesisUtterance(text)
      
      // Try to select a better voice based on user preference
      const voices = synth.getVoices()
      const webSpeechPreference = localStorage.getItem('user_web_speech_voice') || 'auto'
      
      if (webSpeechPreference !== 'auto' && voices.length > 0) {
        // Try to find the preferred voice
        const preferredVoice = voices.find(voice => voice.name === webSpeechPreference)
        if (preferredVoice) {
          utt.voice = preferredVoice
        }
      } else if (voices.length > 0) {
        // Auto-select: prefer English voices, then any available voice
        const englishVoices = voices.filter(voice => voice.lang.startsWith('en'))
        if (englishVoices.length > 0) {
          utt.voice = englishVoices[0]
        }
      }
      
      // Configure speech parameters
      let rate = 0.85 // Default slightly slower than normal for clarity
      try {
        const saved = Number(localStorage.getItem('ux_web_speech_rate') || '0.85')
        if (Number.isFinite(saved)) rate = Math.max(0.5, Math.min(1.5, saved))
      } catch {}
      utt.rate = rate
      utt.pitch = 1.0
      utt.volume = 0.8
      
      utt.onend = () => resolve()
      utt.onerror = (e) => reject(e.error || new Error('Speech synthesis failed'))
      try { synth.speak(utt) } catch (e) { reject(e as any) }
    } catch (e) {
      reject(e as any)
    }
  })
}

// --- TTS cache helpers ---
export function cacheTts(messageId: string, buf: ArrayBuffer) {
  ttsCache.set(messageId, buf)
}
export function hasCachedTts(messageId: string): boolean {
  return ttsCache.has(messageId)
}
export function getCachedTts(messageId: string): ArrayBuffer | undefined {
  return ttsCache.get(messageId)
}
export function clearCachedTts(messageId: string) {
  ttsCache.delete(messageId)
}
export function isPlayingMessage(messageId: string): boolean {
  return currentMessageId === messageId
}
export async function playAudioBufferForMessage(messageId: string, buf: ArrayBuffer): Promise<void> {
  currentMessageId = messageId
  await playAudioBuffer(buf)
}
export async function playCachedTts(messageId: string): Promise<void> {
  const buf = ttsCache.get(messageId)
  if (!buf) return
  currentMessageId = messageId
  await playAudioBuffer(buf)
}

// --- Simple chime for wake word feedback ---
export async function playChime(options?: { frequency?: number; durationMs?: number; volume?: number; type?: OscillatorType }) {
  const ctx = getCtx()
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const freq = options?.frequency ?? 880
  const dur = (options?.durationMs ?? 160) / 1000
  const vol = options?.volume ?? 0.2
  const type = options?.type ?? 'sine'
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(vol, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.001), now + dur)
  osc.connect(gain)
  gain.connect(ctx.destination)
  return new Promise<void>(async (resolve) => {
    try { await ctx.resume() } catch {}
    osc.start(now)
    osc.stop(now + dur + 0.02)
    osc.onended = () => {
      try { osc.disconnect() } catch {}
      try { gain.disconnect() } catch {}
      resolve()
    }
  })
}

// Preset chimes built with WebAudio
export type ChimePreset = 'ding' | 'ding-dong' | 'soft-pop'
export async function playPresetChime(preset: ChimePreset, volume = 0.2) {
  const vol = Math.max(0, Math.min(1, volume))
  switch (preset) {
    case 'ding':
      return playChime({ frequency: 880, durationMs: 140, volume: vol, type: 'sine' })
    case 'ding-dong': {
      // Two quick tones
      await playChime({ frequency: 740, durationMs: 120, volume: vol, type: 'sine' })
      await new Promise(r => setTimeout(r, 60))
      return playChime({ frequency: 988, durationMs: 160, volume: vol, type: 'sine' })
    }
    case 'soft-pop':
      return playChime({ frequency: 520, durationMs: 90, volume: vol, type: 'triangle' })
  }
}

// Play an ArrayBuffer without interrupting existing audio
async function playArrayBufferLight(arrayBuffer: ArrayBuffer): Promise<void> {
  const ctx = getCtx()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
  const src = ctx.createBufferSource()
  src.buffer = audioBuffer
  src.connect(ctx.destination)
  await ctx.resume()
  return new Promise((resolve) => {
    src.onended = () => {
      try { src.disconnect() } catch {}
      resolve()
    }
    src.start(0)
  })
}

// Play a data URL (e.g., uploaded chime) without interrupting existing audio, with volume control
export async function playDataUrlWithVolume(dataUrl: string, volume = 0.2): Promise<void> {
  try {
    const ctx = getCtx()
    const res = await fetch(dataUrl)
    const buf = await res.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(buf.slice(0))
    const src = ctx.createBufferSource()
    const gain = ctx.createGain()
    src.buffer = audioBuffer
    gain.gain.value = Math.max(0, Math.min(1, volume))
    src.connect(gain)
    gain.connect(ctx.destination)
    await ctx.resume()
    await new Promise<void>((resolve) => {
      src.onended = () => {
        try { src.disconnect() } catch {}
        try { gain.disconnect() } catch {}
        resolve()
      }
      src.start(0)
    })
  } catch (e) {
    console.warn('Failed to play data URL with volume:', e)
  }
}
