import { useEffect, useMemo, useState } from 'react'
import { CHAT_INACTIVITY_RESET_MS } from './config'

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

  const [state, set] = useState<SessionState>(() => {
    const sessionId = getOrInit('jarvis_session_id')
    let conversationId = getOrInit('jarvis_conversation_id')
    const { messages, reset } = loadMessagesWithInactivity()
    if (reset) {
      // Start a fresh conversation ID when we drop stale messages
      conversationId = crypto.randomUUID()
      try { localStorage.setItem('jarvis_conversation_id', conversationId) } catch {}
    }
    return {
      sessionId,
      conversationId,
      inCall: false,
      mode: 'chat',
      status: 'idle',
      lastError: null,
      messages,
      // Always start muted on load to avoid accidental TTS usage (ignores any prior saved value)
      muted: true,
    }
  })
  // Persist messages to storage on change
  useEffect(() => {
    try {
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(state.messages))
      // Keep last-activity in sync with most recent message timestamp
      if (state.messages.length) {
        const lastTs = state.messages[state.messages.length - 1]?.timestamp
        const t = Date.parse(lastTs || '')
        if (Number.isFinite(t) && t > 0) {
          localStorage.setItem(LAST_ACTIVITY_KEY, String(t))
        }
      }
    } catch {}
  }, [state.messages])

  // Removed inactivity-based auto-clear of chat history

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
    appendMessage: (m: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => set(v => {
      const nm: ChatMessage = { id: m.id || crypto.randomUUID(), timestamp: m.timestamp || new Date().toISOString(), role: m.role, text: m.text, via: m.via }
      // Update last user-sent timestamp only for user messages
      if (nm.role === 'user') {
        try { localStorage.setItem(LAST_USER_SENT_KEY, String(Date.now())) } catch {}
      }
  // Always update last activity on any message
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())) } catch {}
      const next = { ...v, messages: [...v.messages, nm] }
      try { localStorage.setItem(MESSAGES_KEY, JSON.stringify(next.messages)) } catch {}
      return next
    }),
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

// Storage keys for UI chat messages and last user-sent activity
const MESSAGES_KEY = 'jarvis_ui_messages_v1'
const LAST_USER_SENT_KEY = 'jarvis_ui_lastUserSent_v1'
const LAST_ACTIVITY_KEY = 'jarvis_ui_lastActivity_v1'

function getNum(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key)
    if (v == null) return fallback
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  } catch { return fallback }
}

function loadMessagesWithInactivity(): { messages: ChatMessage[]; reset: boolean } {
  // New behavior: never auto-delete due to inactivity. Preserve all stored messages.
  try {
    let raw = localStorage.getItem(MESSAGES_KEY)
    // Migration from legacy storage if needed
    if (!raw) {
      const legacy = localStorage.getItem('jarvis_chat_v1')
      if (legacy) {
        try {
          const arr = JSON.parse(legacy)
          if (Array.isArray(arr)) {
            const migrated: ChatMessage[] = arr
              .filter((x: any) => x && typeof x === 'object')
              .map((x: any) => ({
                id: typeof x.id === 'string' ? x.id : crypto.randomUUID(),
                role: x.role === 'assistant' || x.role === 'system' ? x.role : 'user',
                text: typeof x.content === 'string' ? x.content : (typeof x.text === 'string' ? x.text : ''),
                timestamp: x.at ? new Date(Number(x.at)).toISOString() : new Date().toISOString(),
                via: undefined,
              }))
              .filter(m => (m.text || '').trim().length > 0)
            if (migrated.length) {
              raw = JSON.stringify(migrated)
              try { localStorage.setItem(MESSAGES_KEY, raw) } catch {}
            }
          }
        } catch {}
      }
    }
    if (!raw) return { messages: [], reset: false }
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return { messages: [], reset: false }
    const messages: ChatMessage[] = arr
      .filter(x => x && typeof x === 'object')
      .map(x => ({
        id: typeof x.id === 'string' ? x.id : crypto.randomUUID(),
        role: x.role === 'assistant' || x.role === 'system' ? x.role : 'user',
        text: typeof x.text === 'string' ? x.text : String(x.text ?? ''),
        timestamp: typeof x.timestamp === 'string' ? x.timestamp : new Date().toISOString(),
        via: x.via === 'typed' || x.via === 'voice' || x.via === 'api' ? x.via : undefined,
      }))
    // Seed last activity for completeness but do not use for auto-delete
    const lastFromMsgs = (() => {
      if (!messages.length) return 0
      const t = Date.parse(messages[messages.length - 1].timestamp || '')
      return Number.isFinite(t) ? t : 0
    })()
    if (lastFromMsgs) {
      try { localStorage.setItem(LAST_ACTIVITY_KEY, String(lastFromMsgs)) } catch {}
    }
    return { messages, reset: false }
  } catch {
    return { messages: [], reset: false }
  }
}
