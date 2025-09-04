import { useState } from 'react'

interface InterstellarUrls {
  prod: { get: string; post: string }
  test: { get: string; post: string }
}

interface Props {
  urls: InterstellarUrls
  onSave: (urls: InterstellarUrls) => Promise<void>
}

export function InterstellarWebhookSection({ urls, onSave }: Props) {
  const [interstellarUrls, setInterstellarUrls] = useState(urls)
  const [savingUrls, setSavingUrls] = useState(false)
  const [savedUrls, setSavedUrls] = useState(false)

  // Determine which environment the UI currently uses. Prefers explicit
  // `interstellar_environment` ('prod'|'test') if set, otherwise falls back
  // to the older boolean flag `interstellar_env_prod` stored as string.
  const getCurrentEnv = () => {
    try {
      const env = localStorage.getItem('interstellar_environment')
      if (env === 'prod' || env === 'test') return env
      const bool = localStorage.getItem('interstellar_env_prod')
      if (bool === 'false') return 'test'
      return 'prod'
    } catch {
      return 'prod'
    }
  }
  const currentEnv = getCurrentEnv()

  async function saveInterstellarUrls() {
    try {
      setSavingUrls(true)
      setSavedUrls(false)
      await onSave(interstellarUrls)
      setSavedUrls(true)
      setTimeout(() => setSavedUrls(false), 1500)
    } catch (e) {
      console.error('Failed to save URLs:', e)
    } finally {
      setSavingUrls(false)
    }
  }

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2 text-cyan-300">Interstellar Webhook URLs</h2>
      <div className="mb-3 text-sm jarvis-subtle">
        Current UI env: <span className="font-mono">{currentEnv}</span>
        <div className="mt-1">
          Active GET: <span className="font-mono">{currentEnv === 'prod' ? interstellarUrls.prod.get || '(none)' : interstellarUrls.test.get || '(none)'}</span>
        </div>
        <div>
          Active POST: <span className="font-mono">{currentEnv === 'prod' ? interstellarUrls.prod.post || '(none)' : interstellarUrls.test.post || '(none)'}</span>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border border-cyan-200/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">Prod GET URL</div>
              <div className="text-xs jarvis-subtle">Used for fetching codespace status in Prod mode.</div>
              <input
                type="url"
                className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                placeholder="https://n8n.example.com/webhook/sheets"
                value={interstellarUrls.prod.get}
                onChange={e=>setInterstellarUrls(v=>({
                  ...v,
                  prod: { ...v.prod, get: e.target.value }
                }))}
              />
            </div>
          </div>
        </div>
        <div className="p-3 rounded-xl border border-cyan-200/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">Prod POST URL</div>
              <div className="text-xs jarvis-subtle">Used for codespace actions in Prod mode.</div>
              <input
                type="url"
                className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                placeholder="https://n8n.example.com/webhook/actions"
                value={interstellarUrls.prod.post}
                onChange={e=>setInterstellarUrls(v=>({
                  ...v,
                  prod: { ...v.prod, post: e.target.value }
                }))}
              />
            </div>
          </div>
        </div>
        <div className="p-3 rounded-xl border border-cyan-200/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">Test GET URL</div>
              <div className="text-xs jarvis-subtle">Used for fetching codespace status in Test mode.</div>
              <input
                type="url"
                className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                placeholder="https://n8n.example.com/webhook-test/sheets"
                value={interstellarUrls.test.get}
                onChange={e=>setInterstellarUrls(v=>({
                  ...v,
                  test: { ...v.test, get: e.target.value }
                }))}
              />
            </div>
          </div>
        </div>
        <div className="p-3 rounded-xl border border-cyan-200/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium">Test POST URL</div>
              <div className="text-xs jarvis-subtle">Used for codespace actions in Test mode.</div>
              <input
                type="url"
                className="mt-2 w-full px-2 py-1 rounded bg-black/20 border border-cyan-200/20 font-mono text-xs"
                placeholder="https://n8n.example.com/webhook-test/actions"
                value={interstellarUrls.test.post}
                onChange={e=>setInterstellarUrls(v=>({
                  ...v,
                  test: { ...v.test, post: e.target.value }
                }))}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="px-3 py-1 rounded-xl border border-cyan-200/20 disabled:opacity-50"
          disabled={savingUrls}
          onClick={saveInterstellarUrls}>
          Save URLs
        </button>
        {savingUrls && <span className="text-xs jarvis-subtle">Saving…</span>}
        {savedUrls && <span className="text-xs text-green-400">Saved</span>}
      </div>
    </div>
  )
}
