import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function SignUp() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(e) {
    e.preventDefault()
    setNotice('')
    const r = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    if (r.ok) {
      // Save creds in sessionStorage for auto-polling sign-in
      try {
        sessionStorage.setItem('jarvis_pending_user', username)
        sessionStorage.setItem('jarvis_pending_pw', password)
      } catch {}
      nav('/awaiting')
    } else {
      setNotice('Sign up blocked or already exists.')
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl glass p-6 space-y-3">
        <h1 className="jarvis-title">Sign up</h1>
  <input className="jarvis-input" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
        <input className="jarvis-input" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        {notice && <div className="text-slate-300 dark:text-slate-400 text-sm">{notice}</div>}
        <button className="w-full jarvis-btn jarvis-btn-primary justify-center">Create account</button>
        <div className="text-sm jarvis-subtle">Have an account? <Link className="text-cyan-300" to="/signin">Sign in</Link></div>
      </form>
    </div>
  )
}
