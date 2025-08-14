import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function SignUp() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(e) {
    e.preventDefault()
    setNotice('')
    const r = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    if (r.ok) {
      setNotice('Signed up. If approval required, wait for admin approval. You can sign in once active.')
      setTimeout(()=> nav('/signin'), 1000)
    } else {
      setNotice('Sign up blocked or already exists.')
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl glass p-6 space-y-3">
        <h1 className="jarvis-title">Sign up</h1>
        <input className="jarvis-input" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="jarvis-input" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        {notice && <div className="text-slate-300 dark:text-slate-400 text-sm">{notice}</div>}
        <button className="w-full jarvis-btn jarvis-btn-primary justify-center">Create account</button>
        <div className="text-sm jarvis-subtle">Have an account? <Link className="text-cyan-300" to="/signin">Sign in</Link></div>
      </form>
    </div>
  )
}
