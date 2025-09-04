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
import { exec } from 'child_process'
import interstellarRouter from './interstellar.js'

dotenv.config()

const app = express()
const prisma = new PrismaClient()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
const SESSION_COOKIE = 'jarvis_sid'
// Use Secure cookies only if:
// - COOKIE_SECURE=true explicitly, or
// - running in production AND the frontend origin is HTTPS
const COOKIE_SECURE = (
  String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' ||
  (process.env.NODE_ENV === 'production' && FRONTEND_ORIGIN.startsWith('https://'))
)

// Ensure we have a cookie signing secret in dev so signed cookies work locally.
// In production we require SESSION_SECRET via env (validated below).
const COOKIE_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-local-session-secret')

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser(COOKIE_SECRET))
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

// Interstellar router
app.use(interstellarRouter)

// Observability: safe serialization and sanitizer
const REDACT_KEYS = new Set([
  'password',
  'newpassword',
  'authorization',
  'cookie',
  'set-cookie',
  'xi-api-key',
  'x-openai-key',
  // Admin settings fields for provider secrets
  'openai_api_key',
  'elevenlabs_api_key',
])
function redact(obj: any): any {
  try {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(redact)
    const out: any = {}
    for (const [k,v] of Object.entries(obj)) {
      if (REDACT_KEYS.has(k.toLowerCase())) out[k] = '[REDACTED]'
      else if (typeof v === 'object') out[k] = redact(v)
      else out[k] = v
    }
    return out
  } catch { return obj }
}
function safeJsonPreview(obj: any, max = 2000): string | undefined {
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(redact(obj))
    return s.length > max ? s.slice(0, max) + '…' : s
  } catch {
    return undefined
  }
}

// Request/response logger capturing inputs/outputs and errors
app.use((req: any, res: any, next: any) => {
  const start = Date.now()
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined
  const ua = req.headers['user-agent'] as string | undefined
  const userId = req.user?.id as string | undefined
  let logged = false

  // Hook into res.end to capture status and body
  const originalJson = res.json.bind(res)
  const originalSend = res.send.bind(res)
  let responseBodyPreview: string | undefined
  res.json = (body: any) => {
    try { responseBodyPreview = safeJsonPreview(body, 2000) } catch {}
    return originalJson(body)
  }
  res.send = (body: any) => {
    try { responseBodyPreview = typeof body === 'string' ? (body.length > 2000 ? body.slice(0,2000)+'…' : body) : safeJsonPreview(body, 2000) } catch {}
    return originalSend(body)
  }

  function finalizeLog(err?: any) {
    if (logged) return; logged = true
    const duration = Date.now() - start
    const method = (req.method || '').toUpperCase()
    const path = req.path || req.originalUrl || req.url || ''
    const status = res.statusCode || 0
    const ok = status >= 200 && status < 400
  const requestBodyPreview = safeJsonPreview(req.body, 1000)
    const errorMessage = err ? (err.message || String(err)) : undefined
    const errorStack = err && err.stack ? String(err.stack).slice(0, 4000) : undefined
    // Avoid logging our own log-reading endpoint bodies to reduce noise
    const skipBody = path.startsWith('/api/admin/logs')
    ;(prisma as any).apiLog.create({
      data: {
        method, path, status, ok, durationMs: duration,
        ip, userAgent: ua,
        userId: userId || null,
        requestBody: skipBody ? undefined : requestBodyPreview,
        responseBody: skipBody ? undefined : responseBodyPreview,
        errorMessage, errorStack,
      }
    }).then((row: any) => {
      try { broadcastLog(row) } catch {}
    }).catch(()=>{})
  }

  res.on('finish', () => finalizeLog())
  res.on('close', () => finalizeLog())

  // Proceed to route handlers
  next()
})

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
  INTEGRATION_PUSH_TOKEN: z.string().optional(), // comma-separated accepted
})
const envParse = EnvSchema.safeParse(process.env)
if (!envParse.success) {
  console.error('Environment validation failed:', envParse.error.flatten().fieldErrors)
  // Fail fast in production to avoid insecure defaults
  if (process.env.NODE_ENV === 'production') {
    process.exit(1)
  }
}
// Parse integration tokens (public, token-authenticated Control API)
const INTEGRATION_TOKENS: Set<string> = new Set(
  (process.env.INTEGRATION_PUSH_TOKEN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
)

// Simple in-memory pub/sub keyed by sessionId with WS + SSE transport
type EventPayload =
  | { type: 'push'; text: string; role?: 'assistant' | 'system'; say?: boolean }
  | { type: 'push-voice'; text: string }
  | { type: 'call-end'; reason?: string }

const subscribers = new Map<string, Set<{ kind: 'ws' | 'sse'; send: (data: string) => void; end?: () => void }>>()
// Map sessions to users for user-targeted broadcasting
const sessionToUserId = new Map<string, string>()
const sessionsByUserId = new Map<string, Set<string>>()

function publish(sessionId: string, payload: EventPayload) {
  const subs = subscribers.get(sessionId)
  if (!subs) return
  const msg = JSON.stringify(payload)
  for (const s of subs) {
    try { s.send(msg) } catch { /* noop */ }
  }
}
function publishToUser(userId: string, payload: EventPayload) {
  const set = sessionsByUserId.get(userId)
  if (!set) return
  for (const sid of set) publish(sid, payload)
}

function subscribe(sessionId: string, sub: { kind: 'ws' | 'sse'; send: (data: string) => void; end?: () => void }, userId?: string) {
  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set())
  subscribers.get(sessionId)!.add(sub)
  if (userId) {
    sessionToUserId.set(sessionId, userId)
    if (!sessionsByUserId.has(userId)) sessionsByUserId.set(userId, new Set())
    sessionsByUserId.get(userId)!.add(sessionId)
  }
  return () => {
    const set = subscribers.get(sessionId)
    if (set) {
      set.delete(sub)
      if (set.size === 0) subscribers.delete(sessionId)
    }
    const uid = sessionToUserId.get(sessionId)
    if (uid) {
      const s = sessionsByUserId.get(uid)
      s?.delete(sessionId)
      if (s && s.size === 0) sessionsByUserId.delete(uid)
      if (!subscribers.has(sessionId)) sessionToUserId.delete(sessionId)
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

// Integration token guard (no cookie required)
function requireIntegrationToken(req: any, res: any, next: any) {
  try {
    if (INTEGRATION_TOKENS.size === 0) return res.status(501).json({ error: 'integration_disabled' })
    // Prefer Authorization: Bearer <token>
    const auth = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined
    let token = ''
    if (auth && /^Bearer\s+/i.test(auth)) token = auth.replace(/^Bearer\s+/i, '').trim()
    if (!token) token = (req.headers['x-api-token'] as string || '').trim()
    if (!token) token = (req.query.token as string || '').trim()
    if (!token || !INTEGRATION_TOKENS.has(token)) return res.status(401).json({ error: 'invalid_token' })
    ;(req as any).integrationToken = token
    next()
  } catch {
    return res.status(401).json({ error: 'invalid_token' })
  }
}

// Global settings cache + helpers
type FlagKey = 'REQUIRE_ADMIN_APPROVAL' | 'LOCK_NEW_ACCOUNTS'
const DEFAULT_FLAGS: Record<FlagKey, string> = {
  REQUIRE_ADMIN_APPROVAL: process.env.REQUIRE_ADMIN_APPROVAL || 'false',
  LOCK_NEW_ACCOUNTS: process.env.LOCK_NEW_ACCOUNTS || 'false',
}
const settingsCache = new Map<FlagKey, string>()
async function getFlag(key: FlagKey): Promise<string> {
  const cached = settingsCache.get(key)
  if (cached !== undefined) return cached
  try {
    const s = await (prisma as any).setting.findUnique({ where: { key } })
    const v = s?.value ?? DEFAULT_FLAGS[key] ?? 'false'
    settingsCache.set(key, v)
    return v
  } catch {
    return DEFAULT_FLAGS[key] ?? 'false'
  }
}
async function setFlag(key: FlagKey, value: string): Promise<void> {
  await (prisma as any).setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  settingsCache.set(key, value)
}

// Generic settings helpers for secrets and other values (cached)
const kvCache = new Map<string, string>()
async function getSettingValue(key: string): Promise<string | undefined> {
  if (kvCache.has(key)) return kvCache.get(key)
  try {
    const s = await (prisma as any).setting.findUnique({ where: { key } })
    if (s?.value != null) kvCache.set(key, s.value)
    return s?.value ?? undefined
  } catch {
    return undefined
  }
}
async function setSettingValue(key: string, value: string | null | undefined): Promise<void> {
  // null/undefined clears the key
  if (value == null || value === '') {
    try { await (prisma as any).setting.delete({ where: { key } }) } catch {}
    kvCache.delete(key)
    return
  }
  await (prisma as any).setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  kvCache.set(key, value)
}
function maskKey(k: string | undefined | null): string | null {
  if (!k) return null
  const len = k.length
  if (len <= 6) return '*'.repeat(Math.max(3, len))
  return `${k.slice(0, 3)}***${k.slice(-4)}`
}

// Rate limit auth
const authLimiter = rateLimit({ windowMs: 60_000, max: 30 })
// Rate limit token-based integration pushes per-IP
const integrationLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false })

// Auth routes (username-based)
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: 'missing_fields' })
    if ((await getFlag('LOCK_NEW_ACCOUNTS')) === 'true') return res.status(403).json({ error: 'locked' })
  const existing = await (prisma as any).user.findUnique({ where: { username } })
    if (existing) return res.status(409).json({ error: 'exists' })
    const passwordHash = await bcrypt.hash(password, 10)

  let status: 'active' | 'pending' | 'denied' = 'active'
  if ((await getFlag('REQUIRE_ADMIN_APPROVAL')) === 'true') status = 'pending'

  // Prefer ADMIN_USERNAMES; fall back to ADMIN_EMAILS for backward compatibility
  const adminList = (process.env.ADMIN_USERNAMES || process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim())
  const role: 'admin' | 'user' = adminList.includes(username) ? 'admin' : 'user'

  // Temporary: set a fallback email for compatibility while migrating
  const fallbackEmail = `${String(username).toLowerCase()}@local.local`
  const user = await (prisma as any).user.create({ data: { username, email: fallbackEmail, passwordHash, role, status } })
    if (status === 'pending') {
      await prisma.approval.create({ data: { userId: user.id } })
    }
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: 'server_error' })
  }
})

app.post('/api/auth/signin', authLimiter, async (req, res) => {
  // Temporary dual-lookup: allow login via username OR email
  const { username, email, password } = req.body || {}
  const identifier = (username || email || '').trim()
  if (!identifier || !password) return res.status(400).json({ error: 'missing_fields' })

  let user = null as any
  try {
    // If identifier looks like an email, prefer email lookup first
    if (identifier.includes('@')) {
      user = await (prisma as any).user.findUnique({ where: { email: identifier } })
    }
    if (!user) {
      // Temporary: cast to any until Prisma schema/types are fully migrated
      user = await (prisma as any).user.findUnique({ where: { username: identifier } })
    }
  } catch {}
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
    secure: COOKIE_SECURE,
    signed: true,
    expires: expiresAt,
    path: '/',
  })
  return res.json({ id: user.id, username: user.username, role: user.role, status: user.status })
})

app.post('/api/auth/signout', requireAuth, async (req: any, res) => {
  if (req.session) await prisma.session.delete({ where: { id: req.session.id } }).catch(() => {})
  res.clearCookie(SESSION_COOKIE)
  res.json({ ok: true })
})

app.get('/api/auth/me', async (req: any, res) => {
  if (!req.user) return res.json(null)
  const { id, username, role, status } = req.user
  res.json({ id, username, role, status })
})

// Admin routes
app.get('/api/admin/pending', requireAuth, requireAdmin, async (req, res) => {
  // Temporary: cast to any for username select until Prisma types include username
  const users = await (prisma as any).user.findMany({ where: { status: 'pending' }, select: { id: true, username: true } })
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

// Admin: global settings get/set for signup flow
app.get('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const requireApproval = await getFlag('REQUIRE_ADMIN_APPROVAL')
  const lockNew = await getFlag('LOCK_NEW_ACCOUNTS')
  res.json({ REQUIRE_ADMIN_APPROVAL: requireApproval === 'true', LOCK_NEW_ACCOUNTS: lockNew === 'true' })
})
app.post('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const body = req.body || {}
  const map: Partial<Record<FlagKey, string>> = {}
  if (typeof body.REQUIRE_ADMIN_APPROVAL === 'boolean') map.REQUIRE_ADMIN_APPROVAL = body.REQUIRE_ADMIN_APPROVAL ? 'true' : 'false'
  if (typeof body.LOCK_NEW_ACCOUNTS === 'boolean') map.LOCK_NEW_ACCOUNTS = body.LOCK_NEW_ACCOUNTS ? 'true' : 'false'
  const entries = Object.entries(map) as Array<[FlagKey,string]>
  for (const [k,v] of entries) await setFlag(k, v)
  const current = {
    REQUIRE_ADMIN_APPROVAL: (await getFlag('REQUIRE_ADMIN_APPROVAL')) === 'true',
    LOCK_NEW_ACCOUNTS: (await getFlag('LOCK_NEW_ACCOUNTS')) === 'true',
  }
  res.json({ ok: true, settings: current })
})

// Admin: provider keys (OpenAI, ElevenLabs)
app.get('/api/admin/keys', requireAuth, requireAdmin, async (req, res) => {
  const openaiDb = await getSettingValue('OPENAI_API_KEY')
  const elevenDb = await getSettingValue('ELEVENLABS_API_KEY')
  const openai = openaiDb || process.env.OPENAI_API_KEY || ''
  const eleven = elevenDb || process.env.ELEVENLABS_API_KEY || ''
  res.json({
    OPENAI_API_KEY: { has: !!openai, preview: maskKey(openai) },
    ELEVENLABS_API_KEY: { has: !!eleven, preview: maskKey(eleven) },
  })
})
app.post('/api/admin/keys', requireAuth, requireAdmin, async (req, res) => {
  const body = req.body || {}
  // Note: request/response bodies are masked by REDACT_KEYS to avoid logging secrets
  const providedOpenAI = Object.prototype.hasOwnProperty.call(body, 'OPENAI_API_KEY')
  const providedEleven = Object.prototype.hasOwnProperty.call(body, 'ELEVENLABS_API_KEY')
  if (providedOpenAI) {
    const v = typeof body.OPENAI_API_KEY === 'string' ? body.OPENAI_API_KEY.trim() : ''
    await setSettingValue('OPENAI_API_KEY', v)
  }
  if (providedEleven) {
    const v = typeof body.ELEVENLABS_API_KEY === 'string' ? body.ELEVENLABS_API_KEY.trim() : ''
    await setSettingValue('ELEVENLABS_API_KEY', v)
  }
  const openaiDb = await getSettingValue('OPENAI_API_KEY')
  const elevenDb = await getSettingValue('ELEVENLABS_API_KEY')
  res.json({
    ok: true,
    keys: {
      OPENAI_API_KEY: { has: !!(openaiDb || process.env.OPENAI_API_KEY), preview: maskKey(openaiDb || process.env.OPENAI_API_KEY || '') },
      ELEVENLABS_API_KEY: { has: !!(elevenDb || process.env.ELEVENLABS_API_KEY), preview: maskKey(elevenDb || process.env.ELEVENLABS_API_KEY || '') },
    }
  })
})

// Webhook URL settings (n8n) — public read, admin write
app.get('/api/webhook-urls', async (req, res) => {
  try {
    const prod = await getSettingValue('WEBHOOK_URL_PROD')
    const test = await getSettingValue('WEBHOOK_URL_TEST')
    res.json({ prod: prod || '', test: test || '' })
  } catch {
    res.status(500).json({ error: 'read_failed' })
  }
})
app.get('/api/admin/webhook-urls', requireAuth, requireAdmin, async (req, res) => {
  try {
    const prod = await getSettingValue('WEBHOOK_URL_PROD')
    const test = await getSettingValue('WEBHOOK_URL_TEST')
    res.json({ prod: prod || '', test: test || '' })
  } catch {
    res.status(500).json({ error: 'read_failed' })
  }
})
app.post('/api/admin/webhook-urls', requireAuth, requireAdmin, async (req, res) => {
  const v = z.object({
    prod: z.string().trim().url().or(z.literal('')).optional(),
    test: z.string().trim().url().or(z.literal('')).optional(),
  }).safeParse(req.body || {})
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  const { prod, test } = v.data
  try {
    if (prod !== undefined) await setSettingValue('WEBHOOK_URL_PROD', prod || null)
    if (test !== undefined) await setSettingValue('WEBHOOK_URL_TEST', test || null)
    const newProd = await getSettingValue('WEBHOOK_URL_PROD')
    const newTest = await getSettingValue('WEBHOOK_URL_TEST')
    res.json({ ok: true, prod: newProd || '', test: newTest || '' })
  } catch (e) {
    res.status(500).json({ error: 'save_failed', detail: String(e) })
  }
})

// Admin: users listing
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  // Temporary: cast to any for username select until Prisma types include username
  const users = await (prisma as any).user.findMany({
    select: { id: true, username: true, role: true, status: true, createdAt: true }
  })
  res.json(users)
})

// Admin: logs - list recent with filters
app.get('/api/admin/logs', requireAuth, requireAdmin, async (req: any, res) => {
  const take = Math.min(Number(req.query.take || 100), 500)
  const cursor = req.query.cursor as string | undefined
  const path = (req.query.path as string | undefined)?.trim()
  const status = req.query.status ? Number(req.query.status) : undefined
  const ok = typeof req.query.ok === 'string' ? req.query.ok === 'true' ? true : req.query.ok === 'false' ? false : undefined : undefined
  const method = (req.query.method as string | undefined)?.toUpperCase()
  const where: any = {}
  if (path) where.path = { contains: path, mode: 'insensitive' }
  if (typeof status === 'number' && !Number.isNaN(status)) where.status = status
  if (typeof ok === 'boolean') where.ok = ok
  if (method) where.method = method
  const logs = await (prisma as any).apiLog.findMany({
    where,
    orderBy: { ts: 'desc' },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
  })
  res.json({ items: logs, nextCursor: logs.length === take ? logs[logs.length-1]?.id : null })
})

// Admin: single log
app.get('/api/admin/logs/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id
  const log = await (prisma as any).apiLog.findUnique({ where: { id } })
  res.json(log || null)
})

// Admin: logs stream via SSE
type LogSubscriber = { send: (data: string) => void, end: () => void }
const logSubscribers = new Set<LogSubscriber>()
function broadcastLog(row: any) {
  const msg = `data: ${JSON.stringify(row)}\n\n`
  for (const s of Array.from(logSubscribers)) {
    try { s.send(msg) } catch { try { s.end() } catch {}; logSubscribers.delete(s) }
  }
}
app.get('/api/admin/logs/stream', requireAuth, requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (chunk: string) => res.write(chunk)
  const end = () => { try { res.end() } catch {} }
  const sub: LogSubscriber = { send, end }
  logSubscribers.add(sub)
  // initial hello
  try { send(`event: hello\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`) } catch {}
  const hb = setInterval(() => {
    try { send(`: ping ${Date.now()}\n\n`) } catch { /* noop */ }
  }, 15000)
  req.on('close', () => { clearInterval(hb); logSubscribers.delete(sub); end() })
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
const openaiEnvClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
app.post('/api/transcribe', requireAuth, upload.single('file'), async (req: any, res) => {
  try {
    const file = req.file
    const correlationId = req.body.correlationId
    if (!file || !correlationId) return res.status(400).json({ error: 'missing_fields' })

    // Use Whisper or gpt-4o-mini-transcribe
    const mode = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'
  const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
  const dbKey = await getSettingValue('OPENAI_API_KEY')
  const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(400).json({ error: 'stt_not_configured' })
  const oaClient = new OpenAI({ apiKey })
  const transcript = await oaClient.audio.transcriptions.create({
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
      const dbKey = await getSettingValue('OPENAI_API_KEY')
      if (!process.env.OPENAI_API_KEY && !dbKey && !headerKey) return res.status(400).json({ error: 'stt_not_configured' })

    const preferred = (process.env.TRANSCRIBE_MODEL || process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe').trim()
    // Provide a resilient fallback order
    const candidates = Array.from(new Set([
      preferred,
      preferred === 'whisper-1' ? 'gpt-4o-mini-transcribe' : 'whisper-1',
    ]))

  const oa = new OpenAI({ apiKey: headerKey || dbKey || process.env.OPENAI_API_KEY! })
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

// Admin: Create new backup via N8N webhook and refresh codespace
app.post('/api/admin/create-backup', requireAuth, requireAdmin, async (req: any, res) => {
  try {
    // Get webhook URLs from database (use correct key names)
    const prodPostUrl = await getSettingValue('INTERSTELLAR_POST_URL_PROD')
    const webhookUrl = prodPostUrl || process.env.VITE_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL
    
    if (!webhookUrl) {
      return res.status(400).json({ error: 'webhook_not_configured' })
    }

    const correlationId = randomUUID()
    
    // Send NewBackUp action to N8N
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'NewBackUp',
        chatInput: 'NewBackUp',
        userid: req.user.id,
        username: req.user.username,
        correlationId,
        callbackUrl: '/api/jarvis/callback',
        source: 'jarvis-portal-admin',
        messageType: 'AdminAction',
        adminAction: 'NewBackUp'
      }),
    })

    const text = await r.text().catch(() => '')
    if (!r.ok) {
      return res.status(r.status).json({ error: 'backup_webhook_failed', body: text })
    }

    let reply = ''
    try {
      const data = text ? JSON.parse(text) : null
      if (data && typeof data === 'object') reply = data.reply || data.result || data.output || data.text || ''
      else if (typeof data === 'string') reply = data
    } catch {
      reply = text
    }

    // Check if we're in a codespace and attempt to refresh
    let codespaceRefreshed = false
    if (process.env.CODESPACES === 'true') {
      try {
        // Execute codespace refresh command
        exec('sudo systemctl restart docker', (error: any) => {
          if (!error) {
            codespaceRefreshed = true
          }
        })
      } catch (e) {
        // Codespace refresh failed, but backup might still have succeeded
      }
    }

    res.json({ 
      ok: true, 
      correlationId,
      backupResponse: reply,
      codespaceRefreshed,
      message: 'Backup request sent to N8N'
    })
  } catch (e) {
    res.status(502).json({ error: 'backup_failed', detail: (e as Error).message })
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
  const dbKey = await getSettingValue('ELEVENLABS_API_KEY')
  const apiKey = headerKey || dbKey || process.env.ELEVENLABS_API_KEY
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
  const dbKey = await getSettingValue('ELEVENLABS_API_KEY')
  const apiKey = headerKey || queryKey || dbKey || process.env.ELEVENLABS_API_KEY
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

// Admin: push by user targeting (userId or username/email) for n8n integrations
const PushUserBody = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  email: z.string().optional(), // temporary dual-lookup support
  text: z.string().min(1),
  say: z.boolean().optional(),
  voice: z.boolean().optional()
})
app.post('/api/admin/push-to-user', requireAuth, requireAdmin, async (req, res) => {
  const v = PushUserBody.safeParse(req.body)
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  const { userId: uid, username, email, text, say, voice } = v.data
  let targetId = uid || null
  if (!targetId && username) {
    const u = await (prisma as any).user.findUnique({ where: { username } }).catch(()=>null)
    targetId = u?.id || null
  }
  if (!targetId && email) {
    const u = await prisma.user.findUnique({ where: { email } }).catch(()=>null)
    targetId = u?.id || null
  }
  if (!targetId) return res.status(404).json({ error: 'user_not_found' })
  // Broadcast to all sessions for this user
  publishToUser(targetId, voice ? { type: 'push-voice', text } : { type: 'push', text, role: 'assistant', say })
  res.json({ ok: true })
})

// Public, token-secured: push to user by userId or username/email (no admin cookie)
// Auth: Authorization: Bearer <INTEGRATION_PUSH_TOKEN>
// Body: { userId?: string, username?: string, text: string, say?: boolean, voice?: boolean, role?: 'assistant'|'system' }
const PushIntegrationBody = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  email: z.string().optional(), // temporary dual-lookup support
  text: z.string().min(1),
  // The following flags are accepted for backward compatibility,
  // but this endpoint will force speaking behavior regardless.
  say: z.boolean().optional(),
  voice: z.boolean().optional(),
  role: z.enum(['assistant','system']).optional()
})
app.post('/api/integration/push-to-user', integrationLimiter, requireIntegrationToken, async (req, res) => {
  const v = PushIntegrationBody.safeParse(req.body)
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  const { userId: uid, username, email, text } = v.data
  if (!uid && !username && !email) return res.status(400).json({ error: 'missing_target' })
  let targetId = uid || null
  if (!targetId && username) {
    const u = await (prisma as any).user.findUnique({ where: { username } }).catch(()=>null)
    targetId = u?.id || null
  }
  if (!targetId && email) {
    const u = await prisma.user.findUnique({ where: { email } }).catch(()=>null)
    targetId = u?.id || null
  }
  if (!targetId) return res.status(404).json({ error: 'user_not_found' })
  // Always trigger speaking for integration pushes for consistent behavior
  const payload: EventPayload = { type: 'push-voice', text }
  publishToUser(targetId, payload)
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
  const userId = (req as any).user?.id as string | undefined
  const unsub = subscribe(sessionId, { kind: 'sse', send, end: () => res.end() }, userId)
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
    const userId = url.searchParams.get('userId') || undefined
    wss.handleUpgrade(request, socket as any, head, (ws: WebSocket) => {
      const send = (data: string) => ws.readyState === ws.OPEN && ws.send(data)
      const unsub = subscribe(sessionId, { kind: 'ws', send, end: () => ws.close() }, userId)
      ws.on('close', () => unsub())
      ws.send(JSON.stringify({ type: 'hello', sessionId }))
    })
  } catch {
    socket.destroy()
  }
})
