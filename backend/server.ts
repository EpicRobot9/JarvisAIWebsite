import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import rateLimit from 'express-rate-limit'
import { OpenAI } from 'openai'
import { toFile } from 'openai/uploads'
import fetch from 'node-fetch'
import { z } from 'zod'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'

dotenv.config()

const app = express()
const prisma = new PrismaClient()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
const SESSION_COOKIE = 'jarvis_sid'

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser(process.env.SESSION_SECRET || ''))
// Trust reverse proxy (nginx) so rate-limit sees the correct client IP
app.set('trust proxy', 1)

// Simple in-memory callback store
const callbacks = new Map<string, any>()

// Session middleware
async function sessionMiddleware(req: any, res: any, next: any) {
  const sid = req.signedCookies?.[SESSION_COOKIE]
  if (!sid) return next()
  const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } })
  if (!session || session.expiresAt < new Date()) return next()
  req.user = session.user
  req.session = session
  next()
}
app.use(sessionMiddleware)

// Env validation
const EnvSchema = z.object({
  FRONTEND_ORIGIN: z.string().optional(),
  SESSION_SECRET: z.string().min(1, 'SESSION_SECRET is required'),
  BACKEND_PORT: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  TRANSCRIBE_MODEL: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  N8N_WEBHOOK_URL: z.string().url().optional(),
  APP_URL: z.string().url().optional(),
})
const envParse = EnvSchema.safeParse(process.env)
if (!envParse.success) {
  console.error('Environment validation failed:', envParse.error.flatten().fieldErrors)
  // Fail fast in production to avoid insecure defaults
  if (process.env.NODE_ENV === 'production') {
    process.exit(1)
  }
}

// Simple in-memory pub/sub keyed by sessionId with WS + SSE transport
type EventPayload =
  | { type: 'push'; text: string; role?: 'assistant' | 'system'; say?: boolean }
  | { type: 'push-voice'; text: string }
  | { type: 'call-end'; reason?: string }

const subscribers = new Map<string, Set<{ kind: 'ws' | 'sse'; send: (data: string) => void; end?: () => void }>>()
function publish(sessionId: string, payload: EventPayload) {
  const subs = subscribers.get(sessionId)
  if (!subs) return
  const msg = JSON.stringify(payload)
  for (const s of subs) {
    try { s.send(msg) } catch { /* noop */ }
  }
}
function subscribe(sessionId: string, sub: { kind: 'ws' | 'sse'; send: (data: string) => void; end?: () => void }) {
  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set())
  subscribers.get(sessionId)!.add(sub)
  return () => {
    const set = subscribers.get(sessionId)
    if (set) {
      set.delete(sub)
      if (set.size === 0) subscribers.delete(sessionId)
    }
    try { sub.end?.() } catch {}
  }
}

// Helpers
function requireAuth(req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' })
  if (req.user.status !== 'active') return res.status(403).json({ error: 'not_active' })
  next()
}
function requireAdmin(req: any, res: any, next: any) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  next()
}

// Rate limit auth
const authLimiter = rateLimit({ windowMs: 60_000, max: 30 })

// Auth routes
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' })
    if (process.env.LOCK_NEW_ACCOUNTS === 'true') return res.status(403).json({ error: 'locked' })
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(409).json({ error: 'exists' })
    const passwordHash = await bcrypt.hash(password, 10)

  let status: 'active' | 'pending' | 'denied' = 'active'
  if (process.env.REQUIRE_ADMIN_APPROVAL === 'true') status = 'pending'

  const role: 'admin' | 'user' = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).includes(email) ? 'admin' : 'user'

    const user = await prisma.user.create({ data: { email, passwordHash, role, status } })
    if (status === 'pending') {
      await prisma.approval.create({ data: { userId: user.id } })
    }
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: 'server_error' })
  }
})

app.post('/api/auth/signin', authLimiter, async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' })
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(401).json({ error: 'invalid' })
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return res.status(401).json({ error: 'invalid' })
  if (user.status !== 'active') return res.status(403).json({ error: user.status })

  const sid = randomUUID()
  const hours = 24 * 7
  const expiresAt = new Date(Date.now() + hours * 3600_000)
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt } })
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    signed: true,
    expires: expiresAt,
    path: '/',
  })
  return res.json({ id: user.id, email: user.email, role: user.role, status: user.status })
})

app.post('/api/auth/signout', requireAuth, async (req: any, res) => {
  if (req.session) await prisma.session.delete({ where: { id: req.session.id } }).catch(() => {})
  res.clearCookie(SESSION_COOKIE)
  res.json({ ok: true })
})

app.get('/api/auth/me', async (req: any, res) => {
  if (!req.user) return res.json(null)
  const { id, email, role, status } = req.user
  res.json({ id, email, role, status })
})

// Admin routes
app.get('/api/admin/pending', requireAuth, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({ where: { status: 'pending' }, select: { id: true, email: true } })
  res.json(users)
})
app.post('/api/admin/approve', requireAuth, requireAdmin, async (req: any, res) => {
  const { userId } = req.body || {}
  const user = await prisma.user.update({ where: { id: userId }, data: { status: 'active' } })
  await prisma.approval.updateMany({ where: { userId }, data: { status: 'approved', decidedById: req.user.id, decidedAt: new Date() } })
  res.json({ ok: true, user: { id: user.id, status: user.status } })
})
app.post('/api/admin/deny', requireAuth, requireAdmin, async (req: any, res) => {
  const { userId } = req.body || {}
  const user = await prisma.user.update({ where: { id: userId }, data: { status: 'denied' } })
  await prisma.approval.updateMany({ where: { userId }, data: { status: 'denied', decidedById: req.user.id, decidedAt: new Date() } })
  res.json({ ok: true, user: { id: user.id, status: user.status } })
})

// Admin: users listing
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, status: true, createdAt: true }
  })
  res.json(users)
})

// Admin: change role (user/admin)
app.post('/api/admin/set-role', requireAuth, requireAdmin, async (req: any, res) => {
  const { userId, role } = req.body || {}
  if (!userId || (role !== 'admin' && role !== 'user')) return res.status(400).json({ error: 'invalid_body' })
  // Optional: prevent demoting the last admin (not implemented here)
  const user = await prisma.user.update({ where: { id: userId }, data: { role } })
  res.json({ ok: true, user: { id: user.id, role: user.role } })
})

// Admin: delete user and related data
app.post('/api/admin/delete', requireAuth, requireAdmin, async (req: any, res) => {
  const { userId } = req.body || {}
  if (!userId) return res.status(400).json({ error: 'invalid_body' })
  if (userId === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' })
  await prisma.session.deleteMany({ where: { userId } }).catch(()=>{})
  await prisma.approval.deleteMany({ where: { userId } }).catch(()=>{})
  await prisma.user.delete({ where: { id: userId } })
  res.json({ ok: true })
})

// Admin: reset password
app.post('/api/admin/reset-password', requireAuth, requireAdmin, async (req: any, res) => {
  const { userId, newPassword } = req.body || {}
  if (!userId || typeof newPassword !== 'string' || newPassword.length < 6) return res.status(400).json({ error: 'invalid_body' })
  const passwordHash = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } })
  // Invalidate sessions
  await prisma.session.deleteMany({ where: { userId } }).catch(()=>{})
  res.json({ ok: true })
})

// Transcription route
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
app.post('/api/transcribe', requireAuth, upload.single('file'), async (req: any, res) => {
  try {
    const file = req.file
    const correlationId = req.body.correlationId
    if (!file || !correlationId) return res.status(400).json({ error: 'missing_fields' })

    // Use Whisper or gpt-4o-mini-transcribe
    const mode = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'
    const transcript = await openai.audio.transcriptions.create({
      file: await toFile(Buffer.from(file.buffer), file.originalname, { type: file.mimetype }),
      model: mode,
    })

    const text = (transcript as any).text || ''
    res.json({ text, correlationId })
  } catch (e) {
    res.status(500).json({ error: 'transcription_failed' })
  }
})

// New STT endpoint for frontend modular API: /api/stt
app.post('/api/stt', requireAuth, upload.single('audio'), async (req: any, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'missing_audio' })
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    if (!process.env.OPENAI_API_KEY && !headerKey) return res.status(400).json({ error: 'stt_not_configured' })

  const preferred = (process.env.TRANSCRIBE_MODEL || process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe').trim()
    // Provide a resilient fallback order
    const candidates = Array.from(new Set([
      preferred,
      preferred === 'whisper-1' ? 'gpt-4o-mini-transcribe' : 'whisper-1',
    ]))

    const oa = headerKey ? new OpenAI({ apiKey: headerKey }) : openai
    const fileInput = await toFile(Buffer.from(file.buffer), file.originalname || 'audio.webm', { type: file.mimetype || 'audio/webm' })

    let lastErr: any = null
    for (const model of candidates) {
      try {
        const transcript = await oa.audio.transcriptions.create({ file: fileInput, model })
        const text = (transcript as any).text || ''
        return res.json({ text, model })
      } catch (e) {
        lastErr = e
        // Try next candidate
      }
    }
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
    res.status(502).json({ error: 'stt_failed', detail, tried: candidates })
  } catch (e) {
    res.status(502).json({ error: 'stt_failed', detail: (e as Error).message })
  }
})

// Router to n8n webhook
app.post('/api/router', requireAuth, async (req: any, res) => {
  try {
    const { userId, message, conversationId, mode, metadata } = req.body || {}
    if (!userId || !message) return res.status(400).json({ error: 'missing_fields' })
    const url = process.env.N8N_WEBHOOK_URL
    if (!url) return res.status(400).json({ error: 'router_not_configured' })
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, userid: userId, message, conversationId, mode, metadata }),
    })
    const text = await r.text().catch(() => '')
    if (!r.ok) return res.status(r.status).json({ error: 'router_failed', body: text })
    let reply = ''
    try {
      const data = text ? JSON.parse(text) : null
      if (data && typeof data === 'object') reply = data.reply || data.result || data.output || data.text || ''
      else if (typeof data === 'string') reply = data
    } catch {
      reply = text
    }
    res.json({ reply })
  } catch (e) {
    res.status(502).json({ error: 'router_failed', detail: (e as Error).message })
  }
})

// Callback endpoints (mock)
app.post('/api/jarvis/callback', async (req, res) => {
  const body: any = req.body ?? null
  const correlationId = (body?.correlationId || body?.id || (req.query as any)?.id || req.headers['x-correlation-id']) as string | undefined
  if (!correlationId) return res.status(400).json({ error: 'missing_correlationId' })

  // Accept multiple shapes:
  // - { correlationId, result: string }
  // - { correlationId, output: string }
  // - { correlationId, data: [...] }
  // - Array payloads like [{ output: "text" }]
  // Store the most relevant "payload" that GET will return directly.
  let payload: any
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if ('result' in body) payload = body.result
    else if ('output' in body) payload = body.output
    else if ('data' in body) payload = body.data
    else payload = body
  } else {
    payload = body
  }

  callbacks.set(correlationId, payload)
  res.json({ ok: true })
})
app.get('/api/jarvis/callback/:id', async (req, res) => {
  const id = req.params.id
  res.json(callbacks.get(id) || null)
})

// Text-to-Speech via ElevenLabs (optional)
app.post('/api/tts', requireAuth, async (req: any, res) => {
  try {
    const { text } = req.body || {}
  const headerKey = (req.headers['x-elevenlabs-key'] as string | undefined)?.trim()
  const apiKey = headerKey || process.env.ELEVENLABS_API_KEY
  // Default voice for project key (overridable by env)
  const defaultVoice = process.env.ELEVENLABS_VOICE_ID || '7dxS4V4NqL8xqL4PSiMp'
  // Allow end-users to supply a voice id only when using their own key
  const userVoiceHeader = (req.headers['x-elevenlabs-voice-id'] as string | undefined)?.trim()
  const voiceId = headerKey && userVoiceHeader ? userVoiceHeader : defaultVoice
    if (!apiKey) return res.status(400).json({ error: 'tts_not_configured' })
    if (!text) return res.status(400).json({ error: 'missing_text' })

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
  'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.7 }
      })
    })
    if (!r.ok) return res.status(500).json({ error: 'tts_failed' })
    const buf = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', 'audio/mpeg')
    res.send(buf)
  } catch (e) {
    res.status(500).json({ error: 'tts_failed' })
  }
})

// Low-latency streaming TTS via ElevenLabs stream endpoint
// Plays as it downloads for minimal delay.
app.get('/api/tts/stream', requireAuth, async (req: any, res) => {
  try {
    const text = (req.query.text as string || '').toString()
    const headerKey = (req.headers['x-elevenlabs-key'] as string | undefined)?.trim()
    const queryKey = (req.query.key as string | undefined)?.trim()
    const apiKey = headerKey || queryKey || process.env.ELEVENLABS_API_KEY
    const defaultVoice = process.env.ELEVENLABS_VOICE_ID || '7dxS4V4NqL8xqL4PSiMp'
    const userVoice = (req.query.voiceId as string | undefined)?.trim()
    const voiceId = (queryKey || headerKey) && userVoice ? userVoice : defaultVoice
    const optimize = (req.query.opt as string | undefined) || '2' // 0..4, lower = lower latency
    if (!apiKey) return res.status(400).json({ error: 'tts_not_configured' })
    if (!text) return res.status(400).json({ error: 'missing_text' })

    const controller = new AbortController()
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=${encodeURIComponent(optimize)}&output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.7 }
      }),
      signal: controller.signal as any
    })
    if (!r.ok || !r.body) return res.status(500).json({ error: 'tts_failed' })
    res.setHeader('Content-Type', 'audio/mpeg')
    // Hint to enable chunked transfer
    res.setHeader('Transfer-Encoding', 'chunked')
    // Pipe ElevenLabs stream directly to client
    // @ts-ignore - node-fetch body is a readable stream
    r.body.on('error', () => {
      try { res.end() } catch {}
    })
    req.on('close', () => {
      try { controller.abort() } catch {}
      try { res.end() } catch {}
    })
    // @ts-ignore
    r.body.pipe(res)
  } catch (e) {
    try { res.status(500).json({ error: 'tts_failed' }) } catch {}
  }
})

// Control API endpoints emitting to session WS/SSE
const PushBody = z.object({ sessionId: z.string().min(1), text: z.string().min(1), role: z.enum(['assistant', 'system']).optional(), say: z.boolean().optional() })
app.post('/api/push', async (req, res) => {
  const v = PushBody.safeParse(req.body)
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  publish(v.data.sessionId, { type: 'push', text: v.data.text, role: v.data.role, say: v.data.say })
  res.json({ ok: true })
})

const PushVoiceBody = z.object({ sessionId: z.string().min(1), text: z.string().min(1) })
app.post('/api/push-voice', async (req, res) => {
  const v = PushVoiceBody.safeParse(req.body)
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  publish(v.data.sessionId, { type: 'push-voice', text: v.data.text })
  res.json({ ok: true })
})

const CallEndBody = z.object({ sessionId: z.string().min(1), reason: z.string().optional() })
app.post('/api/call/end', async (req, res) => {
  const v = CallEndBody.safeParse(req.body)
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  publish(v.data.sessionId, { type: 'call-end', reason: v.data.reason })
  res.json({ ok: true })
})

// Events via WS or SSE fallback
// WS upgrade handled by ws server below; SSE endpoint here for fallback
app.get('/api/events', (req, res) => {
  const sessionId = (req.query.sessionId as string) || ''
  if (!sessionId) return res.status(400).end('missing sessionId')
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (data: string) => res.write(`data: ${data}\n\n`)
  const unsub = subscribe(sessionId, { kind: 'sse', send, end: () => res.end() })
  req.on('close', () => unsub())
})

const port = Number(process.env.BACKEND_PORT || 8080)
const server = app.listen(port, () => console.log(`Backend listening on :${port}`))

// WebSocket server for /api/events
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url || '', `http://x`)
    if (url.pathname !== '/api/events') return
    const sessionId = url.searchParams.get('sessionId') || ''
    if (!sessionId) return socket.destroy()
  wss.handleUpgrade(request, socket as any, head, (ws: WebSocket) => {
      const send = (data: string) => ws.readyState === ws.OPEN && ws.send(data)
      const unsub = subscribe(sessionId, { kind: 'ws', send, end: () => ws.close() })
      ws.on('close', () => unsub())
      ws.send(JSON.stringify({ type: 'hello', sessionId }))
    })
  } catch {
    socket.destroy()
  }
})
