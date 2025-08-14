import { useEffect, useRef, useState } from 'react'

export function useRecorder() {
  const mediaRef = useRef(null)
  const recorderRef = useRef(null)
  const [isRecording, setIsRecording] = useState(false)
  const [level, setLevel] = useState(0)

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
      mediaRef.current?.getTracks?.().forEach(t => t.stop())
    }
  }, [])

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRef.current = stream
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)

    const rec = new MediaRecorder(stream)
    const chunks = []
    rec.ondataavailable = e => chunks.push(e.data)
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' })
      if (onStopRef.current) onStopRef.current(blob)
    }
    recorderRef.current = rec

    let raf
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      setLevel(Math.min(100, Math.round(rms * 200)))
      raf = requestAnimationFrame(tick)
    }
    tick()

    rec.start()
    setIsRecording(true)
    stopLevelRef.current = () => cancelAnimationFrame(raf)
  }

  const onStopRef = useRef(null)
  const stopLevelRef = useRef(() => {})
  function stop(onStop) {
    onStopRef.current = onStop
    stopLevelRef.current()
    recorderRef.current?.stop()
    mediaRef.current?.getTracks?.().forEach(t => t.stop())
    setIsRecording(false)
  }

  return { isRecording, level, start, stop }
}
