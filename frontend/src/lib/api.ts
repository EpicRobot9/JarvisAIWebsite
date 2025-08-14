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

/** Send a chat message directly to an n8n webhook URL.
 * Returns a correlationId and optional immediateText if the webhook replied synchronously.
 */
export async function sendToWebhook(
  text: string,
  opts: { userId: string; webhookUrl: string; callbackUrl: string; source: string; sessionId?: string }
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
        correlationId,
        callbackUrl: opts.callbackUrl,
        source: opts.source,
        sessionId: opts.sessionId
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
    form.append('audio', blob, 'audio.webm')
  const headers: Record<string,string> = {}
  const userOpenAI = localStorage.getItem('user_openai_api_key') || ''
  if (userOpenAI) headers['x-openai-key'] = userOpenAI
  const r = await fetch('/api/stt', { method: 'POST', body: form, credentials: 'include', headers })
    if (!r.ok) throw new AppError('stt_failed', `STT error ${r.status}: ${r.statusText}`, await safeText(r))
    const data = await r.json()
    return { text: data.text || '' }
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e, 'stt_failed')
  }
}

export async function sendToRouter(text: string, session: { userId: string; conversationId?: string; }): Promise<{ reply: string }> {
  try {
    const r = await fetch('/api/router', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: session.userId, userid: session.userId, message: text, conversationId: session.conversationId, mode: 'voice', metadata: { client: 'web' } })
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
  const headers: Record<string,string> = { 'Content-Type': 'application/json' }
  const userEl = localStorage.getItem('user_elevenlabs_api_key') || ''
  if (userEl) headers['x-elevenlabs-key'] = userEl
  const r = await fetch('/api/tts', { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ text }) })
    if (!r.ok) throw new AppError('tts_failed', `TTS error ${r.status}: ${r.statusText}`, await safeText(r))
    return await r.arrayBuffer()
  } catch (e) {
    if (!navigator.onLine) throw new AppError('network_offline', 'You appear to be offline.', e)
    throw AppError.from(e, 'tts_failed')
  }
}

async function safeText(r: Response) {
  try { return await r.text() } catch { return '' }
}
