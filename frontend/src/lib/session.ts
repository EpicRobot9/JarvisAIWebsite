import { useEffect, useMemo, useState } from 'react'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: string
  via?: 'typed' | 'voice' | 'api'
}

export type SessionState = {
  sessionId: string
  conversationId: string
  inCall: boolean
  /** UI mode state machine */
  mode: 'chat' | 'call' | 'connecting'
  status: 'idle' | 'recording' | 'transcribing' | 'sending' | 'waitingForReply' | 'speaking'
  lastError: any | null
  messages: ChatMessage[]
  muted: boolean
}

export function useSession() {
  // Force default muted=true on every load (prevents accidental TTS usage after refresh)
  try { localStorage.setItem('jarvis_muted', JSON.stringify(true)) } catch {}

  const [state, set] = useState<SessionState>(() => ({
    sessionId: getOrInit('jarvis_session_id'),
    conversationId: getOrInit('jarvis_conversation_id'),
    inCall: false,
    mode: 'chat',
    status: 'idle',
    lastError: null,
    messages: [],
  // Always start muted on load to avoid accidental TTS usage (ignores any prior saved value)
  muted: true,
  }))

  useEffect(() => {
    localStorage.setItem('jarvis_session_id', state.sessionId)
    localStorage.setItem('jarvis_conversation_id', state.conversationId)
    try { localStorage.setItem('jarvis_muted', JSON.stringify(state.muted)) } catch {}
  }, [state.sessionId, state.conversationId])
  
  useEffect(() => {
    try { localStorage.setItem('jarvis_muted', JSON.stringify(state.muted)) } catch {}
  }, [state.muted])

  return useMemo(() => ({
    ...state,
    setStatus: (s: SessionState['status']) => set(v => ({ ...v, status: s })),
    setInCall: (b: boolean) => set(v => ({ ...v, inCall: b })),
  setMode: (m: SessionState['mode']) => set(v => ({ ...v, mode: m })),
    setError: (err: any) => set(v => ({ ...v, lastError: err })),
    clearError: () => set(v => ({ ...v, lastError: null })),
    setMuted: (b: boolean) => set(v => ({ ...v, muted: b })),
    appendMessage: (m: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => set(v => ({
      ...v,
      messages: [...v.messages, { id: m.id || crypto.randomUUID(), timestamp: m.timestamp || new Date().toISOString(), role: m.role, text: m.text, via: m.via }],
    })),
  }), [state])
}

function getOrInit(key: string) {
  let v = localStorage.getItem(key)
  if (!v) { v = crypto.randomUUID(); localStorage.setItem(key, v) }
  return v
}

function getBool(key: string, fallback: boolean) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
