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
        <h1 className="text-xl font-semibold">Sign up</h1>
        <input className="w-full border rounded-xl px-3 py-2 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="w-full border rounded-xl px-3 py-2 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        {notice && <div className="text-slate-300 dark:text-slate-400 text-sm">{notice}</div>}
        <button className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 text-white py-2">Create account</button>
        <div className="text-sm text-slate-300 dark:text-slate-400">Have an account? <Link className="text-blue-300" to="/signin">Sign in</Link></div>
      </form>
    </div>
  )
}
