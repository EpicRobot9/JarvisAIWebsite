import React, { useEffect, useRef, useState } from "react"
import { EFFECTS, FXCtx } from "./effects"

function useMicAnalyser(enabled: boolean) {
  const analyserRef = useRef<AnalyserNode | null>(null)
  const freqDataRef = useRef<Uint8Array | null>(null)
  const volumeRef = useRef(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let ctx: AudioContext | null = null
    let src: MediaStreamAudioSourceNode | null = null
    let raf: number | undefined
    let stream: MediaStream | null = null

    async function start() {
      try {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.82
        analyserRef.current = analyser
        src.connect(analyser)
        freqDataRef.current = new Uint8Array(analyser.frequencyBinCount)
        const loop = () => {
          if (!analyserRef.current || !freqDataRef.current) return
          // Cast to any to handle TS lib variations between ArrayBuffer and ArrayBufferLike
          analyserRef.current.getByteFrequencyData(
            freqDataRef.current as any
          )
          let sum = 0
          for (let i = 0; i < freqDataRef.current.length; i++) {
            sum += freqDataRef.current[i] * freqDataRef.current[i]
          }
          const rms = Math.sqrt(sum / freqDataRef.current.length) / 128
          volumeRef.current = Math.min(1, rms * 1.25)
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        setReady(true)
      } catch {
        setReady(false)
      }
    }
    if (enabled) start()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      analyserRef.current?.disconnect()
      try { src?.disconnect() } catch {}
      try { stream?.getTracks().forEach(t => t.stop()) } catch {}
      freqDataRef.current = null
      analyserRef.current = null
      ctx?.close()
      setReady(false)
    }
  }, [enabled])

  return { analyserRef, freqDataRef, volumeRef, ready } as const
}

export default function AnimatedBackground({
  effect,
  micEnabled = false,
  className = "",
}: {
  effect: keyof typeof EFFECTS
  micEnabled?: boolean
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cleanupRef = useRef<null | (() => void)>(null)
  const { analyserRef, freqDataRef, volumeRef } = useMicAnalyser(micEnabled)

  const resize = () => {
    const c = canvasRef.current!
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const { clientWidth: w, clientHeight: h } = c
    if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) {
      c.width = Math.floor(w * dpr)
      c.height = Math.floor(h * dpr)
      c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  useEffect(() => {
    const onResize = () => resize()
    window.addEventListener("resize", onResize)
    resize()
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Expose mic volume globally so any effect using withLoop() can react via `beat`
  useEffect(() => {
    if (micEnabled && volumeRef) {
      ;(window as any).__jarvisVolRef = volumeRef
      return () => { try { delete (window as any).__jarvisVolRef } catch {} }
    } else {
      try { delete (window as any).__jarvisVolRef } catch {}
    }
  }, [micEnabled, volumeRef])

  useEffect(() => {
    if (!canvasRef.current) return
    cleanupRef.current?.()
    const start = EFFECTS[effect] ?? EFFECTS["Lotus Bloom"]
    const ctxObj: FXCtx = { analyser: analyserRef, freqData: freqDataRef, volumeRef }
    cleanupRef.current = start(canvasRef.current, ctxObj)
    return () => cleanupRef.current?.()
  }, [effect, analyserRef, freqDataRef, volumeRef])

  return (
    <canvas
      ref={canvasRef}
  className={`absolute inset-0 h-full w-full pointer-events-none [filter:contrast(115%)_saturate(125%)] ${className}`}
    />
  )
}
