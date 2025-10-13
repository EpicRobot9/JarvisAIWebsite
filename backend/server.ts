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
import { exec, spawn } from 'child_process'
import interstellarRouter from './interstellar.js'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

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

// =========
// Utilities
// =========

function vecCosine(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i=0; i<n; i++) { const x = a[i] as number, y = b[i] as number; dot += x*y; na += x*x; nb += y*y }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function getOpenAIFromReq(req: any): Promise<OpenAI | null> {
  const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
  const dbKey = await getSettingValue('OPENAI_API_KEY')
  const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

function boardItemToText(it: any): string {
  const c = it?.content || {}
  if (it?.type === 'note') return String(c.text || '')
  if (it?.type === 'checklist') return (Array.isArray(c.items)? c.items:[]).map((ci:any)=> `- ${ci.text}${ci.done?' [x]':''}`).join('\n')
  if (it?.type === 'link') return `${c.title||c.url||''} ${c.desc||''}`.trim()
  if (it?.type === 'image') return `${c.caption||''} ${c.url||''}`.trim()
  if (it?.type === 'group') return String(c.title || '')
  return ''
}

async function embedTexts(oa: OpenAI, texts: string[], model: string = (process.env.EMBEDDING_MODEL || 'text-embedding-3-small')): Promise<number[][]> {
  if (!texts.length) return []
  // Chunk into batches to respect token limits
  const out: number[][] = []
  const batchSize = 64
  for (let i=0; i<texts.length; i+=batchSize) {
    const slice = texts.slice(i, i+batchSize)
    const r = await oa.embeddings.create({ model, input: slice })
    const vecs = (r.data || []).map(d => (d.embedding as number[]))
    out.push(...vecs)
  }
  return out
}

// Simple URL import: fetch and extract text content
app.post('/api/import/url', requireAuth, async (req: any, res) => {
  try {
    const { url } = req.body || {}
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'missing_url' })
    const r = await fetch(url, { headers: { 'User-Agent': 'JarvisAI/1.0 (+importer)' } })
    if (!r.ok) return res.status(400).json({ error: 'fetch_failed', status: r.status })
    const html = await r.text()
    const dom = new JSDOM(html, { url })
    const doc = dom.window.document
    const title = (doc.querySelector('title')?.textContent || '').trim()
    // Basic extraction: drop script/style and get visible text
    doc.querySelectorAll('script,style,noscript').forEach(el => el.remove())
    let text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim()
    // Fallback to Readability if text is too short
    if (!text || text.length < 200) {
      try {
        const article = new Readability(doc).parse()
        const articleText = (article?.textContent || '').replace(/\s+/g, ' ').trim()
        if (articleText && articleText.length > text.length) text = articleText
      } catch {}
    }
    return res.json({ title, text })
  } catch (e) {
    console.error('Import URL error', e)
    res.status(500).json({ error: 'import_failed' })
  }
})

// Document import: PDF (with optional OCR), DOCX, PPTX
app.post('/api/import/file', requireAuth, upload.single('file'), async (req: any, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'missing_file' })
    const ocrRequested = String(req.query.ocr || req.body?.ocr || '').toLowerCase() === 'true'
    const analyze = String(req.query.analyze || req.body?.analyze || '').toLowerCase() !== 'false' // default true
    const originalName: string = file.originalname || 'document'
    const ext = (originalName.split('.').pop() || '').toLowerCase()
    const meta: any = { ext, ocrRequested }
    let raw = ''

    async function parsePdfEmbedded(): Promise<string> {
      try {
        const pdfParseMod = await import('pdf-parse')
        const pdfParse = (pdfParseMod as any).default || (pdfParseMod as any).pdf || pdfParseMod
        const data = await pdfParse(file.buffer)
        return (data.text || '')
      } catch (e) {
        meta.pdfParseError = (e as any)?.message || true
        return ''
      }
    }

    async function extractPdfTextViaPdfjs(maxPagesOverride?: number): Promise<string> {
      try {
        const pdfjsDist: any = await import('pdfjs-dist')
        try {
          if (pdfjsDist?.GlobalWorkerOptions) {
            pdfjsDist.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.js')
          }
        } catch {}
        const loadingTask = pdfjsDist.getDocument({ data: file.buffer })
        const pdf = await loadingTask.promise
        const defaultMax = 50
        const maxPages = Math.min(pdf.numPages, Math.max(1, maxPagesOverride || defaultMax))
        let out: string[] = []
        for (let i=1; i<=maxPages; i++) {
          try {
            const page = await pdf.getPage(i)
            const content = await page.getTextContent()
            const text = (content.items || []).map((it:any)=> (it.str || '')).join(' ')
            if (text && text.trim()) out.push(text)
          } catch (e) {
            meta.pdfjsTextErrors = (meta.pdfjsTextErrors || 0) + 1
          }
        }
        return out.join('\n')
      } catch (e) {
        meta.pdfjsTextError = (e as any)?.message || true
        return ''
      }
    }

    async function rasterAndOcrPdf(maxPagesOverride?: number): Promise<string> {
      try {
        // Lazy imports
        const pdfjsDist: any = await import('pdfjs-dist')
        // Configure worker if available
        try {
          if (pdfjsDist?.GlobalWorkerOptions) {
            pdfjsDist.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.js')
          }
        } catch {}
        const loadingTask = pdfjsDist.getDocument({ data: file.buffer })
        const pdf = await loadingTask.promise
        const { createWorker } = await import('tesseract.js') as any
        const worker = await createWorker({ logger: () => {} })
        await worker.loadLanguage('eng')
        await worker.initialize('eng')
        let ocrTexts: string[] = []
        // Use node-canvas for rendering
        let createCanvas: any
        try {
          // Dynamic require to avoid TS resolution error if types not installed
          // @ts-ignore
          createCanvas = (await import('canvas')).createCanvas
          if (!createCanvas) throw new Error('no_createCanvas')
        } catch (e) {
          meta.canvasUnavailable = true
          return ''
        }
  const defaultMax = 15
  const maxPages = Math.min(pdf.numPages, Math.max(1, maxPagesOverride || defaultMax)) // guard for huge docs
        for (let i=1; i<=maxPages; i++) {
          try {
            const page = await pdf.getPage(i)
            const viewport = page.getViewport({ scale: 1.5 })
            const canvas = createCanvas(viewport.width, viewport.height)
            const ctx = canvas.getContext('2d')
            const renderContext = { canvasContext: ctx, viewport }
            await page.render(renderContext).promise
            const img = canvas.toBuffer('image/png')
            const { data: { text } } = await worker.recognize(img)
            if (text && text.trim()) ocrTexts.push(text)
          } catch (e) {
            meta.ocrPageErrors = (meta.ocrPageErrors || 0) + 1
          }
        }
        await worker.terminate()
        meta.ocrPages = ocrTexts.length
        if (pdf.numPages > maxPages) meta.ocrPagesTruncated = pdf.numPages - maxPages
        return ocrTexts.join('\n')
      } catch (e) {
        meta.ocrRasterError = (e as any)?.message || true
        return ''
      }
    }

    async function extractDocx(): Promise<string> {
      try {
        const mammoth = await import('mammoth') as any
        const r = await mammoth.extractRawText({ buffer: file.buffer })
        return r.value || ''
      } catch (e) {
        meta.docxError = (e as any)?.message || true
        return ''
      }
    }
    async function extractPptx(): Promise<{ text: string, slides: any[] }> {
      try {
        const pptxParser = await import('pptx-parser') as any
        const slides = await pptxParser.parsePptx(file.buffer) || []
        const text = Array.isArray(slides) ? slides.map((s: any)=> (s.texts || []).join('\n')).join('\n\n') : ''
        return { text, slides }
      } catch (e) {
        meta.pptxError = (e as any)?.message || true
        return { text: '', slides: [] }
      }
    }

    let slidesMeta: any[]|undefined
    if (ext === 'pdf') {
      raw = await parsePdfEmbedded()
      const threshold = 80
      if (raw.trim().length < threshold) {
        // Try pdf.js text content extraction before OCR
        const viaPdfjs = await extractPdfTextViaPdfjs(50)
        if (viaPdfjs && viaPdfjs.trim().length >= threshold) {
          meta.pdfjsTextApplied = true
          raw = viaPdfjs
        } else {
          // Attempt limited OCR automatically; expand if user explicitly requested
          const limit = ocrRequested ? 15 : 5
          const ocrText = await rasterAndOcrPdf(limit).catch(()=> '')
          if (ocrText) {
            meta.ocrApplied = true
            if (!ocrRequested) meta.ocrAuto = true
            raw = raw ? raw + '\n' + ocrText : ocrText
          } else {
            meta.ocrAttempted = true
          }
        }
      } else if (ocrRequested) {
        meta.ocrSkipped = 'sufficient_text'
      }
    } else if (ext === 'docx') {
      raw = await extractDocx()
      if (!raw || !raw.trim()) {
        // Fallback: convert to HTML and strip tags
        try {
          const mammoth = await import('mammoth') as any
          const r = await mammoth.convertToHtml({ buffer: file.buffer })
          const html = String(r.value || '')
          const txt = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
          raw = txt
          meta.docxHtmlFallback = true
        } catch (e) {
          meta.docxHtmlFallbackError = (e as any)?.message || true
        }
      }
    } else if (ext === 'pptx' || ext === 'ppt') {
      const { text, slides } = await extractPptx()
      raw = text
      slidesMeta = slides.map((s:any, idx:number)=> ({ index: idx, textCount: (s.texts||[]).join(' ').length }))
      if ((!raw || !raw.trim()) && Array.isArray(slides) && slides.length) {
        try {
          const alt = slides.map((s:any)=> [s.title, (s.notes||[]).join(' '), (s.texts||[]).join(' ')].filter(Boolean).join(' ')).join('\n\n')
          if (alt && alt.trim().length > 0) {
            raw = alt
            meta.pptxAltAssembled = true
          }
        } catch {}
      }
    } else {
      return res.status(400).json({ error: 'unsupported_type' })
    }

    let text = (raw || '').replace(/\s+/g, ' ').trim()
  if (!text) return res.status(422).json({ error: 'empty_text', meta })

    // Deduplicate repeating headers/footers for PDFs & DOCX (simple heuristic)
    function removeRepeatingLines(str: string): string {
      const lines = str.split(/\n+/)
      const counts: Record<string, number> = {}
      lines.forEach(l=> { const k = l.trim(); if (k.length>0 && k.length<120) counts[k] = (counts[k]||0)+1 })
      const threshold = Math.max(2, Math.floor(lines.length * 0.02))
      const remove = new Set(Object.entries(counts).filter(([,c])=> c>=threshold).map(([k])=>k))
      if (!remove.size) return str
      meta.removedRepeating = remove.size
      return lines.filter(l=> !remove.has(l.trim())).join('\n')
    }
    text = removeRepeatingLines(text)

    interface Section { heading: string, content: string }
    const sections: Section[] = []
    const headingsRegex = /(\n|^)(#+\s+[^\n]+|[A-Z][A-Z0-9 ,\-]{4,})(?=\n)/g
    if (analyze) {
      // Split into pseudo-sections
      let lastIndex = 0
      let match: RegExpExecArray | null
      const src = '\n' + text
      const found: { idx:number; title:string }[] = []
      while ((match = headingsRegex.exec(src))) {
        const title = match[2].trim()
        const idx = match.index
        found.push({ idx, title })
      }
      for (let i=0; i<found.length; i++) {
        const start = found[i].idx
        const end = i+1 < found.length ? found[i+1].idx : src.length
        const content = src.slice(start, end).replace(/^\n+/, '')
        sections.push({ heading: found[i].title.slice(0,120), content: content.slice(0, 4000) })
      }
      meta.sections = sections.length
    }

    // Table detection (markdown/simple) & flashcard suggestion
    const tables: { snippet: string }[] = []
    const flashcards: { front: string, back: string }[] = []
    if (analyze) {
      const lines = text.split(/\n/)
      for (let i=0; i<lines.length; i++) {
        const line = lines[i]
        if (/\|/.test(line) && /---/.test(lines[i+1]||'')) {
          const snippet = [line, lines[i+1]||'', lines[i+2]||''].join('\n')
          tables.push({ snippet: snippet.slice(0,300) })
        }
        // Simple 'Term: Definition' flashcard pattern
        const m = line.match(/^([A-Z][A-Za-z0-9 .]{1,80}):\s+(.{5,200})$/)
        if (m) flashcards.push({ front: m[1].trim(), back: m[2].trim().slice(0,240) })
        if (flashcards.length >= 50) break
      }
      meta.tables = tables.length
      meta.flashcards = flashcards.length
    }

    const title = originalName.replace(/\.[^.]+$/, '')
    // Length guard after analysis but before returning
    if (text.length > 250_000) {
      text = text.slice(0, 250_000) + '...'
      meta.truncated = true
    }

    res.json({ title, text, source: ext.toUpperCase(), meta, analysis: analyze ? { sections, tables, flashcards, slides: slidesMeta } : undefined })
  } catch (e) {
    console.error('Import file error', e)
    res.status(500).json({ error: 'import_failed' })
  }
})

// ==================
// Role-play Simulator
// ==================
type RoleplayScenario = {
  id: string
  title: string
  description: string
  system: string
  rubric?: string
}

const ROLEPLAY_SCENARIOS: RoleplayScenario[] = [
  {
    id: 'job-interview-se',
    title: 'Software Engineering Job Interview',
    description: 'You are interviewing a mid-level full-stack engineer candidate. Assess backend, frontend, system design, and communication.',
    system: 'Act as a technical interviewer. Ask one question at a time. Probe for depth and reasoning. If the candidate gets stuck, offer a gentle hint. Keep responses concise.',
    rubric: 'Score clarity, technical depth, problem-solving, communication (1-5 each). Provide one actionable improvement.'
  },
  {
    id: 'medical-history',
    title: 'Clinical Role-play: Patient History',
    description: 'The user is a medical student taking a focused patient history. You are the patient with a specific complaint.',
    system: 'You are a standardized patient. Provide realistic, concise answers. Reveal details only when asked. Keep emotional tone appropriate.',
    rubric: 'Score rapport, structure, differential reasoning, and safety/alerts (1-5). Provide 1 key missed question if any.'
  }
]

// List scenarios (static for v1)
app.get('/api/roleplay/scenarios', requireAuth, async (_req: any, res) => {
  try {
    const customs = await (prisma as any).roleplayScenario.findMany({ where: { userId: (_req as any).user.id }, orderBy: { createdAt: 'desc' } })
    const items = [
      ...ROLEPLAY_SCENARIOS.map(s => ({ id: s.id, title: s.title, description: s.description, builtIn: true })),
      ...customs.map((s: any) => ({ id: s.id, title: s.title, description: s.description, builtIn: false }))
    ]
    res.json({ items })
  } catch {
    res.json({ items: ROLEPLAY_SCENARIOS.map(s => ({ id: s.id, title: s.title, description: s.description, builtIn: true })) })
  }
})

// Create a custom scenario for the current user
const CreateScenarioBody = z.object({ title: z.string().min(1), description: z.string().min(1), system: z.string().min(1), rubric: z.string().optional() })
app.post('/api/roleplay/scenarios', requireAuth, async (req: any, res) => {
  const v = CreateScenarioBody.safeParse(req.body)
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  const row = await (prisma as any).roleplayScenario.create({ data: { userId: req.user.id, title: v.data.title, description: v.data.description, system: v.data.system, rubric: v.data.rubric || null } })
  res.json({ scenario: { id: row.id, title: row.title, description: row.description } })
})

// Delete a custom scenario (owned by user)
app.delete('/api/roleplay/scenarios/:id', requireAuth, async (req: any, res) => {
  const id = req.params.id
  try {
    const row = await (prisma as any).roleplayScenario.findUnique({ where: { id } })
    if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    await (prisma as any).roleplayScenario.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'delete_failed' })
  }
})

// Chat progression and optional rubric assessment
const RoleplayNextBody = z.object({
  scenarioId: z.string().min(1),
  sessionId: z.string().optional(),
  messages: z.array(z.object({ role: z.enum(['system','user','assistant']), content: z.string().min(1) })).min(1),
  assess: z.boolean().optional()
})
app.post('/api/roleplay/next', requireAuth, async (req: any, res) => {
  try {
    const v = RoleplayNextBody.safeParse(req.body)
    if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
    const { scenarioId, messages, assess, sessionId } = v.data
    // Resolve scenario from built-ins or user customs
    let scenario = ROLEPLAY_SCENARIOS.find(s => s.id === scenarioId)
    if (!scenario) {
      try {
        const row = await (prisma as any).roleplayScenario.findUnique({ where: { id: scenarioId } })
        if (row && row.userId === req.user.id) scenario = { id: row.id, title: row.title, description: row.description, system: row.system, rubric: row.rubric || undefined }
      } catch {}
    }
    if (!scenario) return res.status(404).json({ error: 'scenario_not_found' })

    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'openai_not_configured' })

    const oa = new OpenAI({ apiKey })
    const sys = scenario.system
    const chatMessages = [
      { role: 'system' as const, content: sys },
      ...messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user'|'assistant', content: m.content }))
    ]

    const completion = await oa.chat.completions.create({
      model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 400
    })
    const reply = completion.choices?.[0]?.message?.content || ''

  let feedback: any | undefined
    if (assess && scenario.rubric) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || ''
      const lastAssistant = reply
      const rubricPrompt = `You are an evaluator. Scenario rubric:\n${scenario.rubric}\n\nGiven the last user message and assistant response in this role-play, provide:\n- summary (2 sentences)\n- scores: JSON array of {criterion, score (1-5), notes}\nKeep to 120 words max.`
      const evalMessages = [
        { role: 'system' as const, content: rubricPrompt },
        { role: 'user' as const, content: `User: ${lastUser}\nAssistant: ${lastAssistant}` }
      ]
      const evalC = await oa.chat.completions.create({
        model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini',
        messages: evalMessages,
        temperature: 0.2,
        max_tokens: 250
      })
      const evalText = evalC.choices?.[0]?.message?.content || ''
      // Best-effort JSON extraction for scores
      let scores: any[] | undefined
      try {
        const m = evalText.match(/\[\s*{[\s\S]*}\s*\]/)
        if (m) scores = JSON.parse(m[0])
      } catch {}
      feedback = { summary: evalText.replace(/\[[\s\S]*$/, '').trim(), scores }
    }

    // Persist session if sessionId provided
    if (sessionId) {
      try {
        const row = await (prisma as any).roleplaySession.findUnique({ where: { id: sessionId } })
        const nowMsgs = messages.concat([{ role: 'assistant', content: reply }])
        const agg = (()=>{
          try {
            const arr = (feedback?.scores || []) as any[]
            if (!Array.isArray(arr) || arr.length === 0) return null
            const nums = arr.map((s:any)=> Number(s.score || 0)).filter((n:number)=> Number.isFinite(n))
            if (!nums.length) return null
            return nums.reduce((a:number,b:number)=>a+b,0) / nums.length
          } catch { return null }
        })()
        if (row && row.userId === req.user.id) {
          await (prisma as any).roleplaySession.update({ where: { id: sessionId }, data: { messages: nowMsgs as any, feedback: feedback || null, score: agg } })
        }
      } catch {}
    }

    res.json({ reply, feedback })
  } catch (e) {
    console.error('roleplay_next error', e)
    res.status(500).json({ error: 'roleplay_failed' })
  }
})

// Create/list/update sessions
const CreateSessionBody = z.object({ scenarioId: z.string().min(1) })
app.post('/api/roleplay/sessions', requireAuth, async (req: any, res) => {
  const v = CreateSessionBody.safeParse(req.body)
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  const { scenarioId } = v.data
  // Validate scenario access
  let ok = !!ROLEPLAY_SCENARIOS.find(s => s.id === scenarioId)
  if (!ok) {
    try {
      const row = await (prisma as any).roleplayScenario.findUnique({ where: { id: scenarioId } })
      ok = !!(row && row.userId === req.user.id)
    } catch {}
  }
  if (!ok) return res.status(404).json({ error: 'scenario_not_found' })
  const row = await (prisma as any).roleplaySession.create({ data: { userId: req.user.id, scenarioId, messages: [] } })
  res.json({ session: { id: row.id } })
})

const UpdateSessionBody = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })), feedback: z.any().optional(), score: z.number().nullable().optional(), savedSetId: z.string().optional() })
app.put('/api/roleplay/sessions/:id', requireAuth, async (req: any, res) => {
  const id = req.params.id
  const v = UpdateSessionBody.safeParse(req.body)
  if (!v.success) return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  const row = await (prisma as any).roleplaySession.findUnique({ where: { id } })
  if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
  const upd = await (prisma as any).roleplaySession.update({ where: { id }, data: { messages: v.data.messages as any, feedback: (v.data as any).feedback ?? row.feedback, score: v.data.score ?? row.score, savedSetId: v.data.savedSetId ?? row.savedSetId } })
  res.json({ session: { id: upd.id } })
})

// List sessions and simple progress
app.get('/api/roleplay/sessions', requireAuth, async (req: any, res) => {
  const scenarioId = (req.query.scenarioId as string | undefined) || undefined
  const where: any = { userId: req.user.id }
  if (scenarioId) where.scenarioId = scenarioId
  const items = await (prisma as any).roleplaySession.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 })
  res.json({ items: items.map((r:any)=> ({ id: r.id, scenarioId: r.scenarioId, score: r.score, createdAt: r.createdAt })) })
})

app.get('/api/roleplay/progress', requireAuth, async (req: any, res) => {
  const scenarioId = (req.query.scenarioId as string | undefined) || undefined
  const where: any = { userId: req.user.id }
  if (scenarioId) where.scenarioId = scenarioId
  const items = await (prisma as any).roleplaySession.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 })
  const scores = items.map((r:any)=> Number(r.score || 0)).filter((n:number)=> Number.isFinite(n) && n>0)
  const avg = scores.length ? (scores.reduce((a:number,b:number)=>a+b,0)/scores.length) : null
  res.json({ totalSessions: items.length, avgScore: avg, recent: items.slice(0,5).map((r:any)=> ({ id: r.id, score: r.score, at: r.createdAt })) })
})

// Export a session to a Study Set
app.post('/api/roleplay/sessions/:id/export', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const row = await (prisma as any).roleplaySession.findUnique({ where: { id } })
    if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const scenario = await (prisma as any).roleplayScenario.findUnique({ where: { id: row.scenarioId } }).catch(()=>null)
    const title = `Role-play: ${scenario?.title || 'Session'} (${new Date().toLocaleDateString()})`
    // Build source text from messages
    const msgs: Array<{ role: string; content: string }> = Array.isArray(row.messages) ? row.messages as any : []
    const source = msgs.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
    // Reuse existing study generation pipeline
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'openai_not_configured' })
    const oa = new OpenAI({ apiKey })
    const system = 'You are a helpful study assistant. Convert the conversation into study materials in strict JSON.'
    const userPrompt = `Conversation transcript to learn from:\n\n${source}\n\nReturn JSON with keys: guide (markdown), flashcards (array of {front, back}). Keep it concise.`
    const c = await oa.chat.completions.create({ model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini', messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ], temperature: 0.4, max_tokens: 900 })
    const content = c.choices?.[0]?.message?.content || '{}'
    let json: any = {}
    try { json = JSON.parse(content) } catch {
      const m = content.match(/\{[\s\S]*\}/)
      if (m) { try { json = JSON.parse(m[0]) } catch {} }
    }
    const tools: Array<'guide'|'flashcards'> = []
    if (typeof json.guide === 'string' && json.guide.trim()) tools.push('guide')
    if (Array.isArray(json.flashcards) && json.flashcards.length) tools.push('flashcards')
    const study = await (prisma as any).studySet.create({ data: { userId: req.user.id, title, subject: scenario?.title || null, sourceText: source, tools: tools as any, linkedNoteIds: [], content: { guide: json.guide, flashcards: json.flashcards || [] } } })
    // mark session as exported
    try { await (prisma as any).roleplaySession.update({ where: { id }, data: { savedSetId: study.id } }) } catch {}
    res.json({ ok: true, set: study })
  } catch (e) {
    console.error('roleplay_export error', e)
    res.status(500).json({ error: 'export_failed' })
  }
})

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
    select: { id: true, username: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  // Prevent browser/proxy caching so lists are always fresh in admin
  res.set('Cache-Control', 'no-store')
  try {
    const count = Array.isArray(users) ? users.length : 0
    const newest = count ? users[0]?.createdAt : null
    const oldest = count ? users[users.length - 1]?.createdAt : null
    console.log(`[admin/users] count=${count} newest=${newest?.toISOString?.() || newest} oldest=${oldest?.toISOString?.() || oldest}`)
  } catch {}
  res.json(users)
})

// ========================
// AI Boards: CRUD & Agent
// ========================

// Create a board
app.post('/api/boards', requireAuth, async (req: any, res) => {
  try {
    const title = (req.body?.title || 'Untitled Board').toString().slice(0, 120)
    const viewport = { x: 0, y: 0, zoom: 1 }
    const board = await (prisma as any).board.create({ data: { userId: req.user.id, title, viewport } })
    res.json({ board })
  } catch (e) {
    res.status(500).json({ error: 'create_failed' })
  }
})

// List boards
app.get('/api/boards', requireAuth, async (req: any, res) => {
  try {
    const take = Math.min(Math.max(Number(req.query.take || 50), 1), 200)
    const cursor = (req.query.cursor as string | undefined) || undefined
    const items = await (prisma as any).board.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    })
    res.json({ items, nextCursor: items.length === take ? items[items.length - 1]?.id : null })
  } catch (e) {
    res.status(500).json({ error: 'list_failed' })
  }
})

// Get a single board with items/edges
app.get('/api/boards/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const [items, edges] = await Promise.all([
      (prisma as any).boardItem.findMany({ where: { boardId: id } }),
      (prisma as any).boardEdge.findMany({ where: { boardId: id } })
    ])
    res.json({ board, items, edges })
  } catch (e) {
    res.status(500).json({ error: 'read_failed' })
  }
})

// Patch board
app.patch('/api/boards/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const existing = await (prisma as any).board.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const data: any = {}
    if (typeof req.body?.title === 'string') data.title = req.body.title.slice(0, 200)
    if (req.body?.viewport && typeof req.body.viewport === 'object') data.viewport = req.body.viewport
    if (!Object.keys(data).length) return res.status(400).json({ error: 'no_changes' })
    const board = await (prisma as any).board.update({ where: { id }, data })
    res.json({ board })
  } catch (e) {
    res.status(500).json({ error: 'update_failed' })
  }
})

// Delete board
app.delete('/api/boards/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const existing = await (prisma as any).board.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    await (prisma as any).boardEdge.deleteMany({ where: { boardId: id } }).catch(()=>{})
    await (prisma as any).boardItem.deleteMany({ where: { boardId: id } }).catch(()=>{})
    await (prisma as any).board.delete({ where: { id } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'delete_failed' })
  }
})

// Create item
app.post('/api/boards/:id/items', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const body = req.body || {}
    const item = await (prisma as any).boardItem.create({ data: {
      boardId: id,
      type: String(body.type || 'note'),
      x: Number(body.x ?? 0),
      y: Number(body.y ?? 0),
      w: Number(body.w ?? 240),
      h: Number(body.h ?? 120),
      z: Number(body.z ?? 0),
      rotation: Number(body.rotation ?? 0),
      content: body.content || {}
    } })
    res.json({ item })
  } catch (e) {
    res.status(500).json({ error: 'create_failed' })
  }
})

// Patch item
app.patch('/api/boards/:id/items/:itemId', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const itemId = req.params.itemId
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const data: any = {}
    for (const k of ['x','y','w','h','z','rotation']) {
      if (req.body?.[k] != null) data[k] = Number(req.body[k])
    }
    if (req.body?.type) data.type = String(req.body.type)
    if (req.body?.content && typeof req.body.content === 'object') data.content = req.body.content
    if (!Object.keys(data).length) return res.status(400).json({ error: 'no_changes' })
    const item = await (prisma as any).boardItem.update({ where: { id: itemId }, data })
    res.json({ item })
  } catch (e) {
    res.status(500).json({ error: 'update_failed' })
  }
})

// Delete item
app.delete('/api/boards/:id/items/:itemId', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const itemId = req.params.itemId
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    await (prisma as any).boardItem.delete({ where: { id: itemId } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'delete_failed' })
  }
})

// Create edge
app.post('/api/boards/:id/edges', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const body = req.body || {}
    const edge = await (prisma as any).boardEdge.create({ data: { boardId: id, sourceId: String(body.sourceId||''), targetId: String(body.targetId||''), label: typeof body.label==='string'? body.label: null, style: body.style || null } })
    res.json({ edge })
  } catch (e) {
    res.status(500).json({ error: 'create_failed' })
  }
})

// Delete edge
app.delete('/api/boards/:id/edges/:edgeId', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const edgeId = req.params.edgeId
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    await (prisma as any).boardEdge.delete({ where: { id: edgeId } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'delete_failed' })
  }
})

// =====================
// Boards: AI Enhancements
// =====================

// Suggest links between semantically related items
app.post('/api/boards/:id/ai/suggest-links', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })

    const oa = await getOpenAIFromReq(req)
    if (!oa) return res.status(400).json({ error: 'openai_not_configured' })

    const body = req.body || {}
    const itemIds: string[] | undefined = Array.isArray(body.itemIds) ? body.itemIds.filter((x:any)=> typeof x === 'string' && x) : undefined
    const commit = Boolean(body.commit)
    const threshold = Math.max(0, Math.min(1, Number(body.threshold ?? 0.78)))
    const maxPairs = Math.max(1, Math.min(50, Number(body.max ?? 25)))

    const items: any[] = await (prisma as any).boardItem.findMany({ where: { boardId: id, ...(itemIds ? { id: { in: itemIds } } : {}) } })
    if (items.length < 2) return res.json({ suggestions: [], created: [] })

    const texts = items.map(boardItemToText).map(t => t.slice(0, 4000))
    const vecs = await embedTexts(oa, texts)
    const pairs: { sourceId: string; targetId: string; score: number }[] = []
    for (let i=0; i<items.length; i++) {
      for (let j=i+1; j<items.length; j++) {
        const s = vecCosine(vecs[i] as any, vecs[j] as any)
        if (s >= threshold) pairs.push({ sourceId: items[i].id, targetId: items[j].id, score: s })
      }
    }
    pairs.sort((a,b)=> b.score - a.score)
    const suggestions = pairs.slice(0, maxPairs).map(p => ({ sourceId: p.sourceId, targetId: p.targetId, label: p.score.toFixed(2) }))

    const created: any[] = []
    if (commit && suggestions.length) {
      // Deduplicate against existing edges
      const existing = await (prisma as any).boardEdge.findMany({ where: { boardId: id } })
      const exists = new Set(existing.map((e:any)=> `${e.sourceId}::${e.targetId}`))
      for (const s of suggestions) {
        const key1 = `${s.sourceId}::${s.targetId}`
        const key2 = `${s.targetId}::${s.sourceId}`
        if (exists.has(key1) || exists.has(key2)) continue
        try {
          const edge = await (prisma as any).boardEdge.create({ data: { boardId: id, sourceId: s.sourceId, targetId: s.targetId, label: s.label || null, style: null } })
          created.push(edge)
          exists.add(key1)
        } catch {}
        if (created.length >= maxPairs) break
      }
    }
    res.json({ suggestions, created })
  } catch (e) {
    console.error('suggest-links failed', e)
    res.status(500).json({ error: 'suggest_links_failed' })
  }
})

// Cluster items and create group cards; apply simple auto-structurer
app.post('/api/boards/:id/ai/cluster', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const oa = await getOpenAIFromReq(req)
    if (!oa) return res.status(400).json({ error: 'openai_not_configured' })
    const body = req.body || {}
    const itemIds: string[] | undefined = Array.isArray(body.itemIds) ? body.itemIds.filter((x:any)=> typeof x === 'string' && x) : undefined
    const items: any[] = await (prisma as any).boardItem.findMany({ where: { boardId: id, ...(itemIds ? { id: { in: itemIds } } : {}) } })
    const movable = items.filter(it => it.type !== 'group')
    if (movable.length < 2) return res.json({ groups: [], groupItems: [], updatedItems: [] })

    const texts = movable.map(boardItemToText).map(t => t.slice(0, 4000))
    const vecs = await embedTexts(oa, texts)
    const n = movable.length
    const k = Math.min(6, Math.max(2, Math.round(Math.sqrt(n/2))))
    // k-means (basic)
    const dims = (vecs[0] || []).length
    let centroids: number[][] = []
    // init with first k vectors (deterministic)
    for (let i=0; i<k; i++) centroids.push([...vecs[i % n]])
    let assign: number[] = new Array(n).fill(0)
    for (let iter=0; iter<10; iter++) {
      // assign
      for (let i=0; i<n; i++) {
        let best = 0, bestScore = -Infinity
        for (let c=0; c<k; c++) {
          const s = vecCosine(vecs[i] as any, centroids[c] as any)
          if (s > bestScore) { bestScore = s; best = c }
        }
        assign[i] = best
      }
      // recompute centroids
      const sum: number[][] = Array.from({ length: k }, () => new Array(dims).fill(0))
      const count: number[] = new Array(k).fill(0)
      for (let i=0; i<n; i++) {
        const a = assign[i]
        count[a]++
        const v = vecs[i]
        for (let d=0; d<dims; d++) sum[a][d] += v[d]
      }
      for (let c=0; c<k; c++) {
        if (count[c] === 0) continue
        for (let d=0; d<dims; d++) sum[c][d] /= count[c]
      }
      centroids = sum
    }
    // Build clusters
    const clusters: { idx: number; items: any[]; texts: string[] }[] = Array.from({ length: k }, (_, idx) => ({ idx, items: [], texts: [] }))
    for (let i=0; i<n; i++) { const a = assign[i]; clusters[a].items.push(movable[i]); clusters[a].texts.push(texts[i]) }
    // Filter out empties
    const nonEmpty = clusters.filter(c => c.items.length > 0)
    // Fetch recent memory summaries for context (optional)
    let memoryHints: string[] = []
    try {
      const memRows: any[] = await (prisma as any).vectorMemory.findMany({ where: { userId: req.user.id, boardId: id }, orderBy: { createdAt: 'desc' }, take: 12 })
      memoryHints = memRows.map(m => m.summary).filter((s:any)=> typeof s === 'string' && s.trim()).slice(0, 12)
    } catch {}
    const memoryBlock = memoryHints.length ? `\nBoard memory hints:\n${memoryHints.map(t=> '- '+t).join('\n').slice(0, 1200)}` : ''
    // Name clusters via LLM (short titles)
    const titles: string[] = []
    for (const c of nonEmpty) {
      let title = ''
      try {
        const msg = `Return a 2-4 word title that describes this group of notes:\n\n${c.texts.slice(0,10).map(t=> '- '+t).join('\n')}${memoryBlock}`
        const comp = await oa.chat.completions.create({ model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini', temperature: 0.3, max_tokens: 20, messages: [ { role: 'user', content: msg } ] as any })
        title = (comp.choices?.[0]?.message?.content || '').replace(/^[#\s]+/, '').slice(0, 40)
      } catch {}
      titles.push(title || 'Group')
    }
    // Create group items & layout columns
    const colW = 320, colH = 80, colGap = 80, rowGap = 40, startX = 60, startY = 60
    const groupItems: any[] = []
    let colX = startX
    for (let gi=0; gi<nonEmpty.length; gi++) {
      const g = nonEmpty[gi]
      const grp = await (prisma as any).boardItem.create({ data: { boardId: id, type: 'group', x: colX, y: startY, w: colW, h: colH, z: 0, rotation: 0, content: { title: titles[gi] } } })
      groupItems.push(grp)
      colX += colW + colGap
    }
    // Position child items below each group in a column layout
    const updatedItems: any[] = []
    for (let gi=0; gi<nonEmpty.length; gi++) {
      const g = nonEmpty[gi]
      const baseX = groupItems[gi].x
      let y = startY + colH + 20
      for (const it of g.items) {
        const nx = baseX
        const ny = y
        y += (it.h || 120) + rowGap
        if (typeof nx === 'number' && typeof ny === 'number') {
          try {
            const upd = await (prisma as any).boardItem.update({ where: { id: it.id }, data: { x: nx, y: ny } })
            updatedItems.push(upd)
          } catch {}
        }
      }
    }
    const groupsOut = groupItems.map((g, idx) => ({ title: g.content?.title || titles[idx] || 'Group', itemIds: nonEmpty[idx]?.items.map(it=> it.id) || [] }))
    res.json({ groups: groupsOut, groupItems, updatedItems })
  } catch (e) {
    console.error('cluster failed', e)
    res.status(500).json({ error: 'cluster_failed' })
  }
})

// =====================
// Vector Memory API
// =====================

// Upsert (v1: append records; optional server-side embedding if text provided)
app.post('/api/vector-memory/upsert', requireAuth, async (req: any, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) return res.status(400).json({ error: 'invalid_body' })
    const oa = await getOpenAIFromReq(req)
    let created = 0
    for (const it of items) {
      const boardId = String(it.boardId || '')
      if (!boardId) continue
      const text: string | undefined = typeof it.text === 'string' ? it.text : undefined
      let embedding: number[] | undefined = Array.isArray(it.embedding) ? it.embedding : undefined
      if (!embedding && text && oa) {
        try { const r = await oa.embeddings.create({ model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', input: text.slice(0, 8000) }); embedding = (r.data?.[0]?.embedding as any) || undefined } catch {}
      }
      if (!embedding) continue
      try {
        await (prisma as any).vectorMemory.create({ data: {
          userId: req.user.id,
          boardId,
          kind: String(it.kind || 'card'),
          topic: String(it.topic || ''),
          summary: String(it.summary || ''),
          importance: Number(it.importance ?? 0),
          embedding,
          payload: it.payload ?? {}
        } })
        created++
      } catch {}
    }
    res.json({ ok: true, count: created })
  } catch (e) {
    res.status(500).json({ error: 'upsert_failed' })
  }
})

// Search within a board by query text using cosine similarity (naive, in-app)
app.get('/api/vector-memory/search', requireAuth, async (req: any, res) => {
  try {
    const boardId = String(req.query.boardId || req.query.board || '')
    const k = Math.max(1, Math.min(50, Number(req.query.k || 5)))
    const query = String(req.query.query || req.query.q || '')
    if (!boardId || !query) return res.status(400).json({ error: 'invalid_query' })
    const oa = await getOpenAIFromReq(req)
    if (!oa) return res.status(400).json({ error: 'openai_not_configured' })
    const qEmb = await oa.embeddings.create({ model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', input: query.slice(0, 8000) })
    const qv = (qEmb.data?.[0]?.embedding as number[]) || []
    const rows: any[] = await (prisma as any).vectorMemory.findMany({ where: { userId: req.user.id, boardId }, orderBy: { createdAt: 'desc' }, take: 1000 })
    const scored = rows.map(r => ({ row: r, score: vecCosine(qv as any, (r.embedding || []) as any) }))
    scored.sort((a,b)=> b.score - a.score)
    res.json({ items: scored.slice(0, k).map(s => ({ ...s.row, score: s.score })) })
  } catch (e) {
    res.status(500).json({ error: 'search_failed' })
  }
})

// Convenience aliases scoped to board
app.post('/api/boards/:id/memory/upsert', requireAuth, async (req: any, res) => {
  req.body = req.body || {}
  const id = req.params.id
  const items = Array.isArray(req.body.items) ? req.body.items.map((x:any)=> ({ ...x, boardId: id })) : []
  req.body.items = items
  return (app as any).handle?.(req, res) || res.status(500).json({ error: 'router_not_supported' })
})
app.get('/api/boards/:id/memory/search', requireAuth, async (req: any, res) => {
  const id = req.params.id
  const q = req.query.query || req.query.q
  const k = req.query.k
  // Proxy to the generic search endpoint
  ;(req as any).url = `/api/vector-memory/search?boardId=${encodeURIComponent(id)}&query=${encodeURIComponent(String(q||''))}&k=${encodeURIComponent(String(k||5))}`
  return (app as any).handle?.(req, res) || res.status(500).json({ error: 'router_not_supported' })
})

// ==============
// Export helpers
// ==============
app.get('/api/boards/:id/export.json', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const [items, edges] = await Promise.all([
      (prisma as any).boardItem.findMany({ where: { boardId: id } }),
      (prisma as any).boardEdge.findMany({ where: { boardId: id } })
    ])
    res.json({ board, items, edges })
  } catch (e) { res.status(500).json({ error: 'export_failed' }) }
})

// --- AI Actions ---
// Structure board from prompt
app.post('/api/boards/:id/ai/structure', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const prompt = (req.body?.prompt || '').toString().trim()
    if (!prompt) return res.status(400).json({ error: 'missing_prompt' })
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'openai_not_configured' })
    const oa = new OpenAI({ apiKey })
    const system = 'You create a planning board as JSON items: groups (columns) and notes/checklists with concise content and approximate positions (x,y,w,h). Keep values reasonable. '
    const msg = `Topic: ${prompt}. Return an array named items with objects like { type, content, x, y, w, h } where type is 'group'|'note'|'checklist'.`
    const r = await oa.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.2, response_format: { type: 'json_object' } as any, messages: [ { role: 'system', content: system }, { role: 'user', content: msg } ] as any, max_tokens: 900 })
    let out: any = {}
    try { out = JSON.parse(r.choices?.[0]?.message?.content || '{}') } catch {}
    const itemsIn = Array.isArray(out.items) ? out.items : []
    const toCreate = itemsIn.slice(0, 60).map((it: any) => ({
      boardId: id,
      type: typeof it.type === 'string' ? it.type : 'note',
      x: Number(it.x ?? 40), y: Number(it.y ?? 40), w: Number(it.w ?? 240), h: Number(it.h ?? 120), z: 0, rotation: 0,
      content: typeof it.content === 'object' ? it.content : { text: String(it.text || '') }
    }))
    const created: any[] = []
    for (const chunk of toCreate) {
      try { created.push(await (prisma as any).boardItem.create({ data: chunk })) } catch {}
    }
    res.json({ items: created })
  } catch (e) {
    res.status(500).json({ error: 'structure_failed' })
  }
})

// Summarize selection into a note
app.post('/api/boards/:id/ai/summarize', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const itemIds: string[] = Array.isArray(req.body?.itemIds) ? req.body.itemIds.filter((x:any)=> typeof x === 'string' && x) : []
    if (!itemIds.length) return res.status(400).json({ error: 'missing_items' })
    const board = await (prisma as any).board.findUnique({ where: { id } })
    if (!board || board.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const items = await (prisma as any).boardItem.findMany({ where: { boardId: id, id: { in: itemIds } } })
    const text = items.map((it:any)=>{
      const c = it.content || {}
      if (it.type === 'note') return String(c.text || '')
      if (it.type === 'checklist') return (Array.isArray(c.items)? c.items:[]).map((ci:any)=> `- ${ci.text}${ci.done?' [x]':''}`).join('\n')
      if (it.type === 'link') return `${c.title||c.url||''} ${c.desc||''}`
      return ''
    }).filter(Boolean).join('\n')
    if (!text.trim()) return res.status(400).json({ error: 'empty_selection' })
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'openai_not_configured' })
    const oa = new OpenAI({ apiKey })
    const r = await oa.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.2, messages: [
      { role: 'system', content: 'Summarize concisely into 5-8 bullets. Use Markdown.' },
      { role: 'user', content: text.slice(0, 8000) }
    ] as any, max_tokens: 400 })
    const noteText = r.choices?.[0]?.message?.content || ''
    const item = await (prisma as any).boardItem.create({ data: { boardId: id, type: 'note', x: 40, y: 40, w: 320, h: 200, z: 0, rotation: 0, content: { text: noteText } } })
    res.json({ note: { text: noteText }, item })
  } catch (e) {
    res.status(500).json({ error: 'summarize_failed' })
  }
})

// Diagram from selection
app.post('/api/boards/:id/ai/diagram', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const itemIds: string[] = Array.isArray(req.body?.itemIds) ? req.body.itemIds.filter((x:any)=> typeof x === 'string' && x) : []
    const type = (req.body?.type || 'flowchart').toString()
    if (!itemIds.length) return res.status(400).json({ error: 'missing_items' })
    const items = await (prisma as any).boardItem.findMany({ where: { boardId: id, id: { in: itemIds } } })
    const text = items.map((it:any)=>{
      const c = it.content || {}
      if (it.type === 'note') return String(c.text || '')
      if (it.type === 'checklist') return (Array.isArray(c.items)? c.items:[]).map((ci:any)=> ci.text).join('; ')
      if (it.type === 'link') return `${c.title||c.url||''} ${c.desc||''}`
      return ''
    }).filter(Boolean).join('\n')
    // Delegate to existing diagram endpoint
    // We call directly here to avoid extra fetch; replicate implementation
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'openai_not_configured' })
    const oa = new OpenAI({ apiKey })
    const typeInstructions: Record<string, string> = {
      flowchart: 'Create a flowchart diagram showing process flow and decisions.',
      sequence: 'Create a sequence diagram showing interactions over time.',
      class: 'Create a class diagram showing classes and relations.',
      er: 'Create an ER diagram showing entities and relations.',
      state: 'Create a state diagram showing states and transitions.'
    }
    const system = `Generate Mermaid ${type}. ${typeInstructions[type]||''} Return ONLY the diagram code.`
    const completion = await oa.chat.completions.create({ model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini', temperature: 0.3, max_tokens: 500, messages: [ { role: 'system', content: system }, { role: 'user', content: text.slice(0,8000) } ] as any })
    let mermaid = (completion.choices?.[0]?.message?.content || '').trim()
    if (mermaid.startsWith('```')) mermaid = mermaid.replace(/^```mermaid\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim()
    const item = await (prisma as any).boardItem.create({ data: { boardId: id, type: 'note', x: 80, y: 80, w: 360, h: 240, z: 0, rotation: 0, content: { mermaid, type } } })
    res.json({ mermaid, item })
  } catch (e) {
    res.status(500).json({ error: 'diagram_failed' })
  }
})

// Flashcards from selection
app.post('/api/boards/:id/ai/flashcards', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const itemIds: string[] = Array.isArray(req.body?.itemIds) ? req.body.itemIds.filter((x:any)=> typeof x === 'string' && x) : []
    const title = (req.body?.title || '').toString()
    if (!itemIds.length) return res.status(400).json({ error: 'missing_items' })
    const items = await (prisma as any).boardItem.findMany({ where: { boardId: id, id: { in: itemIds } } })
    const text = items.map((it:any)=>{
      const c = it.content || {}
      if (it.type === 'note') return String(c.text || '')
      if (it.type === 'checklist') return (Array.isArray(c.items)? c.items:[]).map((ci:any)=> `- ${ci.text}`).join('\n')
      if (it.type === 'link') return `${c.title||c.url||''} ${c.desc||''}`
      return ''
    }).filter(Boolean).join('\n')
    // Reuse study generator
    const set = await (prisma as any).studySet.create({ data: { userId: req.user.id, title: title || 'Flashcards from Board', subject: 'Board', sourceText: text.slice(0, 20000), tools: ['flashcards'], linkedNoteIds: [], content: {} } })
    // Kick off AI generation similarly to /api/study/generate for flashcards
    // For MVP, we will reuse /api/study/generate in the client instead of server-side to keep consistent behavior
    res.json({ set })
  } catch (e) {
    res.status(500).json({ error: 'flashcards_failed' })
  }
})

// AI Profile (personality) CRUD
app.get('/api/ai/profile', requireAuth, async (req: any, res) => {
  try {
    const row = await (prisma as any).aIProfile.findUnique({ where: { userId: req.user.id } }).catch(()=>null)
    const defaults = { name: 'Default', tone: 'friendly', style: 'concise', emotion: 'calm', ttsVoice: '' }
    if (!row) return res.json(defaults)
    res.json({ name: row.name, tone: row.tone, style: row.style, emotion: row.emotion, ttsVoice: row.ttsVoice })
  } catch { res.status(500).json({ error: 'read_failed' }) }
})
app.post('/api/ai/profile', requireAuth, async (req: any, res) => {
  try {
    const body = req.body || {}
    const patch = {
      name: typeof body.name === 'string' ? body.name.slice(0,60) : undefined,
      tone: typeof body.tone === 'string' ? body.tone.slice(0,40) : undefined,
      style: typeof body.style === 'string' ? body.style.slice(0,40) : undefined,
      emotion: typeof body.emotion === 'string' ? body.emotion.slice(0,40) : undefined,
      ttsVoice: typeof body.ttsVoice === 'string' ? body.ttsVoice.slice(0,80) : undefined,
    }
    const existing = await (prisma as any).aIProfile.findUnique({ where: { userId: req.user.id } }).catch(()=>null)
    if (!existing) await (prisma as any).aIProfile.create({ data: { userId: req.user.id, ...Object.fromEntries(Object.entries(patch).filter(([,v])=> v!==undefined)) } })
    else await (prisma as any).aIProfile.update({ where: { userId: req.user.id }, data: Object.fromEntries(Object.entries(patch).filter(([,v])=> v!==undefined)) })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'save_failed' }) }
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
const openaiEnvClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
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

    // OpenAI cloud STT
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    if (!process.env.OPENAI_API_KEY && !dbKey && !headerKey) return res.status(400).json({ error: 'stt_not_configured' })

    const preferred = (process.env.TRANSCRIBE_MODEL || process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe').trim()
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
      }
    }
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
    res.status(502).json({ error: 'stt_failed', detail, tried: candidates })
  } catch (e) {
    res.status(502).json({ error: 'stt_failed', detail: (e as Error).message })
  }
})

// Jarvis Notes: summarize a transcript into organized notes using OpenAI
app.post('/api/notes/summarize', requireAuth, async (req: any, res) => {
  try {
    const raw = (req.body?.text ?? '').toString()
    const text = raw.trim()
    if (!text) return res.status(400).json({ error: 'missing_text' })

    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'openai_not_configured' })

    // Optional custom instructions and features
    const userPrefsKey = `NOTES_PREFS:${req.user.id}`
    let storedPrefs: any = null
    try {
      const v = await getSettingValue(userPrefsKey)
      storedPrefs = v ? JSON.parse(v) : null
    } catch {}
  const body = req.body || {}
  const customInstructions: string = (body.instructions ?? storedPrefs?.instructions ?? '').toString()
  // Default collapsible to true when not provided anywhere
  const rawCollapsible = (Object.prototype.hasOwnProperty.call(body, 'collapsible') ? body.collapsible : storedPrefs?.collapsible)
  const collapsible: boolean = rawCollapsible === undefined ? true : Boolean(rawCollapsible)
  // Categories: keep existing behavior; default to true if entirely unset
  const rawCategories = (Object.prototype.hasOwnProperty.call(body, 'categories') ? body.categories : storedPrefs?.categories)
  const categories: boolean = rawCategories === undefined ? true : Boolean(rawCategories)

    const oa = new OpenAI({ apiKey })
    const models = ['gpt-4o', 'gpt-4o-mini']
    let lastErr: any = null
    for (const model of models) {
      try {
        // Build guidance text based on features
        const guidanceParts: string[] = []
        if (customInstructions) guidanceParts.push(`User preferences: ${customInstructions}`)
        if (categories) guidanceParts.push('Group content into clear categories with headings.')
        if (collapsible) guidanceParts.push('Use HTML <details><summary>Section</summary>... </details> blocks to make sections collapsible where it improves readability. Keep content valid Markdown/HTML mix.')

        const r = await oa.chat.completions.create({
          model,
          temperature: 0.2,
          max_tokens: 900,
          messages: [
            { role: 'system', content: 'You are an expert summarizer and note‑taker. Convert transcripts or free‑form text into a clear, concise summary. Do not assume it is a meeting—adapt structure to the content. Prefer short paragraphs and bullet points when helpful. Use valid Markdown. If you include collapsible sections (e.g., <details>), keep them minimal and valid.' },
            { role: 'user', content: `Transcript:\n\n${text}\n\nProduce a concise, general‑purpose summary. If useful, organize with headings like “Highlights” and “Key Points”. Only include To‑Dos with checkboxes when the text explicitly contains tasks; do not fabricate tasks or attendees. Avoid meeting‑specific framing unless clearly stated. ${guidanceParts.length ? '\n\nAdditional guidance:\n- ' + guidanceParts.join('\n- ') : ''} Do not invent details.` }
          ] as any
        })
        const notes = r.choices?.[0]?.message?.content?.toString() || ''
        return res.json({ notes, model })
      } catch (e) {
        lastErr = e
      }
    }
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
    return res.status(502).json({ error: 'summarize_failed', detail })
  } catch (e) {
    return res.status(500).json({ error: 'unexpected_error' })
  }
})

// Notes settings (per-user) stored in Setting as NOTES_PREFS:<userId>
app.get('/api/notes/settings', requireAuth, async (req: any, res) => {
  try {
    const key = `NOTES_PREFS:${req.user.id}`
    let prefs = { instructions: '', collapsible: true, categories: true, icon: 'triangle', color: 'slate', expandAll: false, expandCategories: false }
    const v = await getSettingValue(key)
    if (v) {
      try { prefs = { ...prefs, ...(JSON.parse(v) || {}) } } catch {}
    }
    res.json(prefs)
  } catch {
    res.status(500).json({ error: 'read_failed' })
  }
})
app.post('/api/notes/settings', requireAuth, async (req: any, res) => {
  try {
    const body = req.body || {}
    const instructions = typeof body.instructions === 'string' ? body.instructions : ''
    const collapsible = Boolean(body.collapsible)
    const categories = Boolean(body.categories)
    const iconRaw = (typeof body.icon === 'string' ? body.icon : 'triangle').toLowerCase()
    const colorRaw = (typeof body.color === 'string' ? body.color : 'slate').toLowerCase()
    const expandAll = Boolean(body.expandAll)
    const expandCategories = Boolean(body.expandCategories)
    const icon = ['triangle','chevron','plusminus'].includes(iconRaw) ? iconRaw : 'triangle'
    const color = ['slate','blue','emerald','amber','rose'].includes(colorRaw) ? colorRaw : 'slate'
    const key = `NOTES_PREFS:${req.user.id}`
    const payload = JSON.stringify({ instructions, collapsible, categories, icon, color, expandAll, expandCategories })
    await setSettingValue(key, payload)
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'save_failed' })
  }
})

// Jarvis Notes persistence APIs
// Create a note (transcript + notes). Returns created note.
app.post('/api/notes', requireAuth, async (req: any, res) => {
  try {
    const body = req.body || {}
    const transcript = (body.transcript || '').toString()
    const notes = (body.notes || '').toString()
    const title = typeof body.title === 'string' ? body.title : ''
    const pinned = Boolean(body.pinned)
    if (!transcript && !notes) return res.status(400).json({ error: 'missing_fields' })
    const row = await (prisma as any).note.create({ data: { userId: req.user.id, transcript, notes, title, pinned } })
    res.json({ ok: true, note: row })
  } catch (e) {
    res.status(500).json({ error: 'create_failed' })
  }
})

// List notes with optional text search and cursor pagination
// Query: ?query=...&take=50&cursor=<id>
app.get('/api/notes', requireAuth, async (req: any, res) => {
  try {
    const take = Math.min(Math.max(Number(req.query.take || 50), 1), 200)
    const cursor = (req.query.cursor as string | undefined) || undefined
    const q = ((req.query.query as string | undefined) || '').trim()
    const pinnedOnly = (req.query.pinned as string | undefined)?.toLowerCase() === 'true'
    const where: any = { userId: req.user.id }
    if (pinnedOnly) where.pinned = true
    if (q) {
      // Basic contains search across transcript and notes (case-insensitive)
      where.OR = [
        { transcript: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
      ]
    }
    // Sort pinned first, then most recent
    const items = await (prisma as any).note.findMany({
      where,
      orderBy: [ { pinned: 'desc' }, { createdAt: 'desc' } ],
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    })
    res.json({ items, nextCursor: items.length === take ? items[items.length - 1]?.id : null })
  } catch (e) {
    res.status(500).json({ error: 'list_failed' })
  }
})

// Update a note (partial: transcript/notes)
app.patch('/api/notes/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    if (!id) return res.status(400).json({ error: 'missing_id' })
    const body = req.body || {}
    const data: any = {}
    if (typeof body.transcript === 'string') data.transcript = body.transcript
    if (typeof body.notes === 'string') data.notes = body.notes
    if (typeof body.title === 'string') data.title = body.title
    if (typeof body.pinned === 'boolean') data.pinned = body.pinned
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'nothing_to_update' })
    // Ensure ownership
    const existing = await (prisma as any).note.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const row = await (prisma as any).note.update({ where: { id }, data })
    res.json({ ok: true, note: row })
  } catch (e) {
    res.status(500).json({ error: 'update_failed' })
  }
})

// Delete a single note
app.delete('/api/notes/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    if (!id) return res.status(400).json({ error: 'missing_id' })
    const existing = await (prisma as any).note.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    await (prisma as any).note.delete({ where: { id } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'delete_failed' })
  }
})

// Clear all notes for current user
app.delete('/api/notes', requireAuth, async (req: any, res) => {
  try {
    await (prisma as any).note.deleteMany({ where: { userId: req.user.id } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'clear_failed' })
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

    // Expressive controls via headers
    const hStab = Number((req.headers['x-el-stability'] as string | undefined) || '')
    const hSim  = Number((req.headers['x-el-similarity'] as string | undefined) || '')
    const hStyle= Number((req.headers['x-el-style'] as string | undefined) || '')
    const hBoost= ((req.headers['x-el-boost'] as string | undefined) || '').toString().toLowerCase()
    const stability = Number.isFinite(hStab) ? Math.max(0, Math.min(1, hStab)) : 0.5
    const similarity_boost = Number.isFinite(hSim) ? Math.max(0, Math.min(1, hSim)) : 0.7
    const style = Number.isFinite(hStyle) ? Math.max(0, Math.min(1, hStyle)) : undefined
    const use_speaker_boost = hBoost === '1' || hBoost === 'true'

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
  'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: Object.assign(
          { stability, similarity_boost },
          (typeof style === 'number' ? { style } : {}),
          (use_speaker_boost ? { use_speaker_boost: true } : {})
        )
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

    // Expressive controls via query
    const qStab = Number((req.query.stability as string | undefined) || '')
    const qSim  = Number((req.query.similarity as string | undefined) || '')
    const qStyle= Number((req.query.style as string | undefined) || '')
    const qBoost= ((req.query.boost as string | undefined) || '').toString().toLowerCase()
    const stability = Number.isFinite(qStab) ? Math.max(0, Math.min(1, qStab)) : 0.5
    const similarity_boost = Number.isFinite(qSim) ? Math.max(0, Math.min(1, qSim)) : 0.7
    const style = Number.isFinite(qStyle) ? Math.max(0, Math.min(1, qStyle)) : undefined
    const use_speaker_boost = qBoost === '1' || qBoost === 'true'

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
        voice_settings: Object.assign(
          { stability, similarity_boost },
          (typeof style === 'number' ? { style } : {}),
          (use_speaker_boost ? { use_speaker_boost: true } : {})
        )
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

// Fallback TTS using eSpeak-NG (lightweight, open-source)
app.post('/api/tts/fallback', requireAuth, async (req: any, res) => {
  try {
    const { text, voice, rate } = req.body || {}
    if (!text) return res.status(400).json({ error: 'missing_text' })

    // Map UI voice codes to pico languages
    const lang = String(voice || '').trim() || 'en-US'
    const langMap: Record<string, string> = {
      'en': 'en-US',
      'en-US': 'en-US',
      'en-GB': 'en-GB',
      'de-DE': 'de-DE',
      'es-ES': 'es-ES',
      'fr-FR': 'fr-FR',
      'it-IT': 'it-IT'
    }
    const picoLang = langMap[lang] || 'en-US'

    // Rate mapping: UI 0.5..1.5 -> sox tempo 0.5..1.5 (tempo changes speed without pitch)
    let tempo = Number(rate)
    if (!Number.isFinite(tempo)) tempo = 0.85
    tempo = Math.max(0.5, Math.min(1.5, tempo))

    // Use espeak-ng to generate WAV to stdout with language, then sox to adjust tempo (speed without pitch), then lame to MP3
    // Map picoLang to closest espeak voice code
    const espeakVoiceMap: Record<string, string> = {
      'en-US': 'en-us',
      'en-GB': 'en-gb',
      'de-DE': 'de',
      'es-ES': 'es',
      'fr-FR': 'fr',
      'it-IT': 'it'
    }
    const espeakVoice = espeakVoiceMap[picoLang] || 'en-us'
    // espeak-ng default wpm ~ 160; keep constant and use sox tempo instead
    const espeak = spawn('espeak-ng', [
      '--stdout',
      '-v', espeakVoice,
      '-s', '160',
      text
    ])
    const sox = spawn('sox', [
      '-t', 'wav', '-',
      '-t', 'wav', '-',
      'tempo', tempo.toFixed(2)
    ])
    const lame = spawn('lame', [
      '-r', '--preset', 'voice', '-', '-'
    ])

    espeak.on('error', (err) => { console.error('espeak-ng error:', err); if (!res.headersSent) res.status(500).json({ error: 'tts_failed' }) })
    sox.on('error', (err) => { console.error('sox error:', err); if (!res.headersSent) res.status(500).json({ error: 'tts_failed' }) })
    lame.on('error', (err) => { console.error('lame error:', err); if (!res.headersSent) res.status(500).json({ error: 'tts_failed' }) })

    res.setHeader('Content-Type', 'audio/mpeg')
    espeak.stdout.pipe(sox.stdin)
    sox.stdout.pipe(lame.stdin)
    lame.stdout.pipe(res)
  } catch (e) {
    console.error('Fallback TTS error:', e)
    if (!res.headersSent) res.status(500).json({ error: 'tts_failed' })
  }
})

// ==========================
// Diagram Generation (Mermaid)
// ==========================
app.post('/api/diagram', requireAuth, async (req: any, res) => {
  try {
    const { text, type } = req.body || {}
    if (!text || !type) return res.status(400).json({ error: 'missing_fields' })
    
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'openai_not_configured' })
    
    const oa = new OpenAI({ apiKey })
    
    // Build system prompt based on diagram type
    const typeInstructions: Record<string, string> = {
      flowchart: 'Create a flowchart diagram showing process flow and decision points.',
      sequence: 'Create a sequence diagram showing interactions between actors/components over time.',
      class: 'Create a class diagram showing classes, attributes, methods, and relationships.',
      er: 'Create an entity-relationship diagram showing database entities and relationships.',
      state: 'Create a state diagram showing states and transitions.'
    }
    
    const system = `You are a diagram generation assistant. Based on the provided text, generate a valid Mermaid.js ${type} diagram.
${typeInstructions[type] || 'Create an appropriate diagram.'}

Return ONLY the Mermaid diagram code, no explanations or markdown code blocks. Start directly with the diagram type keyword (e.g., "flowchart TD", "sequenceDiagram", "classDiagram", "erDiagram", "stateDiagram-v2").

Keep it simple and clear. Use meaningful labels. Ensure all syntax is valid Mermaid.js.`
    
    const userPrompt = `Generate a ${type} diagram for:\n\n${text}`
    
    const completion = await oa.chat.completions.create({
      model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 500
    })
    
    let mermaid = (completion.choices?.[0]?.message?.content || '').trim()
    
    // Clean up common issues
    if (mermaid.startsWith('```mermaid')) {
      mermaid = mermaid.replace(/^```mermaid\n?/, '').replace(/\n?```$/, '').trim()
    } else if (mermaid.startsWith('```')) {
      mermaid = mermaid.replace(/^```\n?/, '').replace(/\n?```$/, '').trim()
    }
    
    res.json({ mermaid, type })
  } catch (e) {
    console.error('Diagram generation error:', e)
    res.status(500).json({ error: 'diagram_failed', detail: (e as Error).message })
  }
})

// ==========================
// Study Tools: generation & grading
// ==========================
type StudyGenerateBody = {
  subject?: string
  info?: string
  noteIds?: string[]
  tools?: Array<'guide' | 'flashcards' | 'test' | 'match'>
  title?: string
  sourceGuideId?: string
  adapt?: { focusSectionIds?: string[]; difficultyWeight?: Record<string, number> }
}

// Helper: fetch notes by ids for current user and concatenate their content
async function getNotesTextForUser(userId: string, noteIds: string[] | undefined): Promise<string> {
  if (!noteIds || noteIds.length === 0) return ''
  try {
    const items = await (prisma as any).note.findMany({
      where: { userId, id: { in: noteIds } },
      select: { transcript: true, notes: true, title: true }
    })
    return items.map((n: any) => `Title: ${n.title || ''}\nTranscript: ${n.transcript || ''}\nNotes: ${n.notes || ''}`).join('\n\n')
  } catch {
    return ''
  }
}

// Simple fallback generators when OpenAI is not configured
function truncate(str: string, max: number): string {
  if (!str) return ''
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}
function splitSentences(text: string): string[] {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s.trim())
    .filter(Boolean)
}
function extractTermPairs(text: string): Array<{ left: string; right: string }> {
  const pairs: Array<{ left: string; right: string }> = []
  for (const line of (text || '').split(/\n+/)) {
    const m = line.match(/^\s*([^:]{2,}):\s*(.+)$/)
    if (m) pairs.push({ left: m[1].trim(), right: m[2].trim() })
  }
  return pairs
}
function buildSimpleGuide(subject: string, info: string, notesText: string): string {
  const base = (info || notesText || '').trim()
  const subjectLine = subject ? `Subject: ${subject}` : ''
  const overview = [subjectLine, truncate(base, 1200)].filter(Boolean).join('\n\n')
  const sentences = splitSentences(base)
  const keyPoints = sentences.slice(0, 8).map(s => `- ${truncate(s, 180)}`).join('\n')
  const questions = [
    subject ? `- What is ${subject}?` : '- What are the core ideas?',
    '- Can you explain the key terms?',
    '- Provide a real-world example.',
    '- Summarize the topic in 2-3 sentences.'
  ].join('\n')
  const summary = truncate(sentences.slice(0, 3).join(' '), 600)
  return [
    '---SECTION---',
    '# Overview',
    overview,
    '',
    '---SECTION---',
    '# Key Concepts',
    keyPoints || '- (Add more details in your notes)',
    '',
    '---SECTION---',
    '# Practice Questions',
    questions,
    '',
    '---SECTION---',
    '# Summary',
    summary || 'This guide was generated using a local fallback. Add specifics as needed.'
  ].join('\n')
}
function buildSimpleFlashcards(subject: string, info: string, notesText: string, target = 12): Array<{ front: string; back: string }> {
  const cards: Array<{ front: string; back: string }> = []
  const pairs = extractTermPairs(info + '\n' + notesText)
  for (const p of pairs) {
    if (cards.length >= target) break
    cards.push({ front: p.left, back: p.right })
  }
  if (cards.length < Math.max(6, Math.floor(target / 2))) {
    // Fallback: derive Q&A from sentences
    const sentences = splitSentences(info || notesText)
    for (const s of sentences) {
      if (cards.length >= target) break
      const q = subject ? `What about ${subject}:` : 'Explain:'
      cards.push({ front: `${q} ${truncate(s, 120)}`, back: s })
    }
  }
  // Ensure minimal number
  while (cards.length < Math.min(target, 12)) {
    const idx = cards.length + 1
    cards.push({ front: subject ? `${subject} – Fact ${idx}` : `Key Fact ${idx}`, back: 'Add your own detail here.' })
  }
  return cards.slice(0, target)
}
function buildSimpleTest(subject: string, info: string, notesText: string, count = 8): Array<{ question: string; choices: string[]; answerIndex: number }> {
  const out: Array<{ question: string; choices: string[]; answerIndex: number }> = []
  const sentences = splitSentences(info || notesText)
  const baseQ = subject ? `${subject}:` : 'Topic'
  for (let i = 0; i < Math.min(count, sentences.length); i++) {
    const s = truncate(sentences[i], 140)
    const correct = s
    const wrongs = [
      'Not applicable',
      'Unrelated detail',
      'All of the above'
    ]
    const choices = [correct, ...wrongs].slice(0, 4)
    out.push({ question: `Which is true about ${baseQ}`, choices, answerIndex: 0 })
  }
  while (out.length < count) {
    const idx = out.length + 1
    out.push({ question: `Select the accurate statement (${idx})`, choices: ['Placeholder A', 'Placeholder B', 'Placeholder C', 'Placeholder D'], answerIndex: 0 })
  }
  return out
}
function buildSimpleMatch(subject: string, info: string, notesText: string, count = 10): Array<{ left: string; right: string }> {
  const pairs = extractTermPairs(info + '\n' + notesText)
  if (pairs.length >= 4) return pairs.slice(0, count)
  const out: Array<{ left: string; right: string }> = []
  const sentences = splitSentences(info || notesText)
  for (let i = 0; i < Math.min(count, sentences.length); i++) {
    out.push({ left: subject ? `${subject} ${i + 1}` : `Item ${i + 1}`, right: truncate(sentences[i], 120) })
  }
  while (out.length < Math.min(count, 10)) out.push({ left: `Term ${out.length + 1}`, right: 'Definition placeholder' })
  return out
}

// POST /api/study/generate -> creates a StudySet row
app.post('/api/study/generate', requireAuth, async (req: any, res) => {
  try {
    const body: StudyGenerateBody = req.body || {}
    const subject = (body.subject || '').toString().trim()
    const info = (body.info || '').toString().trim()
    const noteIds = Array.isArray(body.noteIds) ? body.noteIds.filter(x => typeof x === 'string' && x) : []
    const tools: Array<'guide'|'flashcards'|'test'|'match'> = (Array.isArray(body.tools) && body.tools.length ? body.tools : ['guide', 'flashcards']).filter(Boolean) as any
    const title = (body.title || subject || (info ? info.slice(0, 60) : '') || 'Study Set').toString()
    const sourceGuideId = (body.sourceGuideId || '').toString().trim() || undefined
    const adapt = body.adapt || undefined

    // Compose source text from provided info and selected notes
    const notesText = await getNotesTextForUser(req.user.id, noteIds)
    const source = [
      subject ? `Subject: ${subject}` : '',
      info ? `Info:\n${info}` : '',
      notesText ? `Linked Notes:\n${notesText}` : ''
    ].filter(Boolean).join('\n\n').trim()
    if (!source) return res.status(400).json({ error: 'missing_input' })

    // OpenAI key resolution
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY

    // Build instructions for generation
    const wantGuide = tools.includes('guide')
    const wantFlash = tools.includes('flashcards')
    const wantTest = tools.includes('test')
    const wantMatch = tools.includes('match')

    // Fallback path: if no API key, generate a simple local study set instead of failing
    if (!apiKey) {
      const content: any = {}
      if (wantGuide) content.guide = buildSimpleGuide(subject, info, notesText)
      if (wantFlash) content.flashcards = buildSimpleFlashcards(subject, info, notesText, 12)
      if (wantTest) content.test = buildSimpleTest(subject, info, notesText, 8)
      if (wantMatch) content.match = buildSimpleMatch(subject, info, notesText, 10)

      // Save StudySet with fallback content
      const row = await (prisma as any).studySet.create({
        data: {
          userId: req.user.id,
          title,
          subject: subject || null,
          sourceText: source,
          tools: tools as any,
          linkedNoteIds: noteIds,
          content
        }
      })
      return res.json({ ok: true, set: row, warning: 'openai_not_configured_fallback' })
    }

    const oa = new OpenAI({ apiKey })
    const system = 'You are a helpful study assistant. Given source material, produce structured study artifacts in strict JSON. Do not include explanations outside of JSON.'
  const userPrompt = `Source material:\n\n${source}\n\nProduce a JSON object with up to these keys depending on the request: guide, flashcards, test, match.\n- guide: markdown string. MUST use explicit section markers of the form:\n---SECTION---\n# Title of Section\nContent...\nEach major section MUST begin with the line ---SECTION--- followed by a level-1 heading (#). Provide logical sections (Introduction, Key Concepts, Practical Examples, Practice Questions, Summary, etc.) so a parser can split on the markers easily.\n- flashcards: array of { front: string, back: string }. 12-30 cards depending on material.\n- test: array of multiple-choice questions; each as { question: string, choices: string[4], answerIndex: 0-3 }. 8-20 questions.\n- match: array of pairs { left: string, right: string } for term-definition matching (8-20 pairs).\nKeep content appropriate and based only on provided material. Avoid fabricating details.`
    const toolList = [ wantGuide && 'guide', wantFlash && 'flashcards', wantTest && 'test', wantMatch && 'match' ].filter(Boolean).join(', ')
    let assistantHint = `Requested sections: ${toolList}. Return strictly valid JSON with only those keys.`
    if (adapt) {
      const focus = Array.isArray(adapt.focusSectionIds) && adapt.focusSectionIds.length ? `Focus more on these sections: ${adapt.focusSectionIds.join(', ')}.` : ''
      const diff = adapt.difficultyWeight && Object.keys(adapt.difficultyWeight).length ? `Adjust difficulty distribution using weights ${JSON.stringify(adapt.difficultyWeight)}.` : ''
      if (focus || diff) assistantHint += ` ${focus} ${diff}`.trim()
    }
    // Try gpt-4o then gpt-4o-mini
    const models = ['gpt-4o', 'gpt-4o-mini']
    let json: any = null
    let lastErr: any = null
    for (const model of models) {
      try {
        const r = await oa.chat.completions.create({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: assistantHint }
          ] as any,
          response_format: { type: 'json_object' } as any,
          max_tokens: 1400
        })
        const txt = r.choices?.[0]?.message?.content?.toString() || '{}'
        json = JSON.parse(txt)
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (!json) return res.status(502).json({ error: 'generate_failed', detail: lastErr instanceof Error ? lastErr.message : String(lastErr) })

    // Validate minimal shape
    const content: any = {}
    if (wantGuide && typeof json.guide === 'string') content.guide = json.guide
    if (wantFlash && Array.isArray(json.flashcards)) content.flashcards = json.flashcards.map((c: any) => ({ front: String(c.front || ''), back: String(c.back || '') })).filter((c: any) => c.front && c.back)
    if (wantTest && Array.isArray(json.test)) content.test = json.test.map((q: any) => ({
      question: String(q.question || ''),
      choices: Array.isArray(q.choices) ? q.choices.map((x: any) => String(x)) : [],
      answerIndex: Number.isFinite(q.answerIndex) ? Number(q.answerIndex) : 0
    })).filter((q: any) => q.question && Array.isArray(q.choices) && q.choices.length >= 2)
    if (wantMatch && Array.isArray(json.match)) content.match = json.match.map((p: any) => ({ left: String(p.left || ''), right: String(p.right || '') })).filter((p: any) => p.left && p.right)

    // Save StudySet
    // If sourceGuideId provided, ensure it belongs to the same user; otherwise ignore
    let validSourceGuideId: string | undefined = undefined
    if (sourceGuideId) {
      try {
        const src = await (prisma as any).studySet.findUnique({ where: { id: sourceGuideId } })
        if (src && src.userId === req.user.id) validSourceGuideId = sourceGuideId
      } catch {}
    }

    const row = await (prisma as any).studySet.create({
      data: {
        userId: req.user.id,
        title,
        subject: subject || null,
        sourceText: source,
        tools: tools as any,
        linkedNoteIds: noteIds,
        content,
        ...(validSourceGuideId ? { sourceGuideId: validSourceGuideId } : {})
      }
    })
    res.json({ ok: true, set: row })
  } catch (e) {
    res.status(500).json({ error: 'generate_failed' })
  }
})

// Patch study set (limited): allow updating content.guide and title
app.patch('/api/study/sets/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const row = await (prisma as any).studySet.findUnique({ where: { id } })
    if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    const data: any = {}
    if (req.body?.title && typeof req.body.title === 'string') data.title = req.body.title
    if (req.body?.content && typeof req.body.content === 'object') {
      const content = row.content || {}
      const patch = req.body.content
      // Only allow guide string update for now
      if (typeof patch.guide === 'string') content.guide = patch.guide
      data.content = content
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'no_changes' })
    const updated = await (prisma as any).studySet.update({ where: { id }, data })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: 'update_failed' })
  }
})


// --- Study Progress Endpoints ---
// Get progress for a study set
app.get('/api/study/progress/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const row = await (prisma as any).studyProgress.findUnique({ where: { userId_studySetId: { userId: req.user.id, studySetId: id } } })
    res.json({ ok: true, progress: row || null })
  } catch (e) {
    res.status(500).json({ error: 'progress_get_failed' })
  }
})

// Patch progress (add section completion)
app.post('/api/study/progress/:id/complete', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const sectionId = (req.body?.sectionId || '').toString().trim()
    const addMinutes = Number(req.body?.addMinutes || 0)
    if (!sectionId) return res.status(400).json({ error: 'missing_section' })
    let progress = await (prisma as any).studyProgress.findUnique({ where: { userId_studySetId: { userId: req.user.id, studySetId: id } } })
    if (!progress) {
      progress = await (prisma as any).studyProgress.create({ data: { userId: req.user.id, studySetId: id, sectionsCompleted: [sectionId], timeSpent: Math.max(0, addMinutes) } })
    } else if (!progress.sectionsCompleted.includes(sectionId)) {
      progress = await (prisma as any).studyProgress.update({ where: { userId_studySetId: { userId: req.user.id, studySetId: id } }, data: { sectionsCompleted: [...progress.sectionsCompleted, sectionId], timeSpent: progress.timeSpent + Math.max(0, addMinutes) } })
    }
    res.json({ ok: true, progress })
  } catch (e) {
    res.status(500).json({ error: 'progress_update_failed' })
  }
})

// Replace full progress (e.g. future time tracking)
app.put('/api/study/progress/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const sectionsCompleted: string[] = Array.isArray(req.body?.sectionsCompleted) ? req.body.sectionsCompleted.filter((x: any)=> typeof x === 'string' && x) : []
    const timeSpent = Number.isFinite(req.body?.timeSpent) ? Math.max(0, Number(req.body.timeSpent)) : undefined
    const bookmarks: string[] = Array.isArray(req.body?.bookmarks) ? req.body.bookmarks.filter((x:any)=> typeof x === 'string' && x) : undefined
    let progress = await (prisma as any).studyProgress.findUnique({ where: { userId_studySetId: { userId: req.user.id, studySetId: id } } })
    if (!progress) {
      progress = await (prisma as any).studyProgress.create({ data: { userId: req.user.id, studySetId: id, sectionsCompleted, timeSpent: timeSpent ?? 0, bookmarks: bookmarks || [] } })
    } else {
      progress = await (prisma as any).studyProgress.update({ where: { userId_studySetId: { userId: req.user.id, studySetId: id } }, data: { sectionsCompleted, ...(timeSpent != null ? { timeSpent } : {}), ...(bookmarks ? { bookmarks } : {}) } })
    }
    res.json({ ok: true, progress })
  } catch (e) {
    res.status(500).json({ error: 'progress_replace_failed' })
  }
})

// Toggle bookmark for a section
app.post('/api/study/progress/:id/bookmark/:sectionId', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const sectionId = (req.params.sectionId || '').toString().trim()
    if (!sectionId) return res.status(400).json({ error: 'missing_section' })
    let progress = await (prisma as any).studyProgress.findUnique({ where: { userId_studySetId: { userId: req.user.id, studySetId: id } } })
    if (!progress) {
      progress = await (prisma as any).studyProgress.create({ data: { userId: req.user.id, studySetId: id, sectionsCompleted: [], bookmarks: [sectionId] } })
    } else {
      const set = new Set(progress.bookmarks || [])
  if (set.has(sectionId)) { set.delete(sectionId) } else { set.add(sectionId) }
      progress = await (prisma as any).studyProgress.update({ where: { userId_studySetId: { userId: req.user.id, studySetId: id } }, data: { bookmarks: Array.from(set) } })
    }
    res.json({ ok: true, progress })
  } catch (e) {
    res.status(500).json({ error: 'bookmark_toggle_failed' })
  }
})

// List study sets for current user
app.get('/api/study/sets', requireAuth, async (req: any, res) => {
  try {
    const take = Math.min(Math.max(Number(req.query.take || 50), 1), 200)
    const cursor = (req.query.cursor as string | undefined) || undefined
    const where: any = { userId: req.user.id }
    const items = await (prisma as any).studySet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    })
    res.json({ items, nextCursor: items.length === take ? items[items.length - 1]?.id : null })
  } catch {
    res.status(500).json({ error: 'list_failed' })
  }
})

// Get a single set (ownership enforced)
app.get('/api/study/sets/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const row = await (prisma as any).studySet.findUnique({ where: { id } })
    if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    res.json(row)
  } catch {
    res.status(500).json({ error: 'read_failed' })
  }
})

// Get sets derived from a source guide (reverse link)
app.get('/api/study/sets/:id/derived', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const items = await (prisma as any).studySet.findMany({ where: { userId: req.user.id, sourceGuideId: id }, orderBy: { createdAt: 'desc' }, take: 50 })
    res.json({ items })
  } catch {
    res.status(500).json({ error: 'derived_failed' })
  }
})

// Delete a set
app.delete('/api/study/sets/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const row = await (prisma as any).studySet.findUnique({ where: { id } })
    if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    await (prisma as any).studySet.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'delete_failed' })
  }
})

// Build a simple knowledge graph for the current user
// Nodes: StudySets and linked Notes; Edges: Set -> Note
app.get('/api/graph', requireAuth, async (req: any, res) => {
  try {
    const sets = await (prisma as any).studySet.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 200 })
    const noteIdSet = new Set<string>()
    for (const s of sets) {
      if (Array.isArray(s.linkedNoteIds)) for (const nid of s.linkedNoteIds) if (nid) noteIdSet.add(String(nid))
    }
    const noteIds = Array.from(noteIdSet)
    const notes = noteIds.length ? await (prisma as any).note.findMany({ where: { userId: req.user.id, id: { in: noteIds } }, select: { id: true, title: true, createdAt: true } }) : []
    const noteMap = new Map(notes.map((n: any) => [n.id, n]))

  const nodes: any[] = []
  const edges: any[] = []
    for (const s of sets) {
      nodes.push({ id: `set:${s.id}`, rawId: s.id, type: 'studyset', label: s.title || s.subject || 'Study Set', createdAt: s.createdAt })
      if (Array.isArray(s.linkedNoteIds)) {
        for (const nid of s.linkedNoteIds) {
          if (!nid) continue
          const n: any = noteMap.get(String(nid)) as any
          if (n && !nodes.find((x: any) => x.id === `note:${n.id}`)) {
            nodes.push({ id: `note:${n.id}`, rawId: n.id, type: 'note', label: n.title || 'Note', createdAt: n.createdAt })
          }
          if (n) edges.push({ source: `set:${s.id}`, target: `note:${n.id}`, kind: 'links' })
        }
      }
    }
    res.json({ nodes, edges, counts: { sets: sets.length, notes: notes.length, edges: edges.length } })
  } catch (e) {
    res.status(500).json({ error: 'graph_failed' })
  }
})

// --- Study Set Sharing (ephemeral, in-memory registry) ---
const sharedSets = new Map<string, any>() // id -> { set, user, ts }
const sharedIndex: Array<{ id: string, title: string, subject?: string, user: string, ts: number }> = []
// --- Live Quiz Sessions (ephemeral, in-memory rooms) ---
type QuizMode = 'classic' | 'gold' | 'royale'
type QuizUser = { name: string, score: number, gold?: number, lives?: number, eliminated?: boolean }
type QuizRoom = {
  host: string
  hostName: string
  setId: string
  mode: QuizMode
  royaleLives: number
  goldStealChance: number
  questions: any[]
  answers: Record<string, number[]>
  users: Map<string, QuizUser>
  started: boolean
  current: number
  phase: 'lobby' | 'question' | 'reveal' | 'ended'
  questionTime: number // seconds
  endsAt?: number
  timer?: NodeJS.Timeout
  ws: Set<WebSocket>
  rounds: Array<{ index: number, question: string, choices: string[], correctIndex: number, counts: number[], steals?: Array<{from:string,to:string,amount:number}>, eliminated?: string[] }>
}

const quizRooms = new Map<string, QuizRoom>()

async function getQuizQuestions(setId: string) {
  const set = await (prisma as any).studySet.findUnique({ where: { id: setId } })
  if (!set || !set.content?.test || !Array.isArray(set.content.test)) return []
  // Strip answerIndex when sending to clients until reveal
  return set.content.test
}

function quizBroadcast(room: QuizRoom, msg: any) {
  const data = JSON.stringify(msg)
  for (const w of room.ws) {
    try { if ((w as any).readyState === 1) (w as any).send(data) } catch { /* no-op */ }
  }
}

function quizState(roomId: string): any {
  const room = quizRooms.get(roomId)
  if (!room) return null
  const participants = Array.from(room.users.entries()).map(([id, u]) => ({ id, name: u.name, score: u.score, gold: u.gold ?? 0, lives: u.lives ?? null, eliminated: !!u.eliminated }))
  return {
    type: 'state',
    roomId,
    host: room.host,
    hostName: room.hostName,
    setId: room.setId,
    mode: room.mode,
    started: room.started,
    phase: room.phase,
    current: room.current,
    questionCount: room.questions.length,
    participants,
    endsAt: room.endsAt || null
  }
}

function startQuestion(roomId: string, index: number) {
  const room = quizRooms.get(roomId)
  if (!room) return
  if (room.timer) { clearTimeout(room.timer); room.timer = undefined }
  if (index >= room.questions.length) return endQuiz(roomId)
  room.started = true
  room.phase = 'question'
  room.current = index
  room.endsAt = Date.now() + room.questionTime * 1000
  // Broadcast question without answerIndex
  const q = room.questions[index]
  const safeQ = { question: q.question, choices: q.choices }
  quizBroadcast(room, { type: 'start', current: index, question: safeQ, endsAt: room.endsAt, mode: room.mode })
  quizBroadcast(room, quizState(roomId))
  // Auto-reveal when timer expires
  room.timer = setTimeout(() => revealQuestion(roomId), room.questionTime * 1000)
}

function revealQuestion(roomId: string) {
  const room = quizRooms.get(roomId)
  if (!room) return
  if (room.timer) { clearTimeout(room.timer); room.timer = undefined }
  room.phase = 'reveal'
  const q = room.questions[room.current]
  const correct = Number(q.answerIndex || 0)
  const counts = new Array(q.choices.length).fill(0)
  // Mode-specific scoring and effects
  const steals: Array<{ from: string, to: string, amount: number }> = []
  const eliminatedThisRound: string[] = []
  const usersEntries = Array.from(room.users.entries())
  for (const [uid, arr] of Object.entries(room.answers)) {
    const ans = arr[room.current]
    const u = room.users.get(uid)
    if (!u) continue
    if (room.mode === 'royale' && u.eliminated) continue
    if (Number.isFinite(ans)) {
      counts[ans as number] = (counts[ans as number] || 0) + 1
      const isCorrect = (ans === correct)
      if (room.mode === 'classic') {
        if (isCorrect) u.score += 1
      } else if (room.mode === 'gold') {
        // Correct → earn random gold 5-15; 20% chance steal 10 from random other
        if (isCorrect) {
          const delta = 5 + Math.floor(Math.random() * 11)
          u.gold = (u.gold || 0) + delta
          // Attempt steal with 20% chance
          if (Math.random() < room.goldStealChance && usersEntries.length > 1) {
            // pick a victim with gold > 0 and not self
            const candidates = usersEntries.filter(([vid, vv]) => vid !== uid && (vv.gold || 0) > 0)
            if (candidates.length) {
              const [vid, vv] = candidates[Math.floor(Math.random() * candidates.length)]
              const take = Math.min(10, vv.gold || 0)
              vv.gold = (vv.gold || 0) - take
              u.gold = (u.gold || 0) + take
              steals.push({ from: vid, to: uid, amount: take })
            }
          }
        }
      } else if (room.mode === 'royale') {
        if (isCorrect) {
          u.score += 1 // tiebreaker metric
        } else {
          u.lives = (u.lives ?? room.royaleLives) - 1
          if ((u.lives ?? 0) <= 0) { u.eliminated = true; eliminatedThisRound.push(uid) }
        }
      }
    }
  }
  // Record round for summary
  try {
    room.rounds.push({ index: room.current, question: String(q.question||''), choices: Array.isArray(q.choices)? q.choices.map((c:any)=> String(c)) : [], correctIndex: correct, counts, steals: steals.length? steals: undefined, eliminated: eliminatedThisRound.length? eliminatedThisRound: undefined })
  } catch {}
  const leaderboard = Array.from(room.users.entries()).map(([id,u])=>({id,name:u.name,score:u.score, gold:u.gold||0, lives:u.lives??null, eliminated:!!u.eliminated}))
    .sort((a,b)=>{
      if (room.mode === 'gold') return (b.gold - a.gold) || (b.score - a.score)
      if (room.mode === 'royale') return (Number(b.eliminated)-Number(a.eliminated)) || ((b.lives??0)-(a.lives??0)) || (b.score - a.score)
      return b.score - a.score
    })
  quizBroadcast(room, { type: 'reveal', roomId, current: room.current, correctIndex: correct, counts, steals, eliminated: eliminatedThisRound, leaderboard })
}

function nextQuestion(roomId: string) {
  const room = quizRooms.get(roomId)
  if (!room) return
  const next = room.current + 1
  if (next < room.questions.length) {
    startQuestion(roomId, next)
  } else {
    endQuiz(roomId)
  }
}

function endQuiz(roomId: string) {
  const room = quizRooms.get(roomId)
  if (!room) return
  if (room.timer) { clearTimeout(room.timer); room.timer = undefined }
  room.phase = 'ended'
  const leaderboard = Array.from(room.users.entries()).map(([id,u])=>({id,name:u.name,score:u.score, gold:u.gold||0, lives:u.lives??null, eliminated:!!u.eliminated})).sort((a,b)=> b.score - a.score)
  const summary = {
    ts: Date.now(),
    roomId,
    setId: room.setId,
    mode: room.mode,
    host: { id: room.host, name: room.hostName },
    options: { questionTime: room.questionTime, royaleLives: room.royaleLives, goldStealChance: room.goldStealChance },
    finalLeaderboard: leaderboard,
    rounds: room.rounds
  }
  ;(quizRooms as any).summaries = (quizRooms as any).summaries || new Map()
  ;(quizRooms as any).summaries.set(roomId, summary)
  // Fire-and-forget DB persistence
  ;(async()=>{
    try {
      await (prisma as any).quizSummary.create({ data: {
        roomId: summary.roomId,
        setId: summary.setId,
        mode: summary.mode,
        hostId: summary.host?.id,
        hostName: summary.host?.name,
        options: summary.options,
        finalLeaderboard: summary.finalLeaderboard,
        rounds: summary.rounds
      } })
    } catch (e) {
      console.warn('QuizSummary persist failed', (e as any)?.message)
    }
  })()
  quizBroadcast(room, { type: 'end', roomId, leaderboard, answers: room.answers, summaryAvailable: true })
  // Keep room for a short while so late sockets can read final state, then delete
  setTimeout(()=> quizRooms.delete(roomId), 60_000)
}

// Quiz summary endpoint
app.get('/api/quiz/summary/:roomId', requireAuth, async (req: any, res) => {
  try {
    const roomId = req.params.roomId
    const map: Map<string, any> | undefined = (quizRooms as any).summaries
    const s = map?.get(roomId)
    if (s) return res.json({ summary: s })
    // Fallback to DB persistence
    try {
      const db = await (prisma as any).quizSummary.findFirst({ where: { roomId } })
      if (!db) return res.status(404).json({ error: 'not_found' })
      res.json({ summary: {
        ts: new Date(db.createdAt).getTime(),
        roomId: db.roomId,
        setId: db.setId,
        mode: db.mode,
        host: { id: db.hostId, name: db.hostName },
        options: db.options,
        finalLeaderboard: db.finalLeaderboard,
        rounds: db.rounds
      }})
    } catch {
      return res.status(404).json({ error: 'not_found' })
    }
  } catch {
    res.status(500).json({ error: 'summary_failed' })
  }
})

// List recent quiz summaries (combined in-memory + DB)
app.get('/api/quiz/summaries', requireAuth, async (req: any, res) => {
  try {
    const mem: Map<string, any> | undefined = (quizRooms as any).summaries
    const memItems = mem ? Array.from(mem.values()).map(s => ({
      roomId: s.roomId,
      setId: s.setId,
      mode: s.mode,
      hostName: s.host?.name,
      at: s.ts
    })) : []
    let dbItems: any[] = []
    try {
      const rows = await (prisma as any).quizSummary.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
      dbItems = rows.map((r: any) => ({ roomId: r.roomId, setId: r.setId, mode: r.mode, hostName: r.hostName, at: new Date(r.createdAt).getTime() }))
    } catch {}
    // De-duplicate by roomId preferring memory
    const seen = new Set<string>()
    const merged: any[] = []
    for (const it of memItems.sort((a,b)=> b.at - a.at)) { if (!seen.has(it.roomId)) { seen.add(it.roomId); merged.push(it) } }
    for (const it of dbItems) { if (!seen.has(it.roomId)) { seen.add(it.roomId); merged.push(it) } }
    merged.sort((a,b)=> b.at - a.at)
    res.json({ items: merged.slice(0, 100) })
  } catch {
    res.status(500).json({ error: 'list_failed' })
  }
})

const wssQuiz = new WebSocketServer({ noServer: true })

// Publish a study set (by id)
app.post('/api/study/publish/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const set = await (prisma as any).studySet.findUnique({ where: { id } })
    if (!set || set.userId !== req.user.id) return res.status(404).json({ error: 'not_found' })
    sharedSets.set(id, { set, user: req.user.username || req.user.email || req.user.id, ts: Date.now() })
    if (!sharedIndex.find(x => x.id === id)) {
      sharedIndex.push({ id, title: set.title, subject: set.subject, user: req.user.username || req.user.email || req.user.id, ts: Date.now() })
    }
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'publish_failed' })
  }
})

// Browse shared sets
app.get('/api/study/browse', async (req, res) => {
  try {
    // Return most recent first
    const items = sharedIndex.slice().sort((a, b) => b.ts - a.ts).map(x => ({ id: x.id, title: x.title, subject: x.subject, user: x.user, ts: x.ts }))
    res.json({ items })
  } catch {
    res.status(500).json({ error: 'browse_failed' })
  }
})

// Get a shared set by id
app.get('/api/study/shared/:id', async (req, res) => {
  try {
    const id = req.params.id
    const entry = sharedSets.get(id)
    if (!entry) return res.status(404).json({ error: 'not_found' })
    res.json({ set: entry.set, user: entry.user, ts: entry.ts })
  } catch {
    res.status(500).json({ error: 'read_failed' })
  }
})

// Fork a shared set (creates a copy for current user)
app.post('/api/study/fork/:id', requireAuth, async (req: any, res) => {
  try {
    const id = req.params.id
    const entry = sharedSets.get(id)
    if (!entry) return res.status(404).json({ error: 'not_found' })
    const orig = entry.set
    // Create a new StudySet for current user
    const copy = await (prisma as any).studySet.create({
      data: {
        userId: req.user.id,
        title: orig.title + ' (forked)',
        subject: orig.subject,
        sourceText: orig.sourceText,
        tools: orig.tools,
        linkedNoteIds: orig.linkedNoteIds,
        content: orig.content
      }
    })
    res.json({ ok: true, set: copy })
  } catch {
    res.status(500).json({ error: 'fork_failed' })
  }
})

// Grade a flashcard answer using OpenAI for semantic correctness
// Body: { front: string, expectedBack: string, userAnswer: string }
app.post('/api/study/grade', requireAuth, async (req: any, res) => {
  try {
    const { front, expectedBack, userAnswer } = req.body || {}
    if (!front || !expectedBack || !userAnswer) return res.status(400).json({ error: 'missing_fields' })
    const headerKey = (req.headers['x-openai-key'] as string | undefined)?.trim()
    const dbKey = await getSettingValue('OPENAI_API_KEY')
    const apiKey = headerKey || dbKey || process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'openai_not_configured' })
    const oa = new OpenAI({ apiKey })
    const prompt = `Card front: ${front}\nCorrect answer: ${expectedBack}\nUser answer: ${userAnswer}\n\nJudge if the user's answer means the same as the correct answer. Respond in strict JSON: {"correct": boolean, "explanation": string}. Explanation should be brief and point out any key mismatch if incorrect.`
    const models = ['gpt-4o-mini', 'gpt-4o']
    let out: any = null
    for (const model of models) {
      try {
        const r = await oa.chat.completions.create({
          model,
          temperature: 0,
          messages: [ { role: 'system', content: 'You grade short answers precisely.' }, { role: 'user', content: prompt } ] as any,
          response_format: { type: 'json_object' } as any,
          max_tokens: 200
        })
        const txt = r.choices?.[0]?.message?.content?.toString() || '{}'
        out = JSON.parse(txt)
        break
      } catch {}
    }
    if (!out || typeof out.correct !== 'boolean') out = { correct: String(userAnswer).trim().toLowerCase() === String(expectedBack).trim().toLowerCase(), explanation: out?.explanation || '' }
    res.json(out)
  } catch {
    res.status(500).json({ error: 'grade_failed' })
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

// WebSocket servers for /api/events, /ws/stream, and /ws/quiz
const wss = new WebSocketServer({ noServer: true })
const wssStream = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url || '', `http://x`)
    if (url.pathname === '/ws/quiz') {
      wssQuiz.handleUpgrade(request, socket as any, head, (ws: WebSocket) => {
        let roomId = ''
        let userId = ''
        ws.on('message', async (raw: any) => {
          let data: any = null
          try { data = JSON.parse(String(raw)) } catch {}
          if (!data || typeof data !== 'object') return
          if (data.type === 'host') {
            // Host creates the room
            roomId = data.roomId || (Math.random().toString(36).slice(2, 8))
            userId = data.userId || 'host-' + roomId
            const hostName = (data.name || 'Host').toString().slice(0, 40)
            const questions = await getQuizQuestions(data.setId)
            const stealChanceRaw = Number(data.options?.goldStealChance ?? 0.2)
            const goldStealChance = (()=>{
              if (!Number.isFinite(stealChanceRaw)) return 0.2
              if (stealChanceRaw > 1) return Math.max(0, Math.min(1, stealChanceRaw / 100))
              return Math.max(0, Math.min(1, stealChanceRaw))
            })()
            const royaleLives = Math.max(1, Math.min(9, Number(data.options?.royaleLives ?? 3)))
            const room: QuizRoom = {
              host: userId,
              hostName,
              setId: data.setId,
              mode: (['classic','gold','royale'].includes(String(data.options?.mode)) ? String(data.options?.mode) : 'classic') as any,
              royaleLives,
              goldStealChance,
              questions,
              answers: {},
              users: new Map([[userId, { name: hostName, score: 0, gold: 0, lives: royaleLives, eliminated: false }]]),
              started: false,
              current: 0,
              phase: 'lobby',
              questionTime: Math.max(5, Math.min(120, Number(data.options?.questionTime ?? 30))),
              ws: new Set([ws]),
              rounds: []
            }
            quizRooms.set(roomId, room)
            try { ws.send(JSON.stringify({ type: 'room', roomId, host: userId, joinUrl: `/quiz/join/${roomId}`, questionCount: questions.length, questionTime: room.questionTime, mode: room.mode, options: { royaleLives: room.royaleLives, goldStealChance: room.goldStealChance } })) } catch {}
            // Also emit initial lobby state
            try { ws.send(JSON.stringify(quizState(roomId))) } catch {}
          } else if (data.type === 'join') {
            roomId = String(data.roomId || '')
            userId = data.userId || 'user-' + Math.random().toString(36).slice(2, 8)
            const name = (data.name || 'Player').toString().slice(0, 40)
            const room = quizRooms.get(roomId)
            if (!room) { try { ws.send(JSON.stringify({ type: 'error', error: 'room_not_found' })) } catch {}; return }
            if (room.started) { try { ws.send(JSON.stringify({ type: 'error', error: 'already_started' })) } catch {}; return }
            room.ws.add(ws)
            if (!room.users.has(userId)) room.users.set(userId, { name, score: 0, gold: 0, lives: room.royaleLives, eliminated: false })
            // Send ack and current state
            try { ws.send(JSON.stringify({ type: 'joined', roomId, userId, name, questionCount: room.questions.length, questionTime: room.questionTime, mode: room.mode, options: { royaleLives: room.royaleLives, goldStealChance: room.goldStealChance } })) } catch {}
            try { ws.send(JSON.stringify(quizState(roomId))) } catch {}
            // Notify others lobby updated
            quizBroadcast(room, quizState(roomId))
          } else if (data.type === 'start') {
            const room = quizRooms.get(String(data.roomId || ''))
            if (!room || room.host !== data.userId) return
            startQuestion(String(data.roomId), 0)
          } else if (data.type === 'answer') {
            const room = quizRooms.get(String(data.roomId || ''))
            if (!room || !room.started || room.phase !== 'question') return
            if (!room.answers[data.userId]) room.answers[data.userId] = []
            // Record only first answer for the question
            const existing = room.answers[data.userId][room.current]
            if (typeof existing !== 'number') {
              room.answers[data.userId][room.current] = Number(data.answerIndex)
              // Optional: notify count update to host
              const total = Array.from(room.users.values()).filter(u=> room.mode!=='royale' ? true : !u.eliminated).length
              const answered = Object.entries(room.answers)
                .filter(([uid, arr])=> {
                  const u = room.users.get(uid)
                  if (!u) return false
                  if (room.mode==='royale' && u.eliminated) return false
                  return typeof (arr as number[])[room.current] === 'number'
                }).length
              quizBroadcast(room, { type: 'progress', current: room.current, answered, total })
              // If all participants answered, reveal immediately
              if (answered >= total) revealQuestion(String(data.roomId))
            }
          } else if (data.type === 'next') {
            const room = quizRooms.get(String(data.roomId || ''))
            if (!room || room.host !== data.userId) return
            nextQuestion(String(data.roomId))
          } else if (data.type === 'state') {
            const room = quizRooms.get(String(data.roomId || ''))
            if (!room) return
            try { ws.send(JSON.stringify(quizState(String(data.roomId)))) } catch {}
          }
        })
        ws.on('close', () => {
          if (roomId && quizRooms.has(roomId)) {
            const room = quizRooms.get(roomId)!
            room.ws.delete(ws)
            if (room.ws.size === 0 && room.phase !== 'ended') {
              if (room.timer) { clearTimeout(room.timer); room.timer = undefined }
              quizRooms.delete(roomId)
            }
          }
        })
      })
      return
    }
    if (url.pathname === '/api/events') {
      const sessionId = url.searchParams.get('sessionId') || ''
      if (!sessionId) return socket.destroy()
      const userId = url.searchParams.get('userId') || undefined
      wss.handleUpgrade(request, socket as any, head, (ws: WebSocket) => {
        const send = (data: string) => ws.readyState === ws.OPEN && ws.send(data)
        const unsub = subscribe(sessionId, { kind: 'ws', send, end: () => ws.close() }, userId)
        ws.on('close', () => unsub())
        ws.send(JSON.stringify({ type: 'hello', sessionId }))
      })
      return
    }
    if (url.pathname === '/ws/stream') {
      wssStream.handleUpgrade(request, socket as any, head, (ws: WebSocket) => {
        // Simple echo-stream prototype: accepts JSON {type:'text', text:string}
        // and emits partial tokens then a final message.
        const hello = { type: 'hello', mode: 'stream', ts: Date.now() }
        try { ws.send(JSON.stringify(hello)) } catch {}
        ws.on('message', (raw: any) => {
          let data: any = null
          try { data = JSON.parse(String(raw)) } catch {}
          const kind = data?.type || 'text'
          if (kind === 'ping') {
            try { ws.send(JSON.stringify({ type: 'pong', ts: Date.now() })) } catch {}
            return
          }
          if (kind === 'text') {
            const text = String(data?.text || '')
            if (!text) return
            // Tokenize by words and stream a few at a time
            const words = text.split(/\s+/).filter(Boolean)
            let i = 0
            const timer = setInterval(() => {
              if (ws.readyState !== ws.OPEN) { clearInterval(timer); return }
              const chunk = words.slice(i, i + 3).join(' ')
              i += 3
              if (chunk) {
                try { ws.send(JSON.stringify({ type: 'partial', text: chunk })) } catch {}
              }
              if (i >= words.length) {
                clearInterval(timer)
                try { ws.send(JSON.stringify({ type: 'final', text })) } catch {}
              }
            }, 120)
            return
          }
          // Unknown -> echo raw
          try { ws.send(JSON.stringify({ type: 'unknown', data })) } catch {}
        })
        ws.on('close', () => { /* no-op */ })
      })
      return
    }
    // Unknown WS path
    return socket.destroy()
  } catch {
    socket.destroy()
  }
})
