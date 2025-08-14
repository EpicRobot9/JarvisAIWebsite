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
  status: 'idle' | 'recording' | 'transcribing' | 'sending' | 'waitingForReply' | 'speaking'
  lastError: any | null
  messages: ChatMessage[]
}

export function useSession() {
  const [state, set] = useState<SessionState>(() => ({
    sessionId: getOrInit('jarvis_session_id'),
    conversationId: getOrInit('jarvis_conversation_id'),
    inCall: false,
    status: 'idle',
    lastError: null,
    messages: [],
  }))

  useEffect(() => {
    localStorage.setItem('jarvis_session_id', state.sessionId)
    localStorage.setItem('jarvis_conversation_id', state.conversationId)
  }, [state.sessionId, state.conversationId])

  return useMemo(() => ({
    ...state,
    setStatus: (s: SessionState['status']) => set(v => ({ ...v, status: s })),
    setInCall: (b: boolean) => set(v => ({ ...v, inCall: b })),
    setError: (err: any) => set(v => ({ ...v, lastError: err })),
    clearError: () => set(v => ({ ...v, lastError: null })),
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
