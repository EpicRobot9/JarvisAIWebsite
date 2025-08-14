import { useState } from 'react'

export default function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [openai, setOpenai] = useState(localStorage.getItem('user_openai_api_key') || '')
  const [el, setEl] = useState(localStorage.getItem('user_elevenlabs_api_key') || '')
  const [voice, setVoice] = useState(localStorage.getItem('user_elevenlabs_voice_id') || '')

  function save() {
    if (openai.trim()) localStorage.setItem('user_openai_api_key', openai.trim())
    else localStorage.removeItem('user_openai_api_key')
    if (el.trim()) localStorage.setItem('user_elevenlabs_api_key', el.trim())
    else localStorage.removeItem('user_elevenlabs_api_key')
  if (voice.trim()) localStorage.setItem('user_elevenlabs_voice_id', voice.trim())
  else localStorage.removeItem('user_elevenlabs_voice_id')
    setOpen(false)
  }
  function useDefaults() {
    localStorage.removeItem('user_openai_api_key')
    localStorage.removeItem('user_elevenlabs_api_key')
  localStorage.removeItem('user_elevenlabs_voice_id')
    setOpenai('')
    setEl('')
  setVoice('')
  }

  return (
    <div className="relative">
      <button className="jarvis-btn" onClick={()=>setOpen(o=>!o)}>Settings</button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 glass rounded-xl p-3 z-20">
          <div className="text-cyan-300 font-semibold mb-2">API Keys (optional)</div>
          <p className="text-xs jarvis-subtle mb-2">Use your own keys to override defaults. Remove them or click "Use defaults" to switch back to the portal's keys and voice.</p>
          <label className="text-xs">OpenAI API Key</label>
          <input className="jarvis-input mb-2" placeholder="sk-..." value={openai} onChange={e=>setOpenai(e.target.value)} />
          <label className="text-xs">ElevenLabs API Key</label>
          <input className="jarvis-input mb-3" placeholder="sk_..." value={el} onChange={e=>setEl(e.target.value)} />
          <label className="text-xs">ElevenLabs Voice ID (used only with your key)</label>
          <input className="jarvis-input mb-3" placeholder="e.g. 21m00Tcm4TlvDq8ikWAM" value={voice} onChange={e=>setVoice(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <button className="px-3 py-1 border rounded border-cyan-200/20" onClick={useDefaults}>Use defaults</button>
            <button className="px-3 py-1 rounded jarvis-btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
