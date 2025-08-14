import { useEffect, useRef, useState } from 'react'
import { AppError } from '../lib/api'

type Props = {
  onAudioReady: (blob: Blob) => void
  disabled?: boolean
}

export default function MicToggleButton({ onAudioReady, disabled }: Props) {
  const [isRecording, setIsRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const mediaRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => () => cleanup(), [])

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 48000 } })
      mediaRef.current = stream
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 })
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)

      const rec = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      rec.ondataavailable = (e) => e.data && chunks.push(e.data)
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        onAudioReady(blob)
      }
      recorderRef.current = rec

      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        setLevel(Math.min(100, Math.round(rms * 200)))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      rec.start()
      setIsRecording(true)
    } catch (e) {
      const err = new AppError('mic_denied', 'Microphone permission denied.', e)
      console.error(err)
      alert('Mic permission denied. Please allow access and try again.')
    }
  }

  function stop() {
    try { recorderRef.current?.stop() } catch {}
    cleanup()
    setIsRecording(false)
  }

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    mediaRef.current?.getTracks?.().forEach(t => t.stop())
    recorderRef.current = null
    mediaRef.current = null
  }

  return (
    <button
      type="button"
      aria-pressed={isRecording}
      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      disabled={disabled}
      onClick={() => isRecording ? stop() : start()}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !disabled) { e.preventDefault(); isRecording ? stop() : start() } }}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 border ${isRecording ? 'bg-red-600 text-white' : 'bg-white/70 dark:bg-slate-900/60'} relative`}
    >
      <span className="relative flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-300 animate-pulse' : 'bg-slate-400'}`} />
        {isRecording ? 'Stop' : 'Speak'}
      </span>
      <span aria-hidden className="ml-2 flex gap-0.5 items-end h-4">
        {new Array(6).fill(0).map((_, i) => (
          <span key={i} className="w-1 bg-green-500/70 rounded" style={{ height: `${Math.max(2, (level / 100) * (4 + i * 3))}px` }} />
        ))}
      </span>
    </button>
  )
}
