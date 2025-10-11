import { useEffect, useState } from 'react'
import { PROD_WEBHOOK_URL, TEST_WEBHOOK_URL } from '../lib/config'

/**
 * Resolve webhook URLs (prod/test) with caching.
 * Returns cached values immediately if present, then refreshes from /api/webhook-urls.
 */
export function useResolvedWebhookUrls(useTest: boolean | undefined) {
  const [urls, setUrls] = useState<{ prod: string; test: string }>({ prod: '', test: '' })
  const currentWebhookUrl = useTest ? (urls.test || TEST_WEBHOOK_URL) : (urls.prod || PROD_WEBHOOK_URL)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const cached = {
          prod: localStorage.getItem('jarvis_webhook_prod') || '',
          test: localStorage.getItem('jarvis_webhook_test') || ''
        }
        if ((cached.prod || cached.test) && mounted) setUrls(cached)
        const r = await fetch('/api/webhook-urls', { cache: 'no-store' }).catch(() => null)
        if (r?.ok) {
          const data = await r.json()
          if (!mounted) return
          setUrls({ prod: data.prod || '', test: data.test || '' })
          try {
            localStorage.setItem('jarvis_webhook_prod', data.prod || '')
            localStorage.setItem('jarvis_webhook_test', data.test || '')
          } catch {}
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  return { urls, currentWebhookUrl }
}
