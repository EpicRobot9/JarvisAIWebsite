import { motion, useAnimation, useMotionValue } from 'framer-motion'
import { useEffect, useRef } from 'react'

export type VisualizerMode = 'idle' | 'listening' | 'speaking'

/**
 * Circular visualizer reacting to provided level (0-1) and mode.
 * - Outer pulsing ring with glow
 * - Inner radial bars reacting to `level`
 */
export default function AudioVisualizer({ level = 0, mode = 'idle', onPointerPTT, hue = 195, altHue }: { level?: number; mode?: VisualizerMode; onPointerPTT?: (down: boolean)=>void; hue?: number; altHue?: number }) {
  const bars = new Array(36).fill(0)
  const controls = useAnimation()
  const glow = useMotionValue(0.4)

  useEffect(()=>{
    if (mode === 'idle') controls.start({ scale: 1, transition: { duration: 0.6 } })
    else if (mode === 'listening') controls.start({ scale: 1.04, transition: { duration: 0.2 } })
    else if (mode === 'speaking') controls.start({ scale: 1.02, transition: { duration: 0.2 } })
  }, [mode])

  useEffect(()=>{ glow.set(0.35 + Math.min(0.6, level * 0.8)) }, [level])

  return (
    <div className="relative grid place-items-center select-none">
      <motion.div
        className="relative rounded-full"
        animate={controls}
    style={{ boxShadow: `0 0 0 2px hsla(${hue},100%,70%,0.2), 0 0 80px hsla(${hue},100%,60%,${glow.get()})` }}
        onPointerDown={()=>onPointerPTT?.(true)}
        onPointerUp={()=>onPointerPTT?.(false)}
        onPointerLeave={()=>onPointerPTT?.(false)}
      >
    <div className="rounded-full" style={{ width: 260, height: 260, background: `radial-gradient(circle at 50% 50%, hsla(${hue},100%,70%,0.28), hsla(${altHue ?? hue},100%,55%,0.12) 40%, rgba(9,18,38,0.6))`, border: `1px solid hsla(${hue},100%,70%,0.25)`}}>
          <svg viewBox="0 0 100 100" width={260} height={260} className="block">
            {bars.map((_, i) => {
              const angle = (i / bars.length) * 2 * Math.PI
              const base = 36
              const amp = base + Math.sin(angle * 4 + level * 6) * (level * 20 + 2)
              const x = 50 + Math.cos(angle) * 28
              const y = 50 + Math.sin(angle) * 28
              const x2 = 50 + Math.cos(angle) * (28 + amp/12)
              const y2 = 50 + Math.sin(angle) * (28 + amp/12)
      return <line key={i} x1={x} y1={y} x2={x2} y2={y2} stroke={`hsla(${hue},100%,70%,0.9)`} strokeWidth={1.2} strokeLinecap="round" />
            })}
          </svg>
        </div>
      </motion.div>
      <div className="absolute -bottom-10 text-xs jarvis-subtle">Hold Space or press/hold the circle to speak…</div>
    </div>
  )
}
