import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

export default function Admin() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState({ REQUIRE_ADMIN_APPROVAL: false, LOCK_NEW_ACCOUNTS: false })
  const [keys, setKeys] = useState({ OPENAI_API_KEY: { has: false, preview: null }, ELEVENLABS_API_KEY: { has: false, preview: null } })
  const [editKey, setEditKey] = useState(null) // 'openai' | 'eleven' | null
  const [keyInputs, setKeyInputs] = useState({ openai: '', eleven: '' })
  const [savingKeys, setSavingKeys] = useState(false)
  const [savingKey, setSavingKey] = useState(null)
  const [savedKey, setSavedKey] = useState(null)
  const [pending, setPending] = useState([])
  const [logs, setLogs] = useState({ items: [], nextCursor: null })
  const [logFilters, setLogFilters] = useState({ path: '', status: '', ok: '', method: '' })
  const [selectedLog, setSelectedLog] = useState(null)
  const [live, setLive] = useState(false)
  const [testing, setTesting] = useState(false)
  const [webhookUrls, setWebhookUrls] = useState({ prod: '', test: '' })
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [savedWebhook, setSavedWebhook] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
        const t = await r.text()
        const m = t ? JSON.parse(t) : null
        setMe(m)
        if (!m || m.role !== 'admin') {
          nav('/signin')
          return
        }
  const s = await fetch('/api/admin/settings', { credentials: 'include' })
  if (s.ok) setSettings(await s.json())
        const k = await fetch('/api/admin/keys', { credentials: 'include', cache: 'no-store' }).catch(()=>null)
        if (k?.ok) setKeys(await k.json())
  const wu = await fetch('/api/admin/webhook-urls', { credentials: 'include', cache: 'no-store' }).catch(()=>null)
  if (wu?.ok) setWebhookUrls(await wu.json())
        // Load settings and users
        const u = await fetch('/api/admin/users', { credentials: 'include' })
        if (!u.ok) throw new Error(`Failed to load users: ${u.status}`)
        setUsers(await u.json())
        // Load pending for quick approvals inline
        const p = await fetch('/api/admin/pending', { credentials: 'include', cache: 'no-store' }).catch(()=>null)
        if (p?.ok) {
          const txt = await p.text(); setPending(txt ? JSON.parse(txt) : [])
        }
  // Load initial logs
  const lg = await fetch('/api/admin/logs?take=50', { credentials: 'include', cache: 'no-store' }).catch(()=>null)
  if (lg?.ok) setLogs(await lg.json())
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function setRole(userId, role) {
    try {
      const r = await fetch('/api/admin/set-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ userId, role }) })
      if (!r.ok) throw new Error('set-role failed')
      setUsers(u => u.map(x => x.id === userId ? { ...x, role } : x))
    } catch (e) { setError(String(e)) }
  }
  async function approve(userId) {
    await fetch('/api/admin/approve', { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ userId }) })
    setPending(p => p.filter(u => u.id !== userId))
    setUsers(u => u.map(x => x.id===userId ? { ...x, status: 'active' } : x))
  }

  async function saveWebhookUrls() {
    try {
      setSavingWebhook(true)
      setSavedWebhook(false)
      const body = { prod: (webhookUrls.prod || '').trim(), test: (webhookUrls.test || '').trim() }
      const r = await fetch('/api/admin/webhook-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      })
      if (!r.ok) throw new Error('Failed to save webhook URLs')
      const data = await r.json()
      setWebhookUrls({ prod: data.prod || '', test: data.test || '' })
      // Update local cache so the UI picks up immediately in this browser
      try {
        localStorage.setItem('jarvis_webhook_prod', data.prod || '')
        localStorage.setItem('jarvis_webhook_test', data.test || '')
      } catch {}
      setSavedWebhook(true)
      setTimeout(()=> setSavedWebhook(false), 1500)
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingWebhook(false)
    }
  }
  async function deny(userId) {
    await fetch('/api/admin/deny', { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ userId }) })
    setPending(p => p.filter(u => u.id !== userId))
    setUsers(u => u.map(x => x.id===userId ? { ...x, status: 'denied' } : x))
  }
  async function delUser(userId) {
    if (!confirm('Delete this user? This cannot be undone.')) return
    try {
      const r = await fetch('/api/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ userId }) })
      if (!r.ok) throw new Error('delete failed')
      setUsers(u => u.filter(x => x.id !== userId))
    } catch (e) { setError(String(e)) }
  }
  async function resetPw(userId) {
    const newPassword = prompt('Enter a new password (min 6 chars):')
    if (!newPassword) return
    try {
      const r = await fetch('/api/admin/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ userId, newPassword }) })
      if (!r.ok) throw new Error('reset-password failed')
      alert('Password reset.')
    } catch (e) { setError(String(e)) }
  }

  async function reloadLogs(cursor) {
    const params = new URLSearchParams()
    params.set('take', '50')
    if (cursor) params.set('cursor', cursor)
    if (logFilters.path) params.set('path', logFilters.path)
    if (logFilters.status) params.set('status', logFilters.status)
    if (logFilters.ok) params.set('ok', logFilters.ok)
    if (logFilters.method) params.set('method', logFilters.method)
    const r = await fetch('/api/admin/logs?' + params.toString(), { credentials: 'include', cache: 'no-store' })
    if (r.ok) setLogs(await r.json())
  }

  useEffect(() => {
    if (!live) return
    let es
    try {
      es = new EventSource('/api/admin/logs/stream', { withCredentials: true })
      es.onmessage = (ev) => {
        try {
          const row = JSON.parse(ev.data)
          setLogs(prev => ({ items: [row, ...prev.items].slice(0, 200), nextCursor: prev.nextCursor }))
        } catch {}
      }
    } catch {}
    return () => { try { es?.close() } catch {} }
  }, [live])

  async function toggleSetting(key, value) {
    try {
      setError('')
      setSavingKey(key)
      const r = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: value })
      })
      if (!r.ok) throw new Error('update settings failed')
      const data = await r.json()
      if (data?.settings) setSettings(data.settings)
      else setSettings(prev => ({ ...prev, [key]: value }))
      setSavedKey(key)
      setTimeout(()=> setSavedKey(null), 1200)
    } catch (e) { setError(String(e)) }
    finally { setSavingKey(null) }
  }

  async function saveProviderKeys(action) {
    try {
      setSavingKeys(true)
      const body = {}
      if (action === 'clear-openai') body.OPENAI_API_KEY = ''
      if (action === 'clear-eleven') body.ELEVENLABS_API_KEY = ''
      if (action === 'save-openai' && keyInputs.openai.trim()) body.OPENAI_API_KEY = keyInputs.openai.trim()
      if (action === 'save-eleven' && keyInputs.eleven.trim()) body.ELEVENLABS_API_KEY = keyInputs.eleven.trim()
      if (Object.keys(body).length === 0) return
      const r = await fetch('/api/admin/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      if (!r.ok) throw new Error('Failed to update keys')
      const data = await r.json().catch(()=>null)
      if (data?.keys) setKeys(data.keys)
      setEditKey(null)
      setKeyInputs({ openai: '', eleven: '' })
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingKeys(false)
    }
  }

  async function testPush(kind) {
    try {
      setTesting(true)
      if (!me?.id) throw new Error('No admin session; sign in to test.')
      const path = '/api/integration/push-to-user'
      const token = (localStorage.getItem('integration_token') || 'prod-xyz-123').trim()
      const body = {
        userId: me.id,
        text: `Test ${kind === 'voice' ? 'voice ' : ''}message ${new Date().toISOString()}`,
        ...(kind === 'voice' ? { voice: true } : { say: false })
      }
      await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      })
      // If not live, refresh logs to show it
      if (!live) await reloadLogs()
    } catch (e) {
      setError(String(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="relative p-4 max-w-5xl mx-auto">
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] bg-[radial-gradient(800px_400px_at_50%_-10%,#5de8ff_0%,transparent_60%)]" />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-cyan-300">Admin Panel</h1>
        <div className="flex gap-2 text-sm">
          <Link to="/" className="px-3 py-2 rounded-xl border border-cyan-200/20">Home</Link>
          <Link to="/portal" className="px-3 py-2 rounded-xl border border-cyan-200/20">Portal</Link>
        </div>
      </div>
      {loading && <div>Loading…</div>}
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}
      {!loading && !error && (
  <div className="glass rounded-2xl p-4">
          {/* Provider Keys */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2 text-cyan-300">Provider Keys</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-cyan-200/20">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">OpenAI API key</div>
                    <div className="text-xs jarvis-subtle">Used for STT/transcription by default. Per-request override via X-OpenAI-Key.</div>
                    <div className="mt-1 text-xs">Current: <span className="font-mono">{keys.OPENAI_API_KEY.preview || '—'}</span></div>
                  </div>
                  <div className="flex flex-col items-end gap-2 min-w-[180px]">
                    {editKey === 'openai' ? (
                      <div className="w-full">
                        <input
                          type="password"
                          className="w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20"
                          placeholder="sk-..."
                          value={keyInputs.openai}
                          onChange={e=>setKeyInputs(v=>({...v, openai: e.target.value}))}
                        />
                        <div className="flex gap-2 mt-2 justify-end">
                          <button disabled={savingKeys || !keyInputs.openai.trim()} onClick={()=>saveProviderKeys('save-openai')} className="px-3 py-1 rounded-xl border border-cyan-200/20 disabled:opacity-50">Save</button>
                          <button onClick={()=>{setEditKey(null); setKeyInputs(v=>({...v, openai: ''}))}} className="px-3 py-1 rounded-xl border border-cyan-200/20">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={()=>setEditKey('openai')} className="px-3 py-1 rounded-xl border border-cyan-200/20">Edit</button>
                        <button disabled={savingKeys || !keys.OPENAI_API_KEY.has} onClick={()=>saveProviderKeys('clear-openai')} className="px-3 py-1 rounded-xl border border-red-400/30 text-red-300 disabled:opacity-50">Clear</button>
                      </div>
                    )}
                    {savingKeys && <span className="text-xs jarvis-subtle">Saving…</span>}
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-xl border border-cyan-200/20">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">ElevenLabs API key</div>
                    <div className="text-xs jarvis-subtle">Used for TTS by default. Per-request override via X-ElevenLabs-Key.</div>
                    <div className="mt-1 text-xs">Current: <span className="font-mono">{keys.ELEVENLABS_API_KEY.preview || '—'}</span></div>
                  </div>
                  <div className="flex flex-col items-end gap-2 min-w-[180px]">
                    {editKey === 'eleven' ? (
                      <div className="w-full">
                        <input
                          type="password"
                          className="w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20"
                          placeholder="elevenlabs_..."
                          value={keyInputs.eleven}
                          onChange={e=>setKeyInputs(v=>({...v, eleven: e.target.value}))}
                        />
                        <div className="flex gap-2 mt-2 justify-end">
                          <button disabled={savingKeys || !keyInputs.eleven.trim()} onClick={()=>saveProviderKeys('save-eleven')} className="px-3 py-1 rounded-xl border border-cyan-200/20 disabled:opacity-50">Save</button>
                          <button onClick={()=>{setEditKey(null); setKeyInputs(v=>({...v, eleven: ''}))}} className="px-3 py-1 rounded-xl border border-cyan-200/20">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={()=>setEditKey('eleven')} className="px-3 py-1 rounded-xl border border-cyan-200/20">Edit</button>
                        <button disabled={savingKeys || !keys.ELEVENLABS_API_KEY.has} onClick={()=>saveProviderKeys('clear-eleven')} className="px-3 py-1 rounded-xl border border-red-400/30 text-red-300 disabled:opacity-50">Clear</button>
                      </div>
                    )}
                    {savingKeys && <span className="text-xs jarvis-subtle">Saving…</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* n8n Webhook URLs */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2 text-cyan-300">n8n Webhook URLs</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-cyan-200/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-medium">Prod webhook URL</div>
                    <div className="text-xs jarvis-subtle">Used when Webhook toggle is set to Prod in the UI/call flows.</div>
                    <input
                      type="url"
                      className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                      placeholder="https://n8n.example.com/webhook/your-flow"
                      value={webhookUrls.prod}
                      onChange={e=>setWebhookUrls(v=>({...v, prod: e.target.value}))}
                    />
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-xl border border-cyan-200/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-medium">Test webhook URL</div>
                    <div className="text-xs jarvis-subtle">Used when Webhook toggle is set to Test in the UI/call flows.</div>
                    <input
                      type="url"
                      className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                      placeholder="https://n8n.example.com/webhook-test/your-flow"
                      value={webhookUrls.test}
                      onChange={e=>setWebhookUrls(v=>({...v, test: e.target.value}))}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button className="px-3 py-1 rounded-xl border border-cyan-200/20 disabled:opacity-50" disabled={savingWebhook} onClick={saveWebhookUrls}>Save URLs</button>
              {savingWebhook && <span className="text-xs jarvis-subtle">Saving…</span>}
              {savedWebhook && <span className="text-xs text-green-400">Saved</span>}
            </div>
          </div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-2 text-cyan-300">Signup Controls</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-cyan-200/20">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Require admin approval</div>
                    <div className="text-xs jarvis-subtle">New users are set to pending and must be approved.</div>
                  </div>
                  <div className="flex items-center gap-2 min-w-[132px] justify-end">
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={!!settings.REQUIRE_ADMIN_APPROVAL}
                        disabled={savingKey==='REQUIRE_ADMIN_APPROVAL'}
                        onChange={e=>toggleSetting('REQUIRE_ADMIN_APPROVAL', e.target.checked)}
                      />
                      <div className={`relative w-10 h-6 rounded-full transition-colors
                        bg-gray-300 dark:bg-gray-700 peer-checked:bg-cyan-500
                        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                        after:h-5 after:w-5 after:bg-white after:rounded-full after:transition-transform
                        peer-checked:after:translate-x-[16px]
                        ${savingKey==='REQUIRE_ADMIN_APPROVAL' ? 'opacity-60 cursor-not-allowed' : ''}`}></div>
                    </label>
                    {savingKey==='REQUIRE_ADMIN_APPROVAL' && <span className="text-xs jarvis-subtle">Saving…</span>}
                    {savedKey==='REQUIRE_ADMIN_APPROVAL' && <span className="text-xs text-green-400">Saved</span>}
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-xl border border-cyan-200/20">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Pause new signups</div>
                    <div className="text-xs jarvis-subtle">Block account creation entirely.</div>
                  </div>
                  <div className="flex items-center gap-2 min-w-[132px] justify-end">
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={!!settings.LOCK_NEW_ACCOUNTS}
                        disabled={savingKey==='LOCK_NEW_ACCOUNTS'}
                        onChange={e=>toggleSetting('LOCK_NEW_ACCOUNTS', e.target.checked)}
                      />
                      <div className={`relative w-10 h-6 rounded-full transition-colors
                        bg-gray-300 dark:bg-gray-700 peer-checked:bg-cyan-500
                        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                        after:h-5 after:w-5 after:bg-white after:rounded-full after:transition-transform
                        peer-checked:after:translate-x-[16px]
                        ${savingKey==='LOCK_NEW_ACCOUNTS' ? 'opacity-60 cursor-not-allowed' : ''}`}></div>
                    </label>
                    {savingKey==='LOCK_NEW_ACCOUNTS' && <span className="text-xs jarvis-subtle">Saving…</span>}
                    {savedKey==='LOCK_NEW_ACCOUNTS' && <span className="text-xs text-green-400">Saved</span>}
                  </div>
                </div>
              </div>
            </div>
            {settings.REQUIRE_ADMIN_APPROVAL && (
              <div className="mt-4">
                <h3 className="font-semibold mb-2">Pending approvals</h3>
                {pending.length === 0 ? (
                  <div className="text-sm jarvis-subtle">None</div>
                ) : (
                  <ul className="space-y-2">
                    {pending.map(u => (
                      <li key={u.id} className="flex items-center justify-between">
                        <span>{u.username}</span>
                        <div className="space-x-2">
                          <button className="px-3 py-1 rounded bg-green-600 text-white" onClick={()=>approve(u.id)}>Approve</button>
                          <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={()=>deny(u.id)}>Deny</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-2">Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-cyan-200/10">
                  <td className="py-2">{u.username}</td>
                  <td>{u.role}</td>
                  <td>{u.status}</td>
                  <td>{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="text-right">
                    {u.role === 'admin' ? (
                      <button className="px-2 py-1 rounded-xl border border-cyan-200/20 mr-2" onClick={()=>setRole(u.id,'user')}>Make user</button>
                    ) : (
                      <button className="px-2 py-1 rounded-xl border border-cyan-200/20 mr-2" onClick={()=>setRole(u.id,'admin')}>Make admin</button>
                    )}
                    <button className="px-2 py-1 rounded-xl border border-cyan-200/20 mr-2" onClick={()=>resetPw(u.id)}>Reset PW</button>
                    <button className="px-2 py-1 rounded-xl border border-red-400/30 text-red-300" onClick={()=>delUser(u.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-2 text-cyan-300">Logs</h2>
            <div className="flex flex-wrap gap-2 items-end mb-3">
              <div className="flex flex-col">
                <label className="text-xs jarvis-subtle">Path contains</label>
                <input value={logFilters.path} onChange={e=>setLogFilters(f=>({...f, path: e.target.value}))} placeholder="/api" className="px-2 py-1 rounded bg-black/20 border border-cyan-200/20" />
              </div>
              <div className="flex flex-col">
                <label className="text-xs jarvis-subtle">Method</label>
                <select value={logFilters.method} onChange={e=>setLogFilters(f=>({...f, method: e.target.value}))} className="px-2 py-1 rounded bg-black/20 border border-cyan-200/20 w-28">
                  <option value="">Any</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs jarvis-subtle">Status</label>
                <input value={logFilters.status} onChange={e=>setLogFilters(f=>({...f, status: e.target.value}))} placeholder="200" className="px-2 py-1 rounded bg-black/20 border border-cyan-200/20 w-24" />
              </div>
              <div className="flex flex-col">
                <label className="text-xs jarvis-subtle">OK</label>
                <select value={logFilters.ok} onChange={e=>setLogFilters(f=>({...f, ok: e.target.value}))} className="px-2 py-1 rounded bg-black/20 border border-cyan-200/20 w-28">
                  <option value="">Any</option>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
              <button onClick={()=>reloadLogs()} className="px-3 py-1 rounded-xl border border-cyan-200/20">Apply</button>
              <label className="inline-flex items-center gap-2 ml-auto text-xs">
                <input type="checkbox" checked={live} onChange={e=>setLive(e.target.checked)} /> Live
              </label>
            </div>
            <div className="flex gap-2 mb-3">
              <button disabled={testing} onClick={()=>testPush('text')} className="px-3 py-1 rounded-xl border border-cyan-200/20 disabled:opacity-50">Test push-to-user (text)</button>
              <button disabled={testing} onClick={()=>testPush('voice')} className="px-3 py-1 rounded-xl border border-cyan-200/20 disabled:opacity-50">Test push-to-user (voice)</button>
            </div>
            <div className="overflow-auto rounded-xl border border-cyan-200/10">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-400">
                  <tr>
                    <th className="py-2 px-2">Time</th>
                    <th className="px-2">Method</th>
                    <th className="px-2">Path</th>
                    <th className="px-2">Status</th>
                    <th className="px-2">ms</th>
                    <th className="px-2">User</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.items.map(l => (
                    <tr key={l.id} className="border-t border-cyan-200/10 hover:bg-white/5 cursor-pointer" onClick={()=>setSelectedLog(l)}>
                      <td className="py-2 px-2 whitespace-nowrap">{new Date(l.ts).toLocaleTimeString()}</td>
                      <td className="px-2">{l.method}</td>
                      <td className="px-2 truncate max-w-[360px]" title={l.path}>{l.path}</td>
                      <td className="px-2"><span className={l.ok? 'text-green-400':'text-red-400'}>{l.status}</span></td>
                      <td className="px-2">{l.durationMs ?? ''}</td>
                      <td className="px-2">{l.userId ? l.userId.slice(0,6)+'…' : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center mt-2 text-xs">
              <div className="jarvis-subtle">{logs.items.length} logs</div>
              <div>
                <button onClick={()=>reloadLogs(logs.nextCursor)} disabled={!logs.nextCursor} className="px-2 py-1 rounded-xl border border-cyan-200/20 disabled:opacity-50">Older</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedLog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4" onClick={()=>setSelectedLog(null)}>
          <div className="bg-black/80 border border-cyan-200/20 rounded-2xl max-w-3xl w-full max-h-[80vh] overflow-auto p-4" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">{selectedLog.method} {selectedLog.path}</div>
              <button className="px-2 py-1 rounded-xl border border-cyan-200/20" onClick={()=>setSelectedLog(null)}>Close</button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="jarvis-subtle mb-1">Request</div>
                <pre className="p-2 bg-black/40 rounded border border-cyan-200/10 whitespace-pre-wrap break-words">{selectedLog.requestBody || '—'}</pre>
              </div>
              <div>
                <div className="jarvis-subtle mb-1">Response</div>
                <pre className="p-2 bg-black/40 rounded border border-cyan-200/10 whitespace-pre-wrap break-words">{selectedLog.responseBody || '—'}</pre>
              </div>
            </div>
            {(selectedLog.errorMessage || selectedLog.errorStack) && (
              <div className="mt-3">
                <div className="text-red-400 mb-1">Error</div>
                <pre className="p-2 bg-black/40 rounded border border-red-400/20 whitespace-pre-wrap break-words">{selectedLog.errorMessage + '\n' + (selectedLog.errorStack || '')}</pre>
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs jarvis-subtle">
              <div>IP: {selectedLog.ip || '—'}</div>
              <div>UA: {selectedLog.userAgent || '—'}</div>
              <div>Status: {selectedLog.status}</div>
              <div>OK: {String(selectedLog.ok)}</div>
              <div>Duration: {selectedLog.durationMs ?? '—'} ms</div>
              <div>UserId: {selectedLog.userId || '—'}</div>
              <div>When: {new Date(selectedLog.ts).toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
