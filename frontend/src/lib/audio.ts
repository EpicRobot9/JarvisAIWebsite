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
      try { onQueueIdle?.() } catch {}
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
export function isAudioActive(): boolean { return !!currentSource || !!currentMediaEl }

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 })
  return audioCtx
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
        try { onQueueIdle?.() } catch {}
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
      if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  currentMessageId = null
      if (!processingQueue && getPlaybackQueueLength() === 0) {
        try { onQueueIdle?.() } catch {}
      }
      resolve()
    })
    audio.addEventListener('error', () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null }
      reject(new Error('Audio playback error'))
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
