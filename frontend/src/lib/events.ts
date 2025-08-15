import { useEffect } from 'react'

type ServerEvent =
  | { type: 'hello'; sessionId: string }
  | { type: 'push'; text: string; role?: 'assistant' | 'system'; say?: boolean }
  | { type: 'push-voice'; text: string }
  | { type: 'call-end'; reason?: string }

export function useEventChannel(sessionId: string, userId: string | undefined, opts: {
  onPush: (ev: Extract<ServerEvent, { type: 'push' }>) => void
  onCallEnd: (ev: Extract<ServerEvent, { type: 'call-end' }>) => void
  setSpeaking: (speaking: boolean) => void
  onSpeak?: (text: string, o?: { forceStream?: boolean }) => Promise<void>
}) {
  useEffect(() => {
    if (!sessionId) return
    let closed = false
    let ws: WebSocket | null = null
    let es: EventSource | null = null

  const base = `/api/events?sessionId=${encodeURIComponent(sessionId)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + base)
      ws.onmessage = async (msg) => {
        if (!msg.data) return
        const ev: ServerEvent = JSON.parse(String(msg.data))
        await handle(ev)
      }
      ws.onclose = () => {
        if (!closed) startSSE()
      }
    } catch {
      startSSE()
    }

    function startSSE() {
  es = new EventSource(base, { withCredentials: true })
      es.onmessage = async (e) => {
        const ev: ServerEvent = JSON.parse(e.data)
        await handle(ev)
      }
    }

    async function handle(ev: ServerEvent) {
      if (ev.type === 'push') {
        opts.onPush(ev)
        if (ev.say && opts.onSpeak) {
          try { opts.setSpeaking(true); await opts.onSpeak(ev.text) } finally { opts.setSpeaking(false) }
        }
      } else if (ev.type === 'push-voice') {
        // Show in chat and speak via streaming regardless of current mode
        const asPush = { type: 'push' as const, text: ev.text, role: 'assistant' as const, say: true }
        opts.onPush(asPush)
        if (opts.onSpeak) {
          try { opts.setSpeaking(true); await opts.onSpeak(ev.text, { forceStream: true }) } finally { opts.setSpeaking(false) }
        }
      } else if (ev.type === 'call-end') {
        opts.onCallEnd(ev)
      }
    }

    return () => {
      closed = true
      try { ws?.close() } catch {}
      try { es?.close() } catch {}
    }
  }, [sessionId, userId])
}
