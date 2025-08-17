import React, { useEffect, useState } from "react"
import AnimatedBackground from "../components/AnimatedBackground"
import { EFFECTS } from "../components/effects"
import { storage } from "../lib/storage"

export default function CallScreen({ userId }: { userId?: string }) {
  const uid = (userId || (typeof window !== 'undefined' && (window as any).__jarvis_user_id) || 'anon') as string
  const [effect, setEffect] = useState<keyof typeof EFFECTS>((): keyof typeof EFFECTS => {
    const v = storage.get(`jarvis_fx_effect:${uid}`, 'Lotus Bloom')
    return (Object.keys(EFFECTS) as Array<keyof typeof EFFECTS>).includes(v) ? (v as keyof typeof EFFECTS) : 'Lotus Bloom'
  })
  const [mic, setMic] = useState<boolean>(() => storage.get(`jarvis_fx_mic:${uid}`, false))

  // Persist on change
  useEffect(() => { storage.set(`jarvis_fx_effect:${uid}`, effect) }, [effect, uid])
  useEffect(() => { storage.set(`jarvis_fx_mic:${uid}`, mic) }, [mic, uid])
  useEffect(() => {
    const v = storage.get(`jarvis_fx_effect:${uid}`, effect)
    if ((Object.keys(EFFECTS) as Array<keyof typeof EFFECTS>).includes(v)) setEffect(v as keyof typeof EFFECTS)
    const m = storage.get(`jarvis_fx_mic:${uid}`, mic)
    setMic(!!m)
  }, [uid])

  return (
    <div className="relative h-[80vh] w-full overflow-hidden rounded-3xl bg-slate-950 text-slate-100">
      <AnimatedBackground effect={effect} micEnabled={mic} />
      {/* Foreground controls */}
      <div className="absolute left-4 top-4 z-30 flex items-center gap-2 rounded-2xl bg-slate-900/70 p-2 ring-1 ring-white/10 backdrop-blur">
        <label className="sr-only" htmlFor="fx">Effect</label>
        <select
          id="fx"
          value={effect}
          onChange={(e) => setEffect(e.target.value as keyof typeof EFFECTS)}
          className="rounded-xl bg-slate-800/80 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-white/10"
        >
          {Object.keys(EFFECTS).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button
          onClick={() => setMic((m) => !m)}
          className={`rounded-xl px-3 py-2 text-sm font-semibold ring-1 ${
            mic
              ? "bg-emerald-600/80 ring-emerald-200/30"
              : "bg-slate-800/80 ring-white/10"
          } text-white`}
          aria-pressed={mic}
          aria-label={mic ? "Disable microphone" : "Enable microphone"}
        >
          {mic ? "Mic On" : "Enable Mic"}
        </button>
      </div>

      {/* Your call orb / buttons here */}
      <div className="absolute inset-0 grid place-items-center">
        <div className="h-44 w-44 rounded-full bg-slate-900/40 ring-1 ring-white/10 backdrop-blur grid place-items-center">
          <div
            className="h-24 w-24 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 45%, rgba(165,243,252,.9), rgba(56,189,248,.55) 40%, rgba(15,23,42,0) 60%)",
            }}
          />
        </div>
      </div>
    </div>
  )
}
