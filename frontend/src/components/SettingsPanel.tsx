import { useState } from 'react'

export default function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [openai, setOpenai] = useState(localStorage.getItem('user_openai_api_key') || '')
  const [el, setEl] = useState(localStorage.getItem('user_elevenlabs_api_key') || '')

  function save() {
    if (openai.trim()) localStorage.setItem('user_openai_api_key', openai.trim())
    else localStorage.removeItem('user_openai_api_key')
    if (el.trim()) localStorage.setItem('user_elevenlabs_api_key', el.trim())
    else localStorage.removeItem('user_elevenlabs_api_key')
    setOpen(false)
  }
  function useDefaults() {
    localStorage.removeItem('user_openai_api_key')
    localStorage.removeItem('user_elevenlabs_api_key')
    setOpenai('')
    setEl('')
  }

  return (
    <div className="relative">
      <button className="border rounded-xl px-3 py-2 bg-white/70 dark:bg-slate-900/60" onClick={()=>setOpen(o=>!o)}>Settings</button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 glass rounded-xl p-3 z-20">
          <div className="font-semibold mb-2">API Keys (optional)</div>
          <label className="text-xs">OpenAI API Key</label>
          <input className="w-full border rounded-lg px-2 py-1 mb-2 bg-white/70 dark:bg-slate-900/60" placeholder="sk-..." value={openai} onChange={e=>setOpenai(e.target.value)} />
          <label className="text-xs">ElevenLabs API Key</label>
          <input className="w-full border rounded-lg px-2 py-1 mb-3 bg-white/70 dark:bg-slate-900/60" placeholder="sk_..." value={el} onChange={e=>setEl(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <button className="px-3 py-1 border rounded" onClick={useDefaults}>Use defaults</button>
            <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
