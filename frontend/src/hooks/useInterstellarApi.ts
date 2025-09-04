import { useState, useEffect } from 'react'
import { storage } from '../lib/storage'

interface CodespaceInfo {
  row_number: number
  display_name: string
  full_codespace_name: string
  repository: string
  start_url: string
  stop_url: string
  public_url: string  // Normalized from "Public URL"
}

interface CodespaceData {
  CurrentCodespaces: CodespaceInfo[]
  BackUpCodespaces: CodespaceInfo[]
}

export function useInterstellarApi() {
  const [isProd, setIsProd] = useState(() => storage.get('interstellar_env_prod', true))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<CodespaceData | null>(null)

  // Update persisted env whenever it changes
  useEffect(() => {
    storage.set('interstellar_env_prod', isProd)
  }, [isProd])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      // Use the backend proxy instead of calling the webhook directly
      const env = isProd ? 'prod' : 'test'
      const r = await fetch(`/api/interstellar/get-codespaces?env=${env}`, {
        method: 'GET',
        credentials: 'include'
      })
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        if (errorData.error === 'get_url_not_configured') {
          throw new Error('❌ Error: Webhook URLs not configured. Please contact an administrator.')
        }
        throw new Error(`Failed to load codespaces: ${r.status}`)
      }
      const json = await r.json()
      if (!Array.isArray(json) || !json[0]) {
        throw new Error('Invalid response format')
      }
      // The backend already normalizes the data for us
      const data = json[0] as CodespaceData
      setData(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function execAction(action: { TypeOfAction: string; BlockedCodespaceFullName?: string }) {
    try {
      const env = isProd ? 'prod' : 'test'
      const r = await fetch('/api/interstellar/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: action.TypeOfAction, env })
      })
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}))
        if (errorData.error === 'post_url_not_configured') {
          throw new Error('❌ Error: Webhook URLs not configured. Please contact an administrator.')
        }
        throw new Error(`Action failed: ${r.status}`)
      }
      const json = await r.json()
      if (!json.ok) {
        throw new Error('Operation failed')
      }
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  return {
    isProd,
    setIsProd,
    loading,
    error,
    data,
    fetchData,
    execAction
  }
}
