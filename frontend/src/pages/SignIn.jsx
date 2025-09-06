import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function SignIn() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    const r = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    })
    if (r.ok) {
      nav('/')
    } else if (r.status === 403) {
      let err = ''
      try { const t = await r.text(); err = t ? (JSON.parse(t).error || '') : '' } catch {}
      if (err === 'pending') {
        try { sessionStorage.setItem('jarvis_pending_user', username); sessionStorage.setItem('jarvis_pending_pw', password) } catch {}
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
        <input
          className="jarvis-input"
          placeholder="Username"
          value={username}
          onChange={e=>setUsername(e.target.value)}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
        <div className="relative">
          <input
            className="jarvis-input pr-14"
            placeholder="Password"
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e=>setPassword(e.target.value)}
            name="password"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPw(s => !s)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            title={showPw ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md bg-white/10 hover:bg-white/20 text-cyan-200"
          >
            {showPw ? (
              // Eye-off icon
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M2 2l20 20"></path>
              </svg>
            ) : (
              // Eye icon
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            )}
          </button>
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button className="w-full jarvis-btn jarvis-btn-primary justify-center">Sign in</button>
        <div className="text-sm jarvis-subtle">No account? <Link className="text-cyan-300" to="/signup">Sign up</Link></div>
      </form>
    </div>
  )
}
