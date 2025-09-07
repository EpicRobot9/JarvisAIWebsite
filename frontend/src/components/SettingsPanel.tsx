import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

export default function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [openai, setOpenai] = useState(localStorage.getItem('user_openai_api_key') || '')
  const [el,   setEl]      = useState(localStorage.getItem('user_elevenlabs_api_key') || '')
  const [voice,setVoice]   = useState(localStorage.getItem('user_elevenlabs_voice_id') || '')
  const [name, setName]    = useState(localStorage.getItem('user_name') || '')
  const [twEnabled, setTwEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ux_typewriter_enabled') || 'false') } catch { return false }
  })
  const [twSpeed, setTwSpeed] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_typewriter_speed_cps') || '35')
    return Number.isFinite(v) ? v : 35
  })
  const [perfMode, setPerfMode] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ux_perf_mode') || 'false') } catch { return false }
  })
  // Chat animated background settings removed per request

  // Lock background scroll when modal is open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
  window.addEventListener('keydown', onKey)
  return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    }
  }, [open])

  function save() {
    // Persist or clear keys
    const oa = openai.trim()
    const ek = el.trim()
    const vi = voice.trim()
    const nm = name.trim()
    if (oa) localStorage.setItem('user_openai_api_key', oa)
    else localStorage.removeItem('user_openai_api_key')
    if (ek) localStorage.setItem('user_elevenlabs_api_key', ek)
    else localStorage.removeItem('user_elevenlabs_api_key')
    if (vi) localStorage.setItem('user_elevenlabs_voice_id', vi)
    else localStorage.removeItem('user_elevenlabs_voice_id')
    if (nm) localStorage.setItem('user_name', nm)
    else localStorage.removeItem('user_name')
    // Typewriter
    try {
      localStorage.setItem('ux_typewriter_enabled', JSON.stringify(!!twEnabled))
      localStorage.setItem('ux_typewriter_speed_cps', String(Math.max(5, Math.min(120, Number(twSpeed) || 35))))
    } catch {}
    // Performance
    try {
      localStorage.setItem('ux_perf_mode', JSON.stringify(!!perfMode))
  // Chat background controls have been removed; no longer persisting related keys
    } catch {}
    setOpen(false)
  }

  function useDefaults() {
    localStorage.removeItem('user_openai_api_key')
    localStorage.removeItem('user_elevenlabs_api_key')
    localStorage.removeItem('user_elevenlabs_voice_id')
    // Do not clear the user's name on "Use defaults" (only resets keys/voice)
    setOpenai('')
    setEl('')
    setVoice('')
  }

  return (
    <div className="inline-block">
      <button className="jarvis-btn" onClick={()=>setOpen(o=>!o)}>Settings</button>
      {createPortal((
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[9999]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/40" onClick={()=>setOpen(false)} />
              {/* Centered modal; clicking the surrounding frame closes */}
              <div
                className="absolute inset-0 flex items-center justify-center p-3 md:p-6"
                onMouseDown={(e)=>{ if (e.target === e.currentTarget) setOpen(false) }}
                role="dialog" aria-modal="true"
              >
                <motion.div
                  className="glass rounded-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4 shadow-xl"
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <div className="text-cyan-300 font-semibold mb-3">Settings</div>
            <div className="text-cyan-300 font-semibold mb-2">API Keys (optional)</div>
            <p className="text-xs jarvis-subtle mb-3">Use your own keys to override defaults. Remove them or click "Use defaults" to switch back to the portal's keys and voice.</p>

            <label className="text-xs">OpenAI API Key</label>
            <input className="jarvis-input mb-3" placeholder="sk-..." value={openai} onChange={e=>setOpenai(e.target.value)} />

            <label className="text-xs">ElevenLabs API Key</label>
            <input className="jarvis-input mb-3" placeholder="sk_..." value={el} onChange={e=>setEl(e.target.value)} />

            <label className="text-xs">ElevenLabs Voice ID (used only with your key)</label>
            <input className="jarvis-input mb-4" placeholder="e.g. 21m00Tcm4TlvDq8ikWAM" value={voice} onChange={e=>setVoice(e.target.value)} />

            <div className="text-cyan-300 font-semibold mb-2">Profile</div>
            <label className="text-xs">Your name (optional)</label>
            <input className="jarvis-input mb-4" placeholder="e.g. Tony" value={name} onChange={e=>setName(e.target.value)} />

            <div className="text-cyan-300 font-semibold mb-2">UI</div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm">Typewriter effect for assistant</label>
              <input type="checkbox" checked={twEnabled} onChange={e=>setTwEnabled(e.target.checked)} />
            </div>
            <label className="text-xs">Typing speed (chars/sec)</label>
            <input
              className="w-full mb-4"
              type="range"
              min={5}
              max={120}
              step={1}
              value={twSpeed}
              onChange={e=>setTwSpeed(Number(e.target.value))}
            />
            <div className="text-xs jarvis-subtle mb-4">Current: {Math.round(twSpeed)} cps</div>

            <div className="text-cyan-300 font-semibold mb-2">Performance</div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm">Performance mode (lighter visuals)</label>
              <input type="checkbox" checked={perfMode} onChange={e=>setPerfMode(e.target.checked)} />
            </div>
            {/* Chat animated background options removed */}

              <div className="flex gap-2 justify-end pt-2">
              <button className="px-3 py-1 border rounded border-cyan-200/20" onClick={useDefaults}>Use defaults</button>
              <button className="px-3 py-1 rounded jarvis-btn-primary" onClick={save}>Save</button>
            </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      ), document.body)}
    </div>
  )
}
