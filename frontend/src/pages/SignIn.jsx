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
  if (r.ok) nav('/')
    else setError('Invalid credentials or not approved.')
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl glass p-6 space-y-3">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input className="w-full border rounded-xl px-3 py-2 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="w-full border rounded-xl px-3 py-2 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 text-white py-2">Sign in</button>
        <div className="text-sm text-slate-300 dark:text-slate-400">No account? <Link className="text-blue-300" to="/signup">Sign up</Link></div>
      </form>
    </div>
  )
}
