import { useCallback, useEffect, useRef, useState } from 'react'

export type StreamState = 'disconnected' | 'connecting' | 'connected'

export function useStreamingCall() {
  const wsRef = useRef<WebSocket | null>(null)
  const [state, setState] = useState<StreamState>('disconnected')
  const [partials, setPartials] = useState<string>('')
  const [finals, setFinals] = useState<string[]>([])

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/ws/stream`
    const ws = new WebSocket(url)
    wsRef.current = ws
    setState('connecting')
    ws.addEventListener('open', () => setState('connected'))
    ws.addEventListener('close', () => { setState('disconnected'); wsRef.current = null })
    ws.addEventListener('error', () => { setState('disconnected'); wsRef.current = null })
    ws.addEventListener('message', (ev) => {
      try {
        const data = JSON.parse(String(ev.data))
        if (data?.type === 'partial') {
          setPartials(p => (p ? p + ' ' : '') + String(data.text || ''))
        } else if (data?.type === 'final') {
          const txt = String(data.text || '')
          setFinals(arr => arr.concat([txt]))
          setPartials('')
        }
      } catch {}
    })
  }, [])

  const disconnect = useCallback(() => {
    try { wsRef.current?.close() } catch {}
    wsRef.current = null
    setState('disconnected')
  }, [])

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try { ws.send(JSON.stringify({ type: 'text', text })) } catch {}
  }, [])

  useEffect(() => () => { try { wsRef.current?.close() } catch {} }, [])

  return { state, partials, finals, connect, disconnect, sendText }
}
