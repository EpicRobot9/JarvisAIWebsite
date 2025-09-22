import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { getWebSpeechVoices, playChime, primeAudio, playPresetChime, speakWithWebSpeech } from '../lib/audio'

// Voice presets for ElevenLabs
const VOICE_PRESETS = [
  { id: '', name: 'Default (Project Voice)', description: 'Use the system default voice' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Female)', description: 'Young, pleasant female voice' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (Female)', description: 'Energetic, friendly female voice' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Female)', description: 'Sweet, soft-spoken female voice' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Male)', description: 'Well-rounded, versatile male voice' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (Male)', description: 'Crisp, confident male voice' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Male)', description: 'Deep, authoritative male voice' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam (Male)', description: 'Raspy, casual male voice' },
  { id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave (Male)', description: 'British, professional male voice' },
  { id: '29vD33N1CtxCmqQRPOHJ', name: 'Drew (Male)', description: 'Calm, soothing male voice' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (Male)', description: 'Warm, articulate British male voice' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum (Male)', description: 'Intense, dramatic male voice' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie (Male)', description: 'Casual, laid-back male voice' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (Male)', description: 'British, authoritative male voice' },
  { id: 'custom', name: 'Custom Voice ID', description: 'Enter your own ElevenLabs voice ID' }
]

export default function SettingsPanel() {
  function Section({ id, title, defaultOpen = true, children }: { id: string; title: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState<boolean>(() => {
      try {
        const v = localStorage.getItem(`settings_section_open:${id}`)
        if (v === 'true') return true
        if (v === 'false') return false
      } catch {}
      return defaultOpen
    })
    useEffect(() => { try { localStorage.setItem(`settings_section_open:${id}`, open ? 'true' : 'false') } catch {} }, [id, open])
    return (
      <div className="mb-3 rounded-lg overflow-hidden ring-1 ring-white/10">
        <button
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/70 text-cyan-300 font-semibold"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          <span>{title}</span>
          <span className="text-slate-400 text-xs">{open ? '−' : '+'}</span>
        </button>
        {open && (
          <div className="p-3 bg-slate-950/40">
            {children}
          </div>
        )}
      </div>
    )
  }
  const [open, setOpen] = useState(false)
  const [openai, setOpenai] = useState(localStorage.getItem('user_openai_api_key') || '')
  const [el,   setEl]      = useState(localStorage.getItem('user_elevenlabs_api_key') || '')
  const [voice,setVoice]   = useState(localStorage.getItem('user_elevenlabs_voice_id') || '')
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const savedVoice = localStorage.getItem('user_elevenlabs_voice_id') || ''
    const preset = VOICE_PRESETS.find(p => p.id === savedVoice)
    return preset ? savedVoice : (savedVoice ? 'custom' : '')
  })
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
  // VAD debug toggle
  const [vadDebug, setVadDebug] = useState<boolean>(() => {
    try { return localStorage.getItem('jarvis_debug_vad') === 'true' } catch { return false }
  })
  // Wake Word Debug panel visibility (UI overlay)
  const [showWakeDebug, setShowWakeDebug] = useState<boolean>(() => {
    try { return localStorage.getItem('ux_show_wake_debug') === 'true' } catch { return false }
  })
  const [webSpeechVoice, setWebSpeechVoice] = useState(() => {
    return localStorage.getItem('user_web_speech_voice') || 'auto'
  })
  const [webSpeechRate, setWebSpeechRate] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_web_speech_rate') || '0.85')
    return Number.isFinite(v) ? Math.max(0.5, Math.min(1.5, v)) : 0.85
  })
  const [webSpeechVoices, setWebSpeechVoices] = useState<SpeechSynthesisVoice[]>([])
  // Fallback engine selection: 'webspeech' | 'oss' | 'auto'
  const [fallbackEngine, setFallbackEngine] = useState<string>(() => {
    const v = (localStorage.getItem('ux_fallback_engine') || 'webspeech').trim()
    return v === 'oss' || v === 'auto' ? v : 'webspeech'
  })
  // OSS TTS (server-side pico2wave) settings
  const [ossVoice, setOssVoice] = useState<string>(() => localStorage.getItem('ux_oss_tts_voice') || 'en-US')
  const [ossRate, setOssRate] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_oss_tts_rate') || '0.85')
    return Number.isFinite(v) ? Math.max(0.5, Math.min(1.5, v)) : 0.85
  })
  // Wake word and chime settings
  const [wakeWord, setWakeWord] = useState<string>(() => localStorage.getItem('ux_wake_word') || '')
  const [wakeWords, setWakeWords] = useState<string[]>(() => {
    try {
      const arr = JSON.parse(localStorage.getItem('ux_wake_words') || '[]')
      if (Array.isArray(arr) && arr.every(x => typeof x === 'string')) return arr
    } catch {}
    const legacy = (localStorage.getItem('ux_wake_word') || 'jarvis').trim().toLowerCase()
    return legacy ? [legacy] : ['jarvis']
  })
  const [chimeEnabled, setChimeEnabled] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('ux_wake_chime_enabled') || 'true') } catch { return true }
  })
  const [chimeVolume, setChimeVolume] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_wake_chime_volume') || '0.2')
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.2
  })
  const [customChimeDataUrl, setCustomChimeDataUrl] = useState<string | null>(() => localStorage.getItem('ux_wake_chime_data_url'))
  const [chimePreset, setChimePreset] = useState<string>(() => localStorage.getItem('ux_wake_chime_preset') || 'ding')
  // Conversation settings
  const [continuousConversation, setContinuousConversation] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('ux_continuous_conversation') || 'false') } catch { return false }
  })
  const [followupChimeEnabled, setFollowupChimeEnabled] = useState<boolean>(() => {
    // Default true so users get audible prompt after reply unless disabled
    try { return JSON.parse(localStorage.getItem('ux_followup_chime_enabled') || 'true') } catch { return true }
  })
  const [followupNoSpeechSec, setFollowupNoSpeechSec] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_followup_no_speech_sec') || '7')
    return Number.isFinite(v) ? Math.max(1, Math.min(15, Math.round(v))) : 7
  })
  const [initialNoSpeechSec, setInitialNoSpeechSec] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_initial_no_speech_sec') || '8')
    return Number.isFinite(v) ? Math.max(1, Math.min(15, Math.round(v))) : 8
  })
  const [nudgeDurationMs, setNudgeDurationMs] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_followup_nudge_duration_ms') || '1500')
    return Number.isFinite(v) ? Math.max(300, Math.min(5000, Math.round(v))) : 1500
  })
  // VAD basic tuning
  const [vadEngine, setVadEngine] = useState<'js' | 'wasm'>(() => {
    const v = (localStorage.getItem('vad_engine') || 'js').toLowerCase()
    return (v === 'wasm' ? 'wasm' : 'js')
  })
  const [vadGuardMs, setVadGuardMs] = useState<number>(() => {
    const v = Number(localStorage.getItem('ux_vad_endpoint_guard_ms') || localStorage.getItem('ux_endpoint_guard_ms') || '1800')
    return Number.isFinite(v) ? Math.max(300, Math.min(5000, Math.round(v))) : 1800
  })
  const [vadSilenceHangMs, setVadSilenceHangMs] = useState<number>(() => {
    const v = Number(localStorage.getItem('vad_silence_hangover_ms') || '1500')
    return Number.isFinite(v) ? Math.max(300, Math.min(5000, Math.round(v))) : 1500
  })
  const [vadEnterSnrDb, setVadEnterSnrDb] = useState<number>(() => {
    const v = Number(localStorage.getItem('vad_enter_snr_db') || '4.5')
    return Number.isFinite(v) ? Math.max(0, Math.min(20, v)) : 4.5
  })
  const [vadExitSnrDb, setVadExitSnrDb] = useState<number>(() => {
    const v = Number(localStorage.getItem('vad_exit_snr_db') || '2.5')
    return Number.isFinite(v) ? Math.max(0, Math.min(20, v)) : 2.5
  })
  const [vadRelDropDb, setVadRelDropDb] = useState<number>(() => {
    const v = Number(localStorage.getItem('vad_relative_drop_db') || '10')
    return Number.isFinite(v) ? Math.max(4, Math.min(30, Math.round(v))) : 10
  })
  // Show a banner after importing settings until user saves
  const [importPending, setImportPending] = useState(false)
  const fileInputRef = (typeof window !== 'undefined') ? (window as any).__jarvis_import_ref || ((window as any).__jarvis_import_ref = { current: null }) : { current: null }
  
  // Load Web Speech voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = getWebSpeechVoices()
      setWebSpeechVoices(voices)
    }
    
    loadVoices()
    
    // Voices might not be immediately available
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices
    }
  }, [])
  // Chat animated background settings removed per request

  // Handle voice preset selection
  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId)
    if (presetId === 'custom') {
      // Keep current custom voice ID when switching to custom
      return
    }
    setVoice(presetId)
  }

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
    // Web Speech voice preference
    if (webSpeechVoice !== 'auto') localStorage.setItem('user_web_speech_voice', webSpeechVoice)
    else localStorage.removeItem('user_web_speech_voice')
  // Web Speech speed
  try { localStorage.setItem('ux_web_speech_rate', String(Math.max(0.5, Math.min(1.5, Number(webSpeechRate) || 0.85)))) } catch {}
    // Fallback engine
    try { localStorage.setItem('ux_fallback_engine', fallbackEngine) } catch {}
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
    // VAD debug
    try {
      if (vadDebug) localStorage.setItem('jarvis_debug_vad', 'true')
      else localStorage.removeItem('jarvis_debug_vad')
    } catch {}
    // Wake Word Debug panel visibility
    try {
      if (showWakeDebug) localStorage.setItem('ux_show_wake_debug', 'true')
      else localStorage.removeItem('ux_show_wake_debug')
    } catch {}
    // Conversation settings
    try {
      localStorage.setItem('ux_continuous_conversation', JSON.stringify(!!continuousConversation))
      localStorage.setItem('ux_followup_chime_enabled', JSON.stringify(!!followupChimeEnabled))
      localStorage.setItem('ux_followup_no_speech_sec', String(Math.max(1, Math.min(15, Number(followupNoSpeechSec) || 7))))
      localStorage.setItem('ux_initial_no_speech_sec', String(Math.max(1, Math.min(15, Number(initialNoSpeechSec) || 8))))
      localStorage.setItem('ux_followup_nudge_duration_ms', String(Math.max(300, Math.min(5000, Number(nudgeDurationMs) || 1500))))
    } catch {}
    // VAD tuning
    try {
      localStorage.setItem('vad_engine', vadEngine)
      localStorage.setItem('ux_vad_endpoint_guard_ms', String(Math.max(300, Math.min(5000, Number(vadGuardMs) || 1800))))
      localStorage.setItem('vad_silence_hangover_ms', String(Math.max(300, Math.min(5000, Number(vadSilenceHangMs) || 1500))))
      localStorage.setItem('vad_enter_snr_db', String(Math.max(0, Math.min(20, Number(vadEnterSnrDb) || 4.5))))
      localStorage.setItem('vad_exit_snr_db', String(Math.max(0, Math.min(20, Number(vadExitSnrDb) || 2.5))))
      localStorage.setItem('vad_relative_drop_db', String(Math.max(4, Math.min(30, Number(vadRelDropDb) || 10))))
    } catch {}
    // Wake word + chime
    try {
      // Persist multi wake words
      const cleaned = Array.from(new Set(wakeWords.map(w => w.trim().toLowerCase()).filter(Boolean)))
      localStorage.setItem('ux_wake_words', JSON.stringify(cleaned))
      // Maintain legacy single value for compatibility
      const ww = (cleaned[0] || '').trim().toLowerCase()
      if (ww) localStorage.setItem('ux_wake_word', ww); else localStorage.removeItem('ux_wake_word')
      localStorage.setItem('ux_wake_chime_enabled', JSON.stringify(!!chimeEnabled))
      localStorage.setItem('ux_wake_chime_volume', String(Math.max(0, Math.min(1, Number(chimeVolume) || 0.2))))
      if (customChimeDataUrl) localStorage.setItem('ux_wake_chime_data_url', customChimeDataUrl)
      else localStorage.removeItem('ux_wake_chime_data_url')
      // Preset
      localStorage.setItem('ux_wake_chime_preset', chimePreset)
    } catch {}
    // Clear import banner after persisting
    setImportPending(false)
    setOpen(false)
  }

  function exportWakeSettings() {
    const data = {
      version: 1,
      wakeWords,
      chime: {
        enabled: chimeEnabled,
        volume: chimeVolume,
        preset: chimePreset,
        hasCustom: !!customChimeDataUrl
      },
      // Caution: including dataURL can create a large file; include if small enough
      customDataUrl: customChimeDataUrl && customChimeDataUrl.length < 2_000_000 ? customChimeDataUrl : null
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'jarvis-wake-settings.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function importWakeSettings(file: File) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data || typeof data !== 'object') throw new Error('Invalid file')
      // Minimal validation
      const ww = Array.isArray(data.wakeWords) ? data.wakeWords.filter((x: any) => typeof x === 'string').map((x: string) => x.trim().toLowerCase()).slice(0, 16) : []
      const ch = data.chime || {}
      const enabled = !!ch.enabled
      const volume = Number.isFinite(Number(ch.volume)) ? Math.max(0, Math.min(1, Number(ch.volume))) : 0.2
      const preset = typeof ch.preset === 'string' ? ch.preset : 'ding'
      const dataUrl = typeof data.customDataUrl === 'string' && data.customDataUrl.startsWith('data:audio/') ? data.customDataUrl : null

      // Apply to state
      setWakeWords(ww.length ? ww : ['jarvis'])
      setChimeEnabled(enabled)
      setChimeVolume(volume)
      setChimePreset(preset)
      setCustomChimeDataUrl(dataUrl)
      // Prompt user to save to persist imported settings
      setImportPending(true)
    } catch (e) {
      alert('Failed to import settings: ' + (e as Error).message)
    }
  }

  function useDefaults() {
    localStorage.removeItem('user_openai_api_key')
    localStorage.removeItem('user_elevenlabs_api_key')
    localStorage.removeItem('user_elevenlabs_voice_id')
    localStorage.removeItem('user_web_speech_voice')
  localStorage.removeItem('ux_wake_word')
  localStorage.removeItem('ux_wake_words')
  localStorage.removeItem('ux_wake_chime_enabled')
  localStorage.removeItem('ux_wake_chime_volume')
  localStorage.removeItem('ux_wake_chime_data_url')
    // Do not clear the user's name on "Use defaults" (only resets keys/voice)
    setOpenai('')
    setEl('')
    setVoice('')
    setSelectedPreset('')
    setWebSpeechVoice('auto')
  setFallbackEngine('webspeech')
    setWakeWord('')
    setWakeWords(['jarvis'])
    setChimeEnabled(true)
    setChimeVolume(0.2)
    setCustomChimeDataUrl(null)
    setChimePreset('ding')
    // Using defaults means nothing pending
    setImportPending(false)
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
            <Section id="always-vad" title="Always‑Listening / VAD" defaultOpen={false}>
              <div className="mb-3">
                <label className="text-xs">Verbose VAD logs</label>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={vadDebug} onChange={e=>setVadDebug(e.target.checked)} />
                  <span className="text-xs jarvis-subtle">Console + overlay (toggle takes effect immediately)</span>
                </div>
              </div>
              <div className="mb-2">
                <label className="text-xs">VAD Engine</label>
                <select className="jarvis-input" value={vadEngine} onChange={e=>setVadEngine((e.target.value as 'js'|'wasm'))}>
                  <option value="js">JS (RMS + noise floor)</option>
                  <option value="wasm">WASM (MicVAD)</option>
                </select>
              </div>
              <div className="mb-2">
                <label className="text-xs">Endpoint guard (ms)</label>
                <input className="jarvis-input" type="number" min={300} max={5000} step={50} value={vadGuardMs} onChange={e=>setVadGuardMs(Number(e.target.value))} />
              </div>
              <div className="mb-2">
                <label className="text-xs">Silence hangover (ms)</label>
                <input className="jarvis-input" type="number" min={300} max={5000} step={50} value={vadSilenceHangMs} onChange={e=>setVadSilenceHangMs(Number(e.target.value))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs">Enter SNR (dB)</label>
                  <input className="jarvis-input" type="number" min={0} max={20} step={0.5} value={vadEnterSnrDb} onChange={e=>setVadEnterSnrDb(Number(e.target.value))} />
                </div>
                <div>
                  <label className="text-xs">Exit SNR (dB)</label>
                  <input className="jarvis-input" type="number" min={0} max={20} step={0.5} value={vadExitSnrDb} onChange={e=>setVadExitSnrDb(Number(e.target.value))} />
                </div>
              </div>
              <div className="mb-1">
                <label className="text-xs">Relative drop (dB)</label>
                <input className="jarvis-input" type="number" min={4} max={30} step={1} value={vadRelDropDb} onChange={e=>setVadRelDropDb(Number(e.target.value))} />
              </div>
            </Section>
            <Section id="api" title="API Keys (optional)" defaultOpen={false}>
              <p className="text-xs jarvis-subtle mb-3">Use your own keys to override defaults. Remove them or click "Use defaults" to switch back to the portal's keys and voice.</p>
              <label className="text-xs">OpenAI API Key</label>
              <input className="jarvis-input mb-3" placeholder="sk-..." value={openai} onChange={e=>setOpenai(e.target.value)} />
              <label className="text-xs">ElevenLabs API Key</label>
              <input className="jarvis-input mb-3" placeholder="sk_..." value={el} onChange={e=>setEl(e.target.value)} />
              <label className="text-xs">Voice Preset (used only with your key)</label>
              <select className="jarvis-input mb-2" value={selectedPreset} onChange={e => handlePresetChange(e.target.value)}>
                {VOICE_PRESETS.map(preset => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
              {selectedPreset === 'custom' && (
                <>
                  <label className="text-xs">Custom Voice ID</label>
                  <input className="jarvis-input mb-2" placeholder="e.g. 21m00Tcm4TlvDq8ikWAM" value={voice} onChange={e => setVoice(e.target.value)} />
                </>
              )}
              {selectedPreset && selectedPreset !== 'custom' && (
                <div className="text-xs text-slate-400 mb-3">{VOICE_PRESETS.find(p => p.id === selectedPreset)?.description}</div>
              )}
              {selectedPreset === 'custom' && (
                <div className="text-xs text-slate-400 mb-3">Enter your own ElevenLabs voice ID. You can find voice IDs in your ElevenLabs dashboard.</div>
              )}
              {!el && (
                <div className="text-xs text-amber-400">⚠️ Voice presets require your ElevenLabs API key. Without it, the system will use the default project voice and TTS fallback system.</div>
              )}
            </Section>

            <Section id="tts-fallback" title="TTS Fallback Voice" defaultOpen={false}>
              <p className="text-xs jarvis-subtle mb-2">Voice used when ElevenLabs TTS fails and Web Speech API is used as fallback</p>
              <label className="text-xs">Web Speech Voice</label>
              <select className="jarvis-input mb-3" value={webSpeechVoice} onChange={e => {
                const v = e.target.value
                setWebSpeechVoice(v)
                try {
                  if (v === 'auto') localStorage.removeItem('user_web_speech_voice')
                  else localStorage.setItem('user_web_speech_voice', v)
                } catch {}
              }}>
                <option value="auto">Auto-select (prefer English)</option>
                {webSpeechVoices.map(voice => (<option key={voice.name} value={voice.name}>{voice.name} ({voice.lang}) {voice.default ? '(default)' : ''}</option>))}
              </select>
              <label className="text-xs">Web Speech Speed</label>
              <input className="w-full mb-1" type="range" min={0.5} max={1.5} step={0.05} value={webSpeechRate} onChange={e=>{
                const v = Number(e.target.value)
                setWebSpeechRate(v)
                try { localStorage.setItem('ux_web_speech_rate', String(Math.max(0.5, Math.min(1.5, Number(v) || 0.85)))) } catch {}
              }} />
              <div className="text-xs jarvis-subtle">Current: {webSpeechRate.toFixed(2)}× (1.00 is normal)</div>
              <div className="flex gap-2 justify-end mt-2">
                <button
                  className="px-3 py-1 rounded border border-cyan-200/20"
                  onClick={async () => {
                    try {
                      // Stop any current speech first to avoid overlap
                      try { window.speechSynthesis?.cancel() } catch {}
                      await speakWithWebSpeech("This is a test of the fallback Web Speech voice.")
                    } catch (err) {
                      alert('Web Speech test failed: ' + ((err as any)?.message || 'Unknown error'))
                    }
                  }}
                >Test Web Speech</button>
              </div>
            </Section>

            <Section id="fallback-engine" title="Fallback voice engine" defaultOpen={false}>
              <p className="text-xs jarvis-subtle mb-2">Select which engine to use when ElevenLabs TTS isn’t available.</p>
              <label className="text-xs">Engine</label>
              <select className="jarvis-input mb-2" value={fallbackEngine} onChange={e=>{
                const v = (e.target.value || '').trim()
                setFallbackEngine(v === 'oss' || v === 'auto' ? v : 'webspeech')
                try { localStorage.setItem('ux_fallback_engine', v) } catch {}
              }}>
                <option value="webspeech">Web Speech (browser) — default</option>
                <option value="oss">Open‑source TTS (server)</option>
                <option value="auto">Auto: try server, then Web Speech</option>
              </select>
              <div className="text-xs jarvis-subtle">Tip: Web Speech runs locally in your browser; Open‑source TTS is generated on the server.</div>
            </Section>

            <Section id="oss-tts" title="Open‑source TTS (fallback)" defaultOpen={false}>
              <p className="text-xs jarvis-subtle mb-2">Server-side fallback voice using pico2wave (supports multiple languages) with speed control.</p>
              <label className="text-xs">Voice / Language</label>
              <select className="jarvis-input mb-2" value={ossVoice} onChange={e=>{
                const v = e.target.value
                setOssVoice(v)
                try { localStorage.setItem('ux_oss_tts_voice', v) } catch {}
              }}>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="de-DE">German</option>
                <option value="es-ES">Spanish</option>
                <option value="fr-FR">French</option>
                <option value="it-IT">Italian</option>
              </select>
              <label className="text-xs">Speed</label>
              <input className="w-full mb-1" type="range" min={0.5} max={1.5} step={0.05} value={ossRate} onChange={e=>{
                const v = Number(e.target.value)
                setOssRate(v)
                try { localStorage.setItem('ux_oss_tts_rate', String(Math.max(0.5, Math.min(1.5, Number(v) || 0.85)))) } catch {}
              }} />
              <div className="text-xs jarvis-subtle">Current: {ossRate.toFixed(2)}×</div>
              <div className="flex gap-2 justify-end mt-2">
                <button className="px-3 py-1 rounded border border-cyan-200/20" onClick={async ()=>{
                  try {
                    await primeAudio()
                    const text = 'This is a server fallback TTS test.'
                    const r = await fetch('/api/tts/fallback', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text, voice: localStorage.getItem('ux_oss_tts_voice') || 'en-US', rate: Number(localStorage.getItem('ux_oss_tts_rate') || '0.85') }) })
                    if (!r.ok) throw new Error('Server TTS error')
                    const buf = await r.arrayBuffer()
                    const { playAudioBuffer } = await import('../lib/audio')
                    await playAudioBuffer(buf)
                  } catch (e) {
                    alert('OSS TTS test failed: ' + ((e as any)?.message || 'Unknown error'))
                  }
                }}>Test OSS TTS</button>
              </div>
            </Section>

            <Section id="profile" title="Profile" defaultOpen={false}>
              <label className="text-xs">Your name (optional)</label>
              <input className="jarvis-input" placeholder="e.g. Tony" value={name} onChange={e=>setName(e.target.value)} />
            </Section>

            <Section id="ui" title="UI" defaultOpen={false}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm">Typewriter effect for assistant</label>
                <input type="checkbox" checked={twEnabled} onChange={e=>setTwEnabled(e.target.checked)} />
              </div>
              <label className="text-xs">Typing speed (chars/sec)</label>
              <input className="w-full mb-1" type="range" min={5} max={120} step={1} value={twSpeed} onChange={e=>setTwSpeed(Number(e.target.value))} />
              <div className="text-xs jarvis-subtle">Current: {Math.round(twSpeed)} cps</div>
            </Section>

            <Section id="perf" title="Performance" defaultOpen={false}>
              <div className="flex items-center justify-between">
                <label className="text-sm">Performance mode (lighter visuals)</label>
                <input type="checkbox" checked={perfMode} onChange={e=>setPerfMode(e.target.checked)} />
              </div>
            </Section>

            <Section id="vad" title="Always-Listening / VAD" defaultOpen={false}>
              <div className="flex items-center justify-between">
                <label className="text-sm">Verbose VAD logs (console)</label>
                <input type="checkbox" checked={vadDebug} onChange={e=>setVadDebug(e.target.checked)} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <label className="text-sm">Show Wake Word Debug panel</label>
                <input type="checkbox" checked={showWakeDebug} onChange={e=>setShowWakeDebug(e.target.checked)} />
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Debug panel shows live wake state, VAD metrics, and logs. Hidden by default.</div>
            </Section>

            <Section id="wake" title="Wake Word & Chime" defaultOpen={false}>
              <label className="text-xs">Add wake word/phrase</label>
              <div className="flex gap-2 mb-2">
                <input className="jarvis-input flex-1" placeholder="e.g. jarvis or hey jarvis" value={wakeWord} onChange={e=>setWakeWord(e.target.value)} />
                <button className="px-3 py-1 rounded border border-cyan-200/20" onClick={() => {
                  const v = wakeWord.trim().toLowerCase(); if (!v) return; setWakeWords(prev => Array.from(new Set([...prev, v])).slice(0, 8)); setWakeWord('')
                }}>Add</button>
              </div>
              {wakeWords.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {wakeWords.map((w, i) => (
                    <span key={i} className="px-2 py-1 text-xs rounded-full bg-slate-800/70 ring-1 ring-white/10">
                      {w}
                      <button className="ml-2 text-slate-400 hover:text-red-300" onClick={() => setWakeWords(prev => prev.filter(x => x !== w))}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm">Play chime on wake</label>
                <input type="checkbox" checked={chimeEnabled} onChange={e=>setChimeEnabled(e.target.checked)} />
              </div>
              <label className="text-xs">Chime volume</label>
              <input className="w-full mb-1" type="range" min={0} max={1} step={0.01} value={chimeVolume} onChange={e=>setChimeVolume(Number(e.target.value))} />
              <div className="text-xs jarvis-subtle mb-2">Current: {Math.round(chimeVolume * 100)}%</div>
              <label className="text-xs">Custom chime (optional)</label>
              <input className="jarvis-input mb-2" type="file" accept="audio/*" onChange={async (e) => {
                const file = e.target.files?.[0]; if (!file) return; if (!file.type.startsWith('audio/')) { alert('Please select a valid audio file'); return }
                const reader = new FileReader(); reader.onload = () => { const result = reader.result as string; if (result.length > 2_000_000) { alert('File is too large. Please choose a smaller sound (under ~1MB).'); return } setCustomChimeDataUrl(result) }; reader.readAsDataURL(file)
              }} />
              {customChimeDataUrl && (
                <div className="flex items-center justify-between mb-2 text-xs">
                  <span className="text-slate-400">Custom sound selected</span>
                  <button className="px-2 py-0.5 rounded border border-cyan-200/20" onClick={() => setCustomChimeDataUrl(null)}>Remove</button>
                </div>
              )}
              <label className="text-xs">Preset chime</label>
              <select className="jarvis-input mb-2" value={chimePreset} onChange={e=>setChimePreset(e.target.value)}>
                <option value="ding">Ding</option>
                <option value="ding-dong">Ding-dong</option>
                <option value="soft-pop">Soft pop</option>
              </select>
              <div className="flex gap-2 justify-end mb-2">
                <button className="px-3 py-1 rounded border border-cyan-200/20" onClick={async () => {
                  try { await primeAudio() } catch {}
                  const vol = Math.max(0, Math.min(1, Number(chimeVolume) || 0.2))
                  const dataUrl = customChimeDataUrl || localStorage.getItem('ux_wake_chime_data_url')
                  if (dataUrl) { const { playDataUrlWithVolume } = await import('../lib/audio'); await playDataUrlWithVolume(dataUrl, vol) }
                  else if (chimePreset) { await playPresetChime(chimePreset as any, vol) }
                  else { await playChime({ volume: vol }) }
                }}>Test chime</button>
              </div>
              <div className="flex gap-2 justify-between">
                <button className="px-3 py-1 rounded border border-cyan-200/20" onClick={exportWakeSettings}>Export wake/chime</button>
                <div>
                  <input ref={(el) => (fileInputRef.current = el)} type="file" accept="application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importWakeSettings(f); if (fileInputRef.current) fileInputRef.current.value = '' }} />
                  <button className="px-3 py-1 rounded border border-cyan-200/20" onClick={() => fileInputRef.current?.click()}>Import wake/chime</button>
                </div>
              </div>
            </Section>

            <Section id="conversation" title="Conversation" defaultOpen={false}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm">Continuous conversation</label>
                <input type="checkbox" checked={continuousConversation} onChange={e=>setContinuousConversation(e.target.checked)} />
              </div>
              <p className="text-xs jarvis-subtle mb-2">When enabled, after Jarvis finishes speaking it plays the chime and immediately starts recording for your reply. If you don’t speak for a moment, it falls back to wake word listening.</p>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm">Play chime before follow‑up</label>
                <input type="checkbox" checked={followupChimeEnabled} onChange={e=>setFollowupChimeEnabled(e.target.checked)} />
              </div>
              <label className="text-xs">No‑speech timeout after follow‑up starts (seconds)</label>
              <input className="w-full mb-1" type="range" min={1} max={15} step={1} value={followupNoSpeechSec} onChange={e=>setFollowupNoSpeechSec(Number(e.target.value))} />
              <div className="text-xs jarvis-subtle mb-2">Current: {followupNoSpeechSec}s</div>
              <label className="text-xs">No‑speech timeout after wake (seconds)</label>
              <input className="w-full mb-1" type="range" min={1} max={15} step={1} value={initialNoSpeechSec} onChange={e=>setInitialNoSpeechSec(Number(e.target.value))} />
              <div className="text-xs jarvis-subtle mb-2">Current: {initialNoSpeechSec}s</div>
              <label className="text-xs">Follow‑up “Speak now” nudge duration</label>
              <input className="w-full mb-1" type="range" min={300} max={5000} step={100} value={nudgeDurationMs} onChange={e=>setNudgeDurationMs(Number(e.target.value))} />
              <div className="text-xs jarvis-subtle">Current: {(nudgeDurationMs/1000).toFixed(1)}s</div>

              <div className="mt-3 p-2 rounded-md border border-red-500/30 bg-red-500/5">
                <div className="text-sm text-red-300 font-semibold mb-1">Chat history</div>
                <p className="text-xs jarvis-subtle mb-2">Chats are no longer auto‑deleted. You can clear all locally saved chat history at any time.</p>
                <button
                  className="px-3 py-1 rounded border border-red-400/40 text-red-200 hover:bg-red-400/10"
                  onClick={()=>{
                    if (!confirm('Delete all saved chat history on this device? This cannot be undone.')) return
                    try {
                      localStorage.removeItem('jarvis_chat_v1') // legacy
                      localStorage.removeItem('jarvis_chat_lastActive_v1') // legacy activity
                      localStorage.removeItem('jarvis_ui_messages_v1') // new UI
                      localStorage.removeItem('jarvis_ui_lastUserSent_v1')
                      localStorage.removeItem('jarvis_ui_lastActivity_v1')
                      // Start a fresh conversation id if present
                      const newConv = crypto.randomUUID()
                      localStorage.setItem('jarvis_conversation_id', newConv)
                    } catch {}
                    alert('Chat history cleared.')
                  }}
                >Clear chat history</button>
              </div>
            </Section>

            {importPending && (
              <div className="mb-3 flex items-center justify-between rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-amber-200">
                <span className="text-xs">Imported settings applied. Click Save to make them permanent.</span>
                <div className="flex items-center gap-2">
                  <button className="px-2 py-0.5 rounded jarvis-btn-primary text-xs" onClick={save}>Save now</button>
                  <button className="px-2 py-0.5 rounded border border-amber-400/40 text-xs" onClick={() => setImportPending(false)}>Dismiss</button>
                </div>
              </div>
            )}

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
