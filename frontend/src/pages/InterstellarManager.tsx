import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useInterstellarApi } from '../hooks/useInterstellarApi'
import { ArrowLeftIcon } from '@heroicons/react/24/solid'

function useUser() {
  // Start as undefined while we fetch; this prevents immediate redirects that
  // happen when components assume `null` means "no user" before the fetch
  // completes. We only redirect when user === null (fetch completed, no user).
  const [user, setUser] = useState<any | null | undefined>(undefined)
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(async r => {
        if (!r.ok) return null
        const txt = await r.text()
        return txt ? JSON.parse(txt) : null
      })
      .then(setUser)
      .catch(()=>{})
  }, [])
  return { user }
}

export default function InterstellarManager() {
  const nav = useNavigate()
  const { user } = useUser()

  useEffect(() => {
  // Do NOT force redirect to signin. Page should be viewable by anyone.
  // Keep nav-based redirect only for pages that truly require auth.
  }, [user, nav])
  const {
    isProd,
    setIsProd,
    loading,
    error,
    data,
    fetchData,
    execAction
  } = useInterstellarApi()
  // Local override data & errors returned by the explicit GET flow
  const [overrideData, setOverrideData] = useState<any | null>(null)
  const [localError, setLocalError] = useState('')

  const [blockedName, setBlockedName] = useState('')
  const [processing, setProcessing] = useState('')
  const [success, setSuccess] = useState('')

  // Load on mount and env change
  useEffect(() => {
    fetchData()
  }, [isProd])

  // Clear success message after delay
  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(''), 2000)
    return () => clearTimeout(t)
  }, [success])

  const handleAction = async (action: string, name?: string) => {
    setProcessing(action)
    try {
      if (action === 'NewBackUp' && !confirm('This will stop current links while creating 2 backups. Continue?')) {
        return
      }
      const payload: any = { TypeOfAction: action }
      if (name) payload.BlockedCodespaceFullName = name
      // For admin-only actions like NewBackUp, prefer server-side exec path.
      if (action === 'NewBackUp') {
        // If user is admin, call admin backup endpoint; otherwise block client-side.
        if (user && user.role === 'admin') {
          const r = await fetch('/api/admin/create-backup', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            credentials: 'include'
          })
          if (!r.ok) {
            const errorData = await r.json().catch(() => null)
            throw new Error(errorData?.error || `HTTP ${r.status}`)
          }
          const result = await r.json()
          setSuccess(`NewBackUp successful! ${result.codespaceRefreshed ? '(Codespace refreshed)' : ''}`)
          await fetchData()
        } else {
          alert('Only admins may create backups. Request an admin to perform this action.')
        }
      } else if (action === 'Blocked') {
        // If user is admin, perform immediately; otherwise create a request
        if (user && user.role === 'admin') {
          if (await execAction(payload)) {
            setSuccess('Blocked successful')
            await fetchData()
          }
        } else if (user) {
          // Authenticated non-admin users: submit report request
          const r = await fetch('/api/interstellar/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ fullName: name }) })
          if (!r.ok) throw new Error('report_failed')
          setSuccess('Report submitted; pending admin review')
        } else {
          // Not signed in: prompt sign in
          nav('/signin')
        }
      } else {
        if (await execAction(payload)) {
          setSuccess(`${action} successful`)
          await fetchData() // Refresh
        }
      }
    } finally {
      setProcessing('')
      setBlockedName('')
    }
  }

  // Admin requests list
  const [requests, setRequests] = useState<any[]>([])
  const fetchRequests = async () => {
    if (!user || user.role !== 'admin') return
    try {
      const r = await fetch('/api/admin/interstellar/requests', { credentials: 'include' })
      if (!r.ok) return
      const j = await r.json()
      setRequests(j.items || [])
    } catch {}
  }
  useEffect(() => { fetchRequests() }, [user])

  const decideRequest = async (id: string, decision: 'approved' | 'denied') => {
    try {
      const r = await fetch('/api/admin/interstellar/requests/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ requestId: id, decision }) })
      if (!r.ok) throw new Error('decide_failed')
      setRequests(prev => prev.filter(x => x.id !== id))
      setSuccess(`Request ${decision}`)
    } catch (e) {
      alert('Failed to decide request')
    }
  }

  return (
    <div className="relative p-4 max-w-5xl mx-auto">
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] bg-[radial-gradient(800px_400px_at_50%_-10%,#5de8ff_0%,transparent_60%)]" />
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
                    <Link to="/" className="px-3 py-2 rounded-xl border border-cyan-200/20">
            <ArrowLeftIcon className="w-4 h-4" />
          </Link>
          <h1 className="text-xl font-semibold text-cyan-300">Interstellar Manager</h1>
        </div>
        <div className="flex gap-2">
          {user && user.role === 'admin' && (
            <Link to="/admin/interstellar" className="px-3 py-2 rounded-xl border border-cyan-200/20 text-sm">
              Admin
            </Link>
          )}
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isProd}
              onChange={e => setIsProd(e.target.checked)}
            />
            <div className="relative w-14 h-6 rounded-full transition-colors bg-gray-700 peer-checked:bg-cyan-500
                          after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                          after:h-5 after:w-5 after:bg-white after:rounded-full after:transition-transform
                          peer-checked:after:translate-x-[32px]" />
            <span className="ml-2 select-none">{isProd ? 'Prod' : 'Test'}</span>
          </label>
        </div>
      </div>

      {/* Action Bar */}
      <div className="glass rounded-2xl p-4 mb-4">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              className="px-3 py-2 rounded-xl border border-cyan-200/20 disabled:opacity-50"
              onClick={() => fetchData()}
              disabled={loading || !!processing}>
              Refresh
            </button>
            <button
              className="px-3 py-2 rounded-xl border border-cyan-200/20 disabled:opacity-50"
              onClick={async () => {
                // Fetch configured GET URL from server, then call it with GET
                try {
                  setProcessing('RefreshGET')
                  setLocalError('')
                  const r = await fetch('/api/interstellar-urls', { cache: 'no-store' })
                  if (!r.ok) throw new Error('Failed to load interstellar urls')
                  const urls = await r.json()
                  const getUrl = isProd ? (urls.prod?.get || '') : (urls.test?.get || '')
                  if (!getUrl) throw new Error('Interstellar GET URL not configured')
                  const g = await fetch(getUrl, { method: 'GET' })
                  if (!g.ok) throw new Error(`Failed GET ${g.status}`)
                  const json = await g.json()
                  if (!Array.isArray(json) || !json[0]) throw new Error('Invalid GET response format')
                  const d = json[0]
                  // Normalize Public URL -> public_url and ensure shape
                  console.log('Raw n8n data before normalization:', JSON.stringify(d, null, 2))
                  if (Array.isArray(d.CurrentCodespaces)) {
                    d.CurrentCodespaces = d.CurrentCodespaces.map((c: any) => ({
                      ...c,
                      public_url: c.public_url || c['Public URL'] || c['Public Url'] || c.publicUrl || c.PublicURL || c.url || c.URL || ''
                    }))
                  }
                  if (Array.isArray(d.BackUpCodespaces)) {
                    d.BackUpCodespaces = d.BackUpCodespaces.map((c: any) => ({
                      ...c,
                      public_url: c.public_url || c['Public URL'] || c['Public Url'] || c.publicUrl || c.PublicURL || c.url || c.URL || ''
                    }))
                  }
                  console.log('Normalized data with public URLs:', JSON.stringify(d, null, 2))
                  setOverrideData(d)
                } catch (e) {
                  setLocalError(String(e))
                } finally {
                  setProcessing('')
                }
              }}
              disabled={loading || !!processing}
            >
              Refresh (n8n GET)
            </button>
            <button
              className="px-3 py-2 rounded-xl border border-cyan-200/20 disabled:opacity-50"
              onClick={() => handleAction('Start')}
              disabled={loading || !!processing}>
              Start All
            </button>
            <button
              className="px-3 py-2 rounded-xl border border-cyan-200/20 disabled:opacity-50"
              onClick={() => handleAction('Stop')}
              disabled={loading || !!processing}>
              Stop All
            </button>
            <button
              className="px-3 py-2 rounded-xl border border-cyan-200/20 disabled:opacity-50"
              onClick={() => handleAction('Swap')}
              disabled={loading || !!processing}>
              Swap to Backup
            </button>
            <button
              className="px-3 py-2 rounded-xl border border-green-500/30 text-green-300 hover:bg-green-500/10 disabled:opacity-50 font-semibold"
              onClick={() => handleAction('NewBackUp')}
              disabled={loading || !!processing}>
              {processing === 'NewBackUp' ? 'Creating Backups & Refreshing...' : 'New Backups & Refresh'}
            </button>
          </div>

          <div className="flex gap-2 items-center">
            <input
              type="text"
              placeholder="Enter blocked codespace name..."
              className="flex-1 px-3 py-2 rounded-xl bg-black/20 border border-cyan-200/20"
              value={blockedName}
              onChange={e => setBlockedName(e.target.value)}
              disabled={loading || !!processing}
            />
            <button
              className="px-3 py-2 rounded-xl border border-cyan-200/20 disabled:opacity-50"
              onClick={() => handleAction('Blocked', blockedName)}
              disabled={loading || !!processing || !blockedName.trim()}>
              Report Blocked
            </button>
          </div>
        </div>
      </div>

      {/* Status/Messages */}
      {(error || localError) && (
        <div className="mb-4 p-3 rounded-xl border border-red-400/30 bg-red-950/30 text-red-300">
          {error || localError}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 rounded-xl border border-green-400/30 bg-green-950/30 text-green-300">
          {success}
        </div>
      )}
      {processing && (
        <div className="mb-4 p-3 rounded-xl border border-cyan-200/20 bg-black/20">
          Processing {processing}...
        </div>
      )}

      {/* Codespace Lists */}
      {(overrideData || data) && (
        <div className="space-y-6">
          {/* Current Codespaces */}
          <div>
            <h2 className="text-lg font-semibold mb-2 text-cyan-300">Current Codespaces</h2>
      {(overrideData || data).CurrentCodespaces?.length ? (
              <div className="grid gap-3">
        {(overrideData || data).CurrentCodespaces.map(cs => (
                  <div key={cs.full_codespace_name} className="p-3 rounded-xl border border-cyan-200/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{cs.display_name}</div>
                        <div className="mt-1 text-xs font-mono truncate" title={cs.full_codespace_name} onClick={() => navigator.clipboard.writeText(cs.full_codespace_name)}>
                          {cs.full_codespace_name}
                        </div>
                        {cs.public_url && (
                          <div className="mt-2">
                            <div className="text-xs text-gray-400 mb-1">Public URL:</div>
                            <a href={cs.public_url} target="_blank" rel="noopener" className="text-sm text-cyan-300 hover:underline break-all">
                              {cs.public_url}
                            </a>
                          </div>
                        )}
                        {!cs.public_url && (
                          <div className="mt-2 text-xs text-yellow-400">
                            No public URL available
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-xl border border-cyan-200/20 bg-black/20">
                No current codespaces found.
              </div>
            )}
          </div>

          {/* Backup Codespaces */}
          <div>
            <h2 className="text-lg font-semibold mb-2 text-cyan-300">Backup Codespaces</h2>
      {(overrideData || data).BackUpCodespaces?.length ? (
              <div className="grid gap-3">
        {(overrideData || data).BackUpCodespaces.map(cs => (
                  <div key={cs.full_codespace_name} className="p-3 rounded-xl border border-cyan-200/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{cs.display_name}</div>
                        <div className="mt-1 text-xs font-mono truncate" title={cs.full_codespace_name} onClick={() => navigator.clipboard.writeText(cs.full_codespace_name)}>
                          {cs.full_codespace_name}
                        </div>
                        {cs.public_url && (
                          <div className="mt-2">
                            <div className="text-xs text-gray-400 mb-1">Public URL:</div>
                            <a href={cs.public_url} target="_blank" rel="noopener" className="text-sm text-cyan-300 hover:underline break-all">
                              {cs.public_url}
                            </a>
                          </div>
                        )}
                        {!cs.public_url && (
                          <div className="mt-2 text-xs text-yellow-400">
                            No public URL available
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-xl border border-cyan-200/20 bg-black/20">
                No backup codespaces found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
