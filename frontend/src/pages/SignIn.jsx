import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function SignIn() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    const r = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    })
    if (r.ok) {
      nav('/')
    } else if (r.status === 403) {
      let err = ''
      try { const t = await r.text(); err = t ? (JSON.parse(t).error || '') : '' } catch {}
      if (err === 'pending') {
        try { sessionStorage.setItem('jarvis_pending_email', email); sessionStorage.setItem('jarvis_pending_pw', password) } catch {}
        nav('/awaiting')
      } else if (err === 'denied') {
        setError('Your request was denied. Contact an administrator.')
      } else {
        setError('Not approved yet. Please wait for admin approval.')
      }
    } else {
      setError('Invalid credentials or not approved.')
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl glass p-6 space-y-3">
        <h1 className="jarvis-title">Sign in</h1>
        <input className="jarvis-input" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="jarvis-input" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button className="w-full jarvis-btn jarvis-btn-primary justify-center">Sign in</button>
        <div className="text-sm jarvis-subtle">No account? <Link className="text-cyan-300" to="/signup">Sign up</Link></div>
      </form>
    </div>
  )
}
