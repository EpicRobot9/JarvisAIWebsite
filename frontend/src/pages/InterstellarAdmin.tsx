import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { InterstellarWebhookSection } from '../components/InterstellarWebhookSection'

interface InterstellarUrls {
  prod: { get: string; post: string }
  test: { get: string; post: string }
}

interface CodespaceInfo {
  row_number: number
  display_name: string
  full_codespace_name: string
  repository: string
  start_url: string
  stop_url: string
  public_url: string
}

interface CodespaceData {
  CurrentCodespaces: CodespaceInfo[]
  BackUpCodespaces: CodespaceInfo[]
}

export default function InterstellarAdmin() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [interstellarUrls, setInterstellarUrls] = useState<InterstellarUrls>({ 
    prod: { get: '', post: '' }, 
    test: { get: '', post: '' } 
  })
  const [isProd, setIsProd] = useState(true)
  const [codespaceData, setCodespaceData] = useState<CodespaceData | null>(null)
  const [processing, setProcessing] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
        const t = await r.text()
        const m = t ? JSON.parse(t) : null
        console.log('InterstellarAdmin: User data:', m)
        setMe(m)
        if (!m) {
          console.log('InterstellarAdmin: No user, redirecting to signin')
          nav('/signin')
          return
        }
        if (m.role !== 'admin') {
          console.log('InterstellarAdmin: User is not admin, redirecting to main page')
          nav('/')
          return
        }

        // Load existing URLs
        const it = await fetch('/api/admin/interstellar-webhook-urls', { credentials: 'include', cache: 'no-store' })
        if (it.ok) {
          const data = await it.json()
          setInterstellarUrls({
            prod: { get: data.prodGet || '', post: data.prodPost || '' },
            test: { get: data.testGet || '', post: data.testPost || '' }
          })
        }

        // Load initial codespace data
        await fetchCodespaces()

      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Load codespace data when environment changes
  useEffect(() => {
    if (me) {
      fetchCodespaces()
    }
  }, [isProd, me])

  // Clear success message after delay
  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(t)
  }, [success])

  async function fetchCodespaces() {
    if (!me) return
    try {
      const env = isProd ? 'prod' : 'test'
      const r = await fetch(`/api/interstellar/get-codespaces?env=${env}`, {
        method: 'GET',
        credentials: 'include'
      })
      if (r.ok) {
        const json = await r.json()
        if (Array.isArray(json) && json[0]) {
          setCodespaceData(json[0])
        }
      }
    } catch (e) {
      console.error('Failed to fetch codespaces:', e)
    }
  }

  async function saveUrls(urls: InterstellarUrls) {
    const r = await fetch('/api/admin/interstellar-webhook-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        prodGet: urls.prod.get,
        prodPost: urls.prod.post,
        testGet: urls.test.get,
        testPost: urls.test.post
      })
    })
    if (!r.ok) throw new Error('Failed to save URLs')
    const data = await r.json()
    // Update state with normalized values from server
    setInterstellarUrls({
      prod: { get: data.prodGet || '', post: data.prodPost || '' },
      test: { get: data.testGet || '', post: data.testPost || '' }
    })
  }

  async function createNewBackup() {
    if (!confirm('This will stop current links while creating 2 backups. Continue?')) {
      return
    }

    setProcessing('NewBackUp')
    setError('')
    setSuccess('')

    try {
      const env = isProd ? 'prod' : 'test'
      const r = await fetch('/api/admin/interstellar/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'NewBackUp', env })
      })

      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        if (errorData.error === 'post_url_not_configured') {
          throw new Error('❌ Error: Webhook URLs not configured. Please configure them first.')
        }
        throw new Error(`Failed to create backup: ${r.status}`)
      }

      const result = await r.json()
      setSuccess('✅ New backup created successfully!')
      
      // Refresh codespace data after backup creation
      await fetchCodespaces()
      
    } catch (e) {
      setError(String(e))
    } finally {
      setProcessing('')
    }
  }

  if (loading) return (
    <div className="p-4 text-center">
      <div>Loading admin panel...</div>
      <div className="text-sm text-gray-400 mt-2">Checking authentication...</div>
    </div>
  )
  
  if (error) return (
    <div className="p-4 text-center">
      <div className="text-red-400 text-sm mb-2">Error: {error}</div>
      <button onClick={() => nav('/signin')} className="px-3 py-1 rounded border border-cyan-200/20">
        Go to Sign In
      </button>
    </div>
  )

  return (
    <div className="relative p-4 max-w-5xl mx-auto">
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] bg-[radial-gradient(800px_400px_at_50%_-10%,#5de8ff_0%,transparent_60%)]" />
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-cyan-300">Interstellar Admin</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/admin?stay=true" className="px-3 py-2 rounded-xl border border-cyan-200/20 text-sm">
            Back to Admin
          </Link>
          <Link to="/interstellar" className="px-3 py-2 rounded-xl border border-cyan-200/20 text-sm">
            Manager View
          </Link>
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

      {/* Status Messages */}
      {error && (
        <div className="mb-4 p-3 rounded-xl border border-red-400/30 bg-red-950/30 text-red-300">
          {error}
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

      {/* Webhook URLs Configuration */}
      <div className="glass rounded-2xl p-4 mb-6">
        <InterstellarWebhookSection 
          urls={interstellarUrls}
          onSave={saveUrls}
        />
      </div>

      {/* Action Controls */}
      <div className="glass rounded-2xl p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3 text-cyan-300">Actions</h2>
        <div className="flex gap-3">
          <button
            className="px-4 py-2 rounded-xl border border-cyan-200/20 disabled:opacity-50"
            onClick={fetchCodespaces}
            disabled={loading || !!processing}>
            Refresh Codespaces
          </button>
          <button
            className="px-4 py-2 rounded-xl border border-green-500/30 text-green-300 hover:bg-green-500/10 disabled:opacity-50 font-semibold"
            onClick={createNewBackup}
            disabled={loading || !!processing}>
            {processing === 'NewBackUp' ? 'Creating New Backups...' : 'Create New Backups'}
          </button>
        </div>
      </div>

      {/* Codespace Display */}
      {codespaceData && (
        <div className="space-y-6">
          {/* Current Codespaces */}
          <div className="glass rounded-2xl p-4">
            <h2 className="text-lg font-semibold mb-3 text-cyan-300">Current Codespaces ({isProd ? 'Prod' : 'Test'})</h2>
            {codespaceData.CurrentCodespaces?.length ? (
              <div className="grid gap-3">
                {codespaceData.CurrentCodespaces.map(cs => (
                  <div key={cs.full_codespace_name} className="p-3 rounded-xl border border-cyan-200/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{cs.display_name}</div>
                        <div className="mt-1 text-xs font-mono truncate" title={cs.full_codespace_name}>
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
          <div className="glass rounded-2xl p-4">
            <h2 className="text-lg font-semibold mb-3 text-cyan-300">Backup Codespaces ({isProd ? 'Prod' : 'Test'})</h2>
            {codespaceData.BackUpCodespaces?.length ? (
              <div className="grid gap-3">
                {codespaceData.BackUpCodespaces.map(cs => (
                  <div key={cs.full_codespace_name} className="p-3 rounded-xl border border-cyan-200/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="font-medium">{cs.display_name}</div>
                        <div className="mt-1 text-xs font-mono truncate" title={cs.full_codespace_name}>
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
