/** Centralized API helpers and error model for the Jarvis UI. */

export type AppErrorKind =
  | 'mic_denied'
  | 'record_failed'
  | 'stt_failed'
  | 'router_failed'
  | 'tts_failed'
  | 'play_failed'
  | 'network_offline'
  | 'unknown'

export class AppError extends Error {
  kind: AppErrorKind
  detail?: any
  errorId: string
  constructor(kind: AppErrorKind, message: string, detail?: any) {
    super(message)
    this.name = 'AppError'
    this.kind = kind
    this.detail = detail
    this.errorId = crypto.randomUUID()
  }
  static from(e: unknown, fallback: AppErrorKind = 'unknown'): AppError {
    if (e instanceof AppError) return e
    const msg = e instanceof Error ? e.message : String(e)
    return new AppError(fallback, msg, e)
  }
}

// =========================
// Jarvis Notes: Types/Shapes
// =========================
export type NotesPrefs = {
  instructions: string
  collapsible: boolean
  categories: boolean
  // Optional UI prefs stored with settings
  icon?: 'triangle' | 'chevron' | 'plusminus'
  color?: 'slate' | 'blue' | 'emerald' | 'amber' | 'rose'
  expandAll?: boolean
  expandCategories?: boolean
}

export type NoteItem = {
  id: string
  transcript: string
  notes: string
  title?: string
  pinned?: boolean
  createdAt: string
}

/** Send a chat message directly to an n8n webhook URL.
 * Returns a correlationId and optional immediateText if the webhook replied synchronously.
 */
export async function sendToWebhook(
  text: string,
  opts: { userId: string; webhookUrl: string; callbackUrl: string; source: string; sessionId?: string; messageType?: 'TextMessage' | 'CallMessage' }
): Promise<{ correlationId: string; immediateText?: string }> {
  const correlationId = crypto.randomUUID()
  let res: Response
  try {
    res = await fetch(opts.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': localStorage.getItem('jarvis_apikey') || ''
      },
      body: JSON.stringify({
        chatInput: text,
        userid: opts.userId || 'anon',
        username: (localStorage.getItem('user_name') || '').trim() || undefined,
        correlationId,
        callbackUrl: opts.callbackUrl,
        source: opts.source,
  sessionId: opts.sessionId,
  messageType: opts.messageType || 'TextMessage'
      })
    })
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw new AppError('router_failed', `Error contacting webhook: ${String(e)}`, e)
  }

  // Parse immediate response (if any). Webhook might respond with JSON or plain text.
  let immediateText = ''
  if (res.ok) {
    try {
      const bodyTxt = await res.text()
      if (bodyTxt) {
        try {
          const data = JSON.parse(bodyTxt)
          if (Array.isArray(data)) {
            const parts = data
              .map(d => {
                if (!d) return ''
                if (typeof d === 'string') return d
                if (typeof d === 'object') return (d as any).output || (d as any).result || (d as any).text || ''
                return ''
              })
              .filter(Boolean)
            immediateText = parts.join('\n\n') || (data.length ? JSON.stringify(data) : '')
          } else if (typeof data === 'object') {
            if ((data as any).error) immediateText = `Error: ${(data as any).error}`
            else immediateText = (data as any).result || (data as any).output || (data as any).text || ''
          } else if (typeof data === 'string') {
            immediateText = data
          }
        } catch {
          // Not JSON; treat as plain text
          immediateText = bodyTxt
        }
      }
    } catch {}
    return { correlationId, immediateText: immediateText || undefined }
  } else {
    let bodyText = ''
    try { bodyText = await res.text() } catch {}
    throw new AppError('router_failed', `Webhook error ${res.status}: ${bodyText || res.statusText}`)
  }
}

export async function transcribeAudio(blob: Blob): Promise<{ text: string }> {
  try {
    const form = new FormData()
    // Field name must be 'audio' for /api/stt
    form.append('audio', blob, 'audio.webm')
    const headers: Record<string,string> = {}
    const userOpenAI = localStorage.getItem('user_openai_api_key') || ''
    if (userOpenAI) headers['x-openai-key'] = userOpenAI

    // Client-side timeout to avoid hanging forever (default 15s; tunable via localStorage)
    const timeoutMsRaw = Number(localStorage.getItem('ux_stt_timeout_ms') || '15000')
    const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(5000, Math.min(60000, timeoutMsRaw)) : 15000
    const controller = new AbortController()
    const t = setTimeout(() => { try { controller.abort() } catch {} }, timeoutMs)
    let r: Response
    try {
      r = await fetch('/api/stt', { method: 'POST', body: form, credentials: 'include', headers, signal: controller.signal })
    } finally {
      clearTimeout(t)
    }
    if (!r.ok) {
      const body = await safeText(r)
      // Surface a clearer message for gateway timeouts
      const msg = r.status === 504 ? `STT timeout (${r.status})` : `STT error ${r.status}: ${r.statusText}`
      throw new AppError('stt_failed', msg, body)
    }
    const data = await r.json()
    return { text: data.text || '' }
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    // If aborted due to timeout, provide a friendly error
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new AppError('stt_failed', 'STT timeout', e)
    }
    throw AppError.from(e, 'stt_failed')
  }
}

// =========================
// Jarvis Notes: API helpers
// =========================
export async function summarizeTranscript(text: string, prefs?: Partial<NotesPrefs>): Promise<{ notes: string }> {
  try {
    const headers: Record<string,string> = { 'Content-Type': 'application/json' }
    const userOpenAI = (localStorage.getItem('user_openai_api_key') || '').trim()
    if (userOpenAI) headers['x-openai-key'] = userOpenAI
    const body: any = { text }
    if (prefs) {
      if (typeof prefs.instructions === 'string') body.instructions = prefs.instructions
      if (typeof prefs.collapsible === 'boolean') body.collapsible = prefs.collapsible
      if (typeof prefs.categories === 'boolean') body.categories = prefs.categories
    }
    const r = await fetch('/api/notes/summarize', { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) })
    if (!r.ok) throw new AppError('router_failed', `Summarize failed ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return { notes: data.notes || '' }
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function createNote(payload: { transcript: string; notes: string; title?: string; pinned?: boolean }): Promise<NoteItem> {
  try {
    const r = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
    if (!r.ok) throw new AppError('router_failed', `Create note failed ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return data.note as NoteItem
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function listNotes(opts: { query?: string; take?: number; cursor?: string; pinned?: boolean }): Promise<{ items: NoteItem[]; nextCursor: string | null }> {
  try {
    const params = new URLSearchParams()
    if (opts.query) params.set('query', opts.query)
    if (opts.take != null) params.set('take', String(opts.take))
    if (opts.cursor) params.set('cursor', opts.cursor)
    if (typeof opts.pinned === 'boolean') params.set('pinned', String(opts.pinned))
    const r = await fetch(`/api/notes?${params.toString()}`, { credentials: 'include' })
    if (!r.ok) throw new AppError('router_failed', `List notes failed ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return { items: data.items || [], nextCursor: data.nextCursor ?? null }
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function updateNote(id: string, patch: Partial<Pick<NoteItem, 'transcript' | 'notes' | 'title' | 'pinned'>>): Promise<NoteItem> {
  try {
    const r = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patch)
    })
    if (!r.ok) throw new AppError('router_failed', `Update note failed ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return data.note as NoteItem
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function deleteNote(id: string): Promise<void> {
  try {
    const r = await fetch(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new AppError('router_failed', `Delete note failed ${r.status}: ${r.statusText}`, await safeText(r))
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function clearNotes(): Promise<void> {
  try {
    const r = await fetch('/api/notes', { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new AppError('router_failed', `Clear notes failed ${r.status}: ${r.statusText}`, await safeText(r))
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function getNotesSettings(): Promise<NotesPrefs> {
  try {
    const r = await fetch('/api/notes/settings', { credentials: 'include' })
    if (!r.ok) throw new AppError('router_failed', `Settings read failed ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    // Provide defaults when backend fields are missing
    return {
      instructions: data.instructions || '',
      collapsible: typeof data.collapsible === 'boolean' ? data.collapsible : true,
      categories: typeof data.categories === 'boolean' ? data.categories : true,
      icon: data.icon || 'triangle',
      color: data.color || 'slate',
      expandAll: Boolean(data.expandAll),
      expandCategories: Boolean(data.expandCategories)
    }
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

// =========================
// Study Tools: API helpers
// =========================
export type StudyToolsRequested = Array<'guide' | 'flashcards' | 'test' | 'match'>
export type Flashcard = { front: string; back: string }
export type McqQuestion = { question: string; choices: string[]; answerIndex: number }
export type MatchPair = { left: string; right: string }
export type StudySet = {
  id: string
  title: string
  subject?: string
  sourceText?: string
  tools: string[]
  linkedNoteIds: string[]
  content: { guide?: string; flashcards?: Flashcard[]; test?: McqQuestion[]; match?: MatchPair[] }
  createdAt: string
}

export async function generateStudySet(payload: { subject?: string; info?: string; noteIds?: string[]; tools?: StudyToolsRequested; title?: string }): Promise<StudySet> {
  try {
    const headers: Record<string,string> = { 'Content-Type': 'application/json' }
    const userOpenAI = (localStorage.getItem('user_openai_api_key') || '').trim()
    if (userOpenAI) headers['x-openai-key'] = userOpenAI
    const r = await fetch('/api/study/generate', { method: 'POST', headers, credentials: 'include', body: JSON.stringify(payload) })
    if (!r.ok) throw new AppError('router_failed', `Study generate failed ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return data.set as StudySet
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function listStudySets(opts: { take?: number; cursor?: string } = {}): Promise<{ items: StudySet[]; nextCursor: string | null }> {
  try {
    const params = new URLSearchParams()
    if (opts.take) params.set('take', String(opts.take))
    if (opts.cursor) params.set('cursor', opts.cursor)
    const r = await fetch(`/api/study/sets?${params.toString()}`, { credentials: 'include' })
    if (!r.ok) throw new AppError('router_failed', `Study list failed ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return { items: (data.items || []) as StudySet[], nextCursor: data.nextCursor ?? null }
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function getStudySet(id: string): Promise<StudySet> {
  try {
    const r = await fetch(`/api/study/sets/${encodeURIComponent(id)}`, { credentials: 'include' })
    if (!r.ok) throw new AppError('router_failed', `Study read failed ${r.status}: ${r.statusText}`, await safeText(r))
    return await r.json()
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function deleteStudySet(id: string): Promise<void> {
  try {
    const r = await fetch(`/api/study/sets/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new AppError('router_failed', `Study delete failed ${r.status}: ${r.statusText}`, await safeText(r))
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function gradeFlashcard(input: { front: string; expectedBack: string; userAnswer: string }): Promise<{ correct: boolean; explanation?: string }> {
  try {
    const headers: Record<string,string> = { 'Content-Type': 'application/json' }
    const userOpenAI = (localStorage.getItem('user_openai_api_key') || '').trim()
    if (userOpenAI) headers['x-openai-key'] = userOpenAI
    const r = await fetch('/api/study/grade', { method: 'POST', headers, credentials: 'include', body: JSON.stringify(input) })
    if (!r.ok) throw new AppError('router_failed', `Grade failed ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return { correct: Boolean(data.correct), explanation: data.explanation || '' }
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function saveNotesSettings(prefs: NotesPrefs): Promise<void> {
  try {
    const r = await fetch('/api/notes/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(prefs)
    })
    if (!r.ok) throw new AppError('router_failed', `Settings save failed ${r.status}: ${r.statusText}`, await safeText(r))
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e)
  }
}

export async function sendToRouter(text: string, session: { userId: string; conversationId?: string; }): Promise<{ reply: string }> {
  try {
    const r = await fetch('/api/router', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        userId: session.userId,
        userid: session.userId,
        username: (localStorage.getItem('user_name') || '').trim() || undefined,
        message: text,
        conversationId: session.conversationId,
        mode: 'voice',
        metadata: { client: 'web' }
      })
    })
    if (!r.ok) throw new AppError('router_failed', `Router error ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return { reply: data.reply || '' }
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e, 'router_failed')
  }
}

export async function synthesizeTTS(text: string): Promise<ArrayBuffer> {
  try {
    // Try Eleven Labs first
    const headers: Record<string,string> = { 'Content-Type': 'application/json' }
    const clean = sanitizeForTTS(text)
    const userEl = localStorage.getItem('user_elevenlabs_api_key') || ''
    if (userEl) {
      headers['x-elevenlabs-key'] = userEl
      const vid = (localStorage.getItem('user_elevenlabs_voice_id') || '').trim()
      if (vid) headers['x-elevenlabs-voice-id'] = vid
    }
    const r = await fetch('/api/tts', { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ text: clean }) })
    if (!r.ok) {
      const engine = (localStorage.getItem('ux_fallback_engine') || 'webspeech').trim()
      const tryOss = async (): Promise<ArrayBuffer | null> => {
        try {
          const headers: Record<string,string> = { 'Content-Type': 'application/json' }
          const body = {
            text: clean,
            voice: localStorage.getItem('ux_oss_tts_voice') || 'en-US',
            rate: Number(localStorage.getItem('ux_oss_tts_rate') || '0.85')
          }
          const rr = await fetch('/api/tts/fallback', { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) })
          if (rr.ok) return await rr.arrayBuffer()
        } catch (e) {
          console.warn('Server fallback TTS failed:', e)
        }
        return null
      }
      const tryWeb = async (): Promise<ArrayBuffer> => {
        return await synthesizeTTSWebSpeech(text)
      }

      if (engine === 'oss') {
        const buf = await tryOss()
        if (buf) return buf
        return await tryWeb()
      } else if (engine === 'auto') {
        const buf = await tryOss()
        if (buf) return buf
        return await tryWeb()
      } else {
        // default: webspeech
        return await tryWeb()
      }
    }
    return await r.arrayBuffer()
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    
    // If there was an error (network, key missing, etc), route based on engine
    const engine = (localStorage.getItem('ux_fallback_engine') || 'webspeech').trim()
    const tryOss = async (): Promise<ArrayBuffer | null> => {
      try {
        const headers: Record<string,string> = { 'Content-Type': 'application/json' }
        const body = {
          text: sanitizeForTTS(text),
          voice: localStorage.getItem('ux_oss_tts_voice') || 'en-US',
          rate: Number(localStorage.getItem('ux_oss_tts_rate') || '0.85')
        }
        const rr = await fetch('/api/tts/fallback', { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) })
        if (rr.ok) return await rr.arrayBuffer()
      } catch (err) {
        console.warn('Server fallback also failed:', err)
      }
      return null
    }
    const tryWeb = async (): Promise<ArrayBuffer> => await synthesizeTTSWebSpeech(text)

    if (engine === 'oss') {
      const buf = await tryOss()
      if (buf) return buf
      return await tryWeb()
    } else if (engine === 'auto') {
      const buf = await tryOss()
      if (buf) return buf
      return await tryWeb()
    } else {
      return await tryWeb()
    }
  }
}

async function safeText(r: Response) {
  try { return await r.text() } catch { return '' }
}

/** Build a streaming TTS URL for low-latency playback. */
export function getTtsStreamUrl(text: string): string {
  const params = new URLSearchParams()
  params.set('text', sanitizeForTTS(text))
  const userEl = (localStorage.getItem('user_elevenlabs_api_key') || '').trim()
  if (userEl) {
    params.set('key', userEl)
    const vid = (localStorage.getItem('user_elevenlabs_voice_id') || '').trim()
    if (vid) params.set('voiceId', vid)
  }
  // Lower initial chunk latency; 2 is a good balance of quality/latency
  params.set('opt', '2')
  return `/api/tts/stream?${params.toString()}`
}

/**
 * Fallback TTS using Web Speech API.
 * NOTE: This function does NOT play audio directly. It returns an empty buffer to signal
 * to the caller that it should invoke speakWithWebSpeech(text) itself (ideally in whatever
 * playback/queue flow it is using). This avoids double-speaking and lets callers control
 * sequencing.
 */
export async function synthesizeTTSWebSpeech(text: string): Promise<ArrayBuffer> {
  // Do not speak here—let the caller decide when/how to invoke Web Speech.
  // We still sanitize to keep behavior consistent with server TTS paths.
  void sanitizeForTTS(text)
  return new ArrayBuffer(0)
}

/** Remove code blocks and inline code before sending to TTS to avoid reading code and save tokens. */
function sanitizeForTTS(text: string): string {
  try {
    let t = (text || '').toString()
    // Remove fenced code blocks ```...``` and ~~~...~~~
    t = t.replace(/```[\s\S]*?```/g, ' [code omitted] ')
    t = t.replace(/~~~[\s\S]*?~~~/g, ' [code omitted] ')
    // Remove inline code `...`
    t = t.replace(/`[^`]*`/g, ' [code] ')
    // Collapse whitespace
    t = t.replace(/\n{3,}/g, '\n\n').replace(/[\t ]{2,}/g, ' ').trim()
    if (!t) t = 'Response contains code only; see chat for details.'
    // Cap length to keep TTS short
    const MAX = 1200
    if (t.length > MAX) t = t.slice(0, MAX) + '…'
    return t
  } catch {
    return text
  }
}
