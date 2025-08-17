import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function AwaitingApproval() {
  const nav = useNavigate()
  const [status, setStatus] = useState('pending') // 'pending' | 'denied' | 'error'
  const [msg, setMsg] = useState('Account created. Awaiting approval from an admin…')

  async function tryAutoSignIn() {
  const username = sessionStorage.getItem('jarvis_pending_user') || ''
    const password = sessionStorage.getItem('jarvis_pending_pw') || ''
  if (!username || !password) {
      setStatus('error')
      setMsg('Missing credentials. Please sign in when your account is approved.')
      return
    }
    try {
      const r = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    body: JSON.stringify({ username, password })
      })
      if (r.ok) {
        // Clear temp creds and go home
    sessionStorage.removeItem('jarvis_pending_user')
        sessionStorage.removeItem('jarvis_pending_pw')
        nav('/')
        return
      }
      if (r.status === 403) {
        let err = ''
        try { const t = await r.text(); err = t ? (JSON.parse(t).error || '') : '' } catch {}
        if (err === 'pending') {
          setStatus('pending')
          setMsg('Account created. Awaiting approval from an admin…')
          return
        }
        if (err === 'denied') {
          setStatus('denied')
          setMsg('Access denied. Your account request was not approved.')
          return
        }
      }
      if (r.status === 401) {
        setStatus('error')
        setMsg('Invalid credentials. Please try signing in again.')
        return
      }
      setStatus('error')
      setMsg('Unexpected error. Please try again later.')
    } catch (e) {
      setStatus('error')
      setMsg('Network error. We will retry automatically…')
    }
  }

  useEffect(() => {
    let mounted = true
    // Kick off immediately
    tryAutoSignIn()
    const id = setInterval(() => { if (mounted) tryAutoSignIn() }, 3000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-md rounded-2xl glass p-6 space-y-3 text-center">
        <h1 className="jarvis-title">{status === 'denied' ? 'Request Denied' : 'Awaiting Approval'}</h1>
        <div className="text-sm jarvis-subtle">{msg}</div>
        {status === 'pending' && (
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" aria-label="Loading" />
            <span>Checking every few seconds…</span>
          </div>
        )}
        <div className="pt-2 flex items-center justify-center gap-3">
          <button
            className="jarvis-btn"
            onClick={() => { sessionStorage.removeItem('jarvis_pending_user'); sessionStorage.removeItem('jarvis_pending_pw'); nav('/signin') }}
          >Use different account</button>
          <Link to="/" className="px-3 py-2 rounded-xl border border-cyan-200/20">Home</Link>
        </div>
      </div>
    </div>
  )
}
