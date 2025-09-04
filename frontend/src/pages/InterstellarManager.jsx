import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

export default function InterstellarManager() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')
  const [codespaces, setCodespaces] = useState({ CurrentCodespaces: [], BackUpCodespaces: [] })
  const [loading, setLoading] = useState(true)
  const [startingAll, setStartingAll] = useState(false)
  const [stoppingAll, setStoppingAll] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [webhookUrls, setWebhookUrls] = useState({
    prodPost: '',
    testPost: '',
    prodGet: '',
    testGet: ''
  })
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [savedWebhook, setSavedWebhook] = useState(false)
  const [blockingCodespace, setBlockingCodespace] = useState(null) // Track which codespace is being blocked

  // State for environment selection
  const [environment, setEnvironment] = useState(() => {
    try {
      return localStorage.getItem('interstellar_environment') || 'prod'
    } catch {
      return 'prod'
    }
  })

  // Save environment preference
  useEffect(() => {
    try { localStorage.setItem('interstellar_environment', environment) } catch {}
  }, [environment])

  // Load data
  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
        const t = await r.text()
        const m = t ? JSON.parse(t) : null
        setMe(m)

        if (m && m.role === 'admin') {
          const wu = await fetch('/api/admin/interstellar-webhook-urls', { credentials: 'include', cache: 'no-store' }).catch(()=>null)
          if (wu?.ok) setWebhookUrls(await wu.json())
        }

        await refreshCodespaces()
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [environment])

  async function refreshCodespaces() {
    try {
      setRefreshing(true)
      setError('')
      setSuccessMessage('')
      const r = await fetch(`/api/interstellar/get-codespaces?env=${environment}`, {
        method: 'GET',
        credentials: 'include'
      })
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        if (errorData.error === 'get_url_not_configured') {
          throw new Error('Webhook URLs not configured. Please contact an administrator.')
        } else if (errorData.error === 'fetch_failed') {
          throw new Error(`Unable to connect to external webhook service (${r.status}). Service may be temporarily unavailable.`)
        }
        throw new Error(`Failed to fetch codespaces (${r.status})`)
      }
      const data = await r.json()
      console.log('🎯 Frontend received data:', JSON.stringify(data, null, 2))
      
      const codespacesData = Array.isArray(data) ? data[0] : data
      console.log('🎯 Processed codespaces data:', JSON.stringify(codespacesData, null, 2))
      
      const { CurrentCodespaces = [], BackUpCodespaces = [], _note, _statusData = {} } = codespacesData || {}
      
      console.log('🎯 Extracted arrays:', {
        CurrentCodespaces: CurrentCodespaces.length,
        BackUpCodespaces: BackUpCodespaces.length,
        note: _note,
        statusDataKeys: Object.keys(_statusData)
      })
      
      // Update codespace status if we have status data
      console.log('🔍 Status data received:', _statusData)
      const updatedCurrentCodespaces = CurrentCodespaces.map(cs => {
        // Try multiple potential identifiers for matching status
        const codespaceId = cs.full_codespace_name || cs.name || cs.display_name || cs.id
        console.log('🔍 Checking status for codespace:', codespaceId, 'Available statuses:', Object.keys(_statusData))
        if (codespaceId && _statusData[codespaceId]) {
          console.log('🔍 Found status for', codespaceId, ':', _statusData[codespaceId])
          return { ...cs, state: _statusData[codespaceId] }
        }
        return cs
      })
      
      const updatedBackupCodespaces = BackUpCodespaces.map(cs => {
        const codespaceId = cs.full_codespace_name || cs.name || cs.display_name || cs.id
        if (codespaceId && _statusData[codespaceId]) {
          return { ...cs, state: _statusData[codespaceId] }
        }
        return cs
      })
      
      setCodespaces({ 
        CurrentCodespaces: updatedCurrentCodespaces, 
        BackUpCodespaces: updatedBackupCodespaces, 
        _note,
        _statusData 
      })
      
      if (_note) {
        setError(`Note: ${_note}`)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setRefreshing(false)
    }
  }

  function handleCommandResponse(data, actionName) {
    const responseData = Array.isArray(data) ? data[0] : data
    if (responseData && responseData.Success === true) {
      setSuccessMessage(`${actionName} operation completed successfully!`)
      setError('')
    } else if (responseData && responseData.Success === false) {
      setError(`${actionName} operation failed.`)
      setSuccessMessage('')
    } else {
      setSuccessMessage(`${actionName} command sent successfully.`)
      setError('')
    }
  }

  async function startAll() {
    try {
      setStartingAll(true)
      setError('')
      setSuccessMessage('')
      const r = await fetch('/api/interstellar/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'Start', env: environment })
      })
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        if (errorData.error === 'post_url_not_configured') {
          throw new Error('Webhook URLs not configured. Please contact an administrator.')
        } else if (errorData.error === 'forward_failed') {
          throw new Error(`Unable to connect to external webhook service (${errorData.status || 'unknown'}). Service may be temporarily unavailable.`)
        }
        throw new Error(`Failed to start codespaces (${r.status})`)
      }
      const data = await r.json()
      handleCommandResponse(data, 'Start')
      await refreshCodespaces()
    } catch (e) {
      setError(String(e))
      setSuccessMessage('')
    } finally {
      setStartingAll(false)
    }
  }

  async function stopAll() {
    try {
      setStoppingAll(true)
      setError('')
      setSuccessMessage('')
      const r = await fetch('/api/interstellar/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'Stop', env: environment })
      })
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        if (errorData.error === 'post_url_not_configured') {
          throw new Error('Webhook URLs not configured. Please contact an administrator.')
        } else if (errorData.error === 'forward_failed') {
          throw new Error(`Unable to connect to external webhook service (${errorData.status || 'unknown'}). Service may be temporarily unavailable.`)
        }
        throw new Error(`Failed to stop codespaces (${r.status})`)
      }
      const data = await r.json()
      handleCommandResponse(data, 'Stop')
      await refreshCodespaces()
    } catch (e) {
      setError(String(e))
      setSuccessMessage('')
    } finally {
      setStoppingAll(false)
    }
  }

  async function swapCodespaces() {
    try {
      setSwapping(true)
      setError('')
      setSuccessMessage('')
      const r = await fetch('/api/interstellar/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'Swap', env: environment })
      })
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        if (errorData.error === 'post_url_not_configured') {
          throw new Error('Webhook URLs not configured. Please contact an administrator.')
        } else if (errorData.error === 'forward_failed') {
          throw new Error(`Unable to connect to external webhook service (${errorData.status || 'unknown'}). Service may be temporarily unavailable.`)
        }
        throw new Error(`Failed to swap codespaces (${r.status})`)
      }
      const data = await r.json()
      handleCommandResponse(data, 'Swap')
      await refreshCodespaces()
    } catch (e) {
      setError(String(e))
      setSuccessMessage('')
    } finally {
      setSwapping(false)
    }
  }

  async function saveWebhookUrls() {
    try {
      setSavingWebhook(true)
      const r = await fetch('/api/admin/interstellar-webhook-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(webhookUrls)
      })
      if (!r.ok) throw new Error(`Failed to save webhook URLs (${r.status})`)
      setSavedWebhook(true)
      setTimeout(() => setSavedWebhook(false), 2000)
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingWebhook(false)
    }
  }

  async function blockCodespace(fullName) {
    if (!fullName) return
    
    const confirmMessage = me?.role === 'admin' 
      ? `Are you sure you want to block "${fullName}"? This will immediately remove it from the system.`
      : `Are you sure you want to request blocking "${fullName}"? This will create a pending request for admin approval.`
    
    if (!confirm(confirmMessage)) return
    
    try {
      setBlockingCodespace(fullName) // Set loading state for this specific codespace
      setError('')
      setSuccessMessage('')
      
      const r = await fetch('/api/interstellar/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          fullName, 
          env: environment === 'prod' ? 'prod' : 'test' 
        })
      })
      
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        if (r.status === 401) {
          throw new Error('Please sign in to block codespaces.')
        }
        throw new Error(errorData.error || `Failed to block codespace (${r.status})`)
      }
      
      const data = await r.json()
      
      if (data.blocked) {
        setSuccessMessage(`Successfully blocked "${fullName}"`)
        await refreshCodespaces() // Refresh to show updated state
      } else if (data.pending) {
        setSuccessMessage(`Block request submitted for "${fullName}". Waiting for admin approval.`)
      }
      
      setError('')
    } catch (e) {
      setError(String(e))
      setSuccessMessage('')
    } finally {
      setBlockingCodespace(null) // Clear loading state
    }
  }

  const backupDataSameAsCurrent = 
    codespaces.BackUpCodespaces && codespaces.CurrentCodespaces &&
    JSON.stringify(codespaces.BackUpCodespaces) === JSON.stringify(codespaces.CurrentCodespaces)

  if (loading) return <div className="flex justify-center p-8">Loading...</div>

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="jarvis-title">Interstellar Manager</h1>
          <p className="jarvis-subtle">Manage GitHub Codespaces through n8n webhooks</p>
        </div>
        <div className="flex items-center gap-4">
          <select 
            value={environment} 
            onChange={(e) => setEnvironment(e.target.value)}
            className="jarvis-input max-w-40"
          >
            <option value="prod">Production</option>
            <option value="test">Test</option>
          </select>
          <Link to="/admin" className="jarvis-btn">← Back to Admin</Link>
        </div>
      </div>

      {successMessage && (
        <div className="glass p-4 border-green-400/20 bg-green-500/10">
          <div className="text-green-300">✅ {successMessage}</div>
        </div>
      )}

      {error && (
        <div className="glass p-4 border-red-400/20 bg-red-500/10">
          <div className="text-red-300">❌ {error}</div>
        </div>
      )}

      <div className="glass p-6">
        <h2 className="text-lg font-semibold mb-4 text-white">Controls</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={startAll}
            disabled={startingAll || stoppingAll || swapping}
            className="jarvis-btn bg-green-600/20 hover:bg-green-600/30 border-green-400/20 text-green-300 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2"
          >
            {startingAll ? 'Starting...' : 'Start All'}
          </button>
          
          <button
            onClick={stopAll}
            disabled={startingAll || stoppingAll || swapping}
            className="jarvis-btn bg-red-600/20 hover:bg-red-600/30 border-red-400/20 text-red-300 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2"
          >
            {stoppingAll ? 'Stopping...' : 'Stop All'}
          </button>
          
          <button
            onClick={swapCodespaces}
            disabled={startingAll || stoppingAll || swapping}
            className="jarvis-btn bg-blue-600/20 hover:bg-blue-600/30 border-blue-400/20 text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2"
          >
            {swapping ? 'Swapping...' : 'Swap Codespaces'}
          </button>
          
          <button
            onClick={refreshCodespaces}
            disabled={refreshing}
            className="jarvis-btn bg-purple-600/20 hover:bg-purple-600/30 border-purple-400/20 text-purple-300 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2"
          >
            {refreshing ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="glass p-6">
          <h2 className="text-lg font-semibold mb-4" style={{color: 'var(--jarvis-cyan)'}}>Current Codespaces</h2>
          {codespaces.CurrentCodespaces?.length > 0 ? (
            <div className="space-y-3">
              {codespaces.CurrentCodespaces.map((cs, i) => (
                <div key={i} className="glass p-3 border-green-400/20 bg-green-500/10">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-green-300">{cs.name || cs.display_name || `Codespace ${i + 1}`}</div>
                      <div className="text-sm jarvis-subtle">Status: {cs.state || 'Unknown'}</div>
                      {cs.machine && <div className="text-sm jarvis-subtle">Machine: {cs.machine.name}</div>}
                      {(cs.public_url || cs['Public URL'] || cs.publicUrl || cs.url) && (
                        <div className="mt-2">
                          <div className="text-xs text-gray-400 mb-1">Public URL:</div>
                          <a 
                            href={cs.public_url || cs['Public URL'] || cs.publicUrl || cs.url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-xs text-cyan-300 hover:underline break-all"
                          >
                            {cs.public_url || cs['Public URL'] || cs.publicUrl || cs.url}
                          </a>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => blockCodespace(cs.full_codespace_name || cs.name || cs.display_name)}
                      className="ml-3 px-3 py-1 text-xs bg-red-600/20 hover:bg-red-600/30 border border-red-400/20 text-red-300 rounded disabled:opacity-50"
                      title={me?.role === 'admin' ? 'Block this codespace immediately' : 'Request to block this codespace (requires admin approval)'}
                      disabled={blockingCodespace === (cs.full_codespace_name || cs.name || cs.display_name)}
                    >
                      {blockingCodespace === (cs.full_codespace_name || cs.name || cs.display_name) ? (
                        <span className="flex items-center gap-1">
                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          {me?.role === 'admin' ? 'Blocking...' : 'Requesting...'}
                        </span>
                      ) : (
                        me?.role === 'admin' ? '🚫 Block' : '📝 Request Block'
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="jarvis-subtle italic">No current codespaces found</p>
          )}
        </div>

        <div className={`glass p-6 ${
          backupDataSameAsCurrent 
            ? 'border-orange-400/20 bg-orange-500/10' 
            : ''
        }`}>
          <h2 className={`text-lg font-semibold mb-4 ${
            backupDataSameAsCurrent ? 'text-orange-300' : ''
          }`} style={{color: backupDataSameAsCurrent ? undefined : 'var(--jarvis-blue)'}}>
            Backup Codespaces
          </h2>
          
          {backupDataSameAsCurrent && (
            <div className="mb-4 p-3 glass border-orange-400/30 bg-orange-500/20">
              <div className="text-orange-300 text-sm">⚠️ Backup codespaces appear to be showing current data. Please check your n8n workflow configuration.</div>
            </div>
          )}
          
          {codespaces.BackUpCodespaces?.length > 0 ? (
            <div className="space-y-3">
              {codespaces.BackUpCodespaces.map((cs, i) => (
                <div key={i} className={`glass p-3 ${
                  backupDataSameAsCurrent 
                    ? 'border-orange-400/20 bg-orange-500/10' 
                    : 'border-blue-400/20 bg-blue-500/10'
                }`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className={`font-medium ${
                        backupDataSameAsCurrent ? 'text-orange-300' : 'text-blue-300'
                      }`}>{cs.name || cs.display_name || `Backup Codespace ${i + 1}`}</div>
                      {cs.machine && <div className="text-sm jarvis-subtle">Machine: {cs.machine.name}</div>}
                      {(cs.public_url || cs['Public URL'] || cs.publicUrl || cs.url) && (
                        <div className="mt-2">
                          <div className="text-xs text-gray-400 mb-1">Public URL:</div>
                          <a 
                            href={cs.public_url || cs['Public URL'] || cs.publicUrl || cs.url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-xs text-cyan-300 hover:underline break-all"
                          >
                            {cs.public_url || cs['Public URL'] || cs.publicUrl || cs.url}
                          </a>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => blockCodespace(cs.full_codespace_name || cs.name || cs.display_name)}
                      className="ml-3 px-3 py-1 text-xs bg-red-600/20 hover:bg-red-600/30 border border-red-400/20 text-red-300 rounded disabled:opacity-50"
                      title={me?.role === 'admin' ? 'Block this codespace immediately' : 'Request to block this codespace (requires admin approval)'}
                      disabled={blockingCodespace === (cs.full_codespace_name || cs.name || cs.display_name)}
                    >
                      {blockingCodespace === (cs.full_codespace_name || cs.name || cs.display_name) ? (
                        <span className="flex items-center gap-1">
                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          {me?.role === 'admin' ? 'Blocking...' : 'Requesting...'}
                        </span>
                      ) : (
                        me?.role === 'admin' ? '🚫 Block' : '📝 Request Block'
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="jarvis-subtle italic">No backup codespaces found</p>
          )}
        </div>
      </div>

      {me?.role === 'admin' && (
        <div className="glass p-6">
          <h2 className="text-lg font-semibold mb-4 text-white">Admin: Webhook Configuration</h2>
          
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium mb-1 jarvis-subtle">Production POST URL</label>
              <input
                type="url"
                value={webhookUrls.prodPost}
                onChange={(e) => setWebhookUrls(prev => ({ ...prev, prodPost: e.target.value }))}
                className="jarvis-input"
                placeholder="https://n8n.example.com/webhook/actions"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1 jarvis-subtle">Test POST URL</label>
              <input
                type="url"
                value={webhookUrls.testPost}
                onChange={(e) => setWebhookUrls(prev => ({ ...prev, testPost: e.target.value }))}
                className="jarvis-input"
                placeholder="https://n8n.example.com/webhook-test/actions"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1 jarvis-subtle">Production GET URL</label>
              <input
                type="url"
                value={webhookUrls.prodGet}
                onChange={(e) => setWebhookUrls(prev => ({ ...prev, prodGet: e.target.value }))}
                className="jarvis-input"
                placeholder="https://n8n.example.com/webhook/status"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1 jarvis-subtle">Test GET URL</label>
              <input
                type="url"
                value={webhookUrls.testGet}
                onChange={(e) => setWebhookUrls(prev => ({ ...prev, testGet: e.target.value }))}
                className="jarvis-input"
                placeholder="https://n8n.example.com/webhook-test/status"
              />
            </div>
          </div>
          
          <button
            onClick={saveWebhookUrls}
            disabled={savingWebhook}
            className="jarvis-btn-primary disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2"
          >
            {savingWebhook ? 'Saving...' : savedWebhook ? 'Saved!' : 'Save Webhook URLs'}
          </button>
        </div>
      )}
    </div>
  )
}
