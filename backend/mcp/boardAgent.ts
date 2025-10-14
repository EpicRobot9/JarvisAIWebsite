import { PrismaClient } from '@prisma/client'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import fetch from 'node-fetch'
import OpenAI from 'openai'

function getOpenAI() {
  const key = (process.env.OPENAI_API_KEY || '').trim()
  if (!key) return null
  return new OpenAI({ apiKey: key })
}

function vecCosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i=0;i<n;i++){ const x=a[i], y=b[i]; dot+=x*y; na+=x*x; nb+=y*y }
  if (na===0 || nb===0) return 0
  return dot / (Math.sqrt(na)*Math.sqrt(nb))
}

async function embedTexts(oa: OpenAI, texts: string[]) {
  const res = await oa.embeddings.create({ model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', input: texts })
  return res.data.map((d:any)=> d.embedding as number[])
}

function boardItemToText(it: any): string {
  try {
    if (it.type === 'note') return String(it.content?.text||'')
    if (it.type === 'checklist') {
      const arr = Array.isArray(it.content?.items)? it.content.items: []
      return arr.map((x:any)=> `- [${x.done? 'x':' '}] ${x.text||''}`).join('\n')
    }
    if (it.type === 'link') return `${it.content?.title||''} ${it.content?.url||''} ${it.content?.desc||''}`
    if (it.type === 'image') return `Image: ${it.content?.caption||it.content?.url||''}`
    if (it.type === 'group') return `Group: ${it.content?.title||''}`
    if (it.type === 'table') {
      const cols = (it.content?.columns||[]).join(' | ')
      const rows = (it.content?.rows||[]).map((r:any[])=> (r||[]).join(' | ')).join('\n')
      return `Table ${it.content?.title||''}\n${cols}\n${rows}`
    }
    if (it.type === 'column') return `Column: ${it.content?.title||''}`
    if (it.type === 'draw') return `Drawing with ${(it.content?.strokes||[]).length} strokes`
  } catch {}
  return it.type
}

export function createBoardMcpServer(prisma: PrismaClient) {
  const server = new McpServer({ name: 'jarvis-board-agent', version: '0.1.0' })

  const baseInput = {
    boardId: z.string().describe('Board ID'),
    x: z.number().optional().describe('X position'),
    y: z.number().optional().describe('Y position'),
    w: z.number().optional().describe('Width'),
    h: z.number().optional().describe('Height'),
  } as const

  server.registerTool('create_note', {
    description: 'Create a note on a board',
    inputSchema: { ...baseInput, text: z.string().optional().describe('Note text'), title: z.string().optional(), color: z.string().optional().describe('CSS color or hex') }
  }, async ({ boardId, text, title, color, x, y, w, h }: any) => {
    text = text ?? 'New note'
    x = x ?? 80; y = y ?? 80; w = w ?? 320; h = h ?? 200
    const content: any = { text }
    if (title) content.title = title
    if (color) content.color = color
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'note', x, y, w, h, z: 0, rotation: 0, content } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  server.registerTool('create_link', {
    description: 'Create a link card from a URL',
    inputSchema: { ...baseInput, url: z.string().url().describe('URL to link') }
  }, async ({ boardId, url, x, y, w, h }: any) => {
    if (!url) throw new Error('url required')
    x = x ?? 120; y = y ?? 120; w = w ?? 360; h = h ?? 120
    let title = ''
    let desc = ''
    try {
      const r = await fetch('http://localhost:8080/api/import/url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) } as any)
      if (r.ok) { const j: any = await (r.json() as any); title = j.title || ''; desc = (j.text || '').slice(0, 240) }
    } catch {}
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'link', x, y, w, h, z: 0, rotation: 0, content: { url, title, desc } } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  server.registerTool('create_image', {
    description: 'Create an image card from a URL',
    inputSchema: { ...baseInput, url: z.string().url().describe('Image URL') }
  }, async ({ boardId, url, x, y, w, h }: any) => {
    if (!url) throw new Error('url required')
    x = x ?? 140; y = y ?? 140; w = w ?? 480; h = h ?? 320
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'image', x, y, w, h, z: 0, rotation: 0, content: { url } } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  server.registerTool('create_table', {
    description: 'Create a table card with optional title, columns, and rows',
    inputSchema: { ...baseInput, title: z.string().optional(), columns: z.array(z.string()).optional(), rows: z.array(z.array(z.string())).optional() }
  }, async ({ boardId, title, columns, rows, x, y, w, h }: any) => {
    x = x ?? 160; y = y ?? 160; w = w ?? 520; h = h ?? 280
    const content: any = { title: title||'', columns: Array.isArray(columns)&&columns.length? columns: ['Column 1','Column 2'], rows: Array.isArray(rows)&&rows.length? rows: [['',''],['','']] }
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'table', x, y, w, h, z: 0, rotation: 0, content } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  server.registerTool('create_column', {
    description: 'Create a visual column card for organizing items',
    inputSchema: { ...baseInput, title: z.string().optional() }
  }, async ({ boardId, title, x, y, w, h }: any) => {
    x = x ?? 100; y = y ?? 100; w = w ?? 300; h = h ?? 480
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'column', x, y, w, h, z: 0, rotation: 0, content: { title: title||'' } } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  server.registerTool('list_items', {
    description: 'List board items and edges',
    inputSchema: { boardId: z.string().describe('Board ID') }
  }, async ({ boardId }: any) => {
    const [items, edges] = await Promise.all([
      (prisma as any).boardItem.findMany({ where: { boardId } }),
      (prisma as any).boardEdge.findMany({ where: { boardId } }),
    ])
    return { content: [{ type: 'text', text: JSON.stringify({ items, edges }) }] }
  })

  // Create or append a drawing stroke; if itemId provided, append; else create new draw item using bounds
  server.registerTool('draw_stroke', {
    description: 'Add a freehand drawing stroke',
    inputSchema: {
      boardId: z.string(),
      itemId: z.string().optional().describe('Existing draw item id to append to'),
      color: z.string().default('#22c55e'),
      width: z.number().default(3),
      points: z.array(z.object({ x: z.number(), y: z.number() })).min(2)
    }
  }, async ({ boardId, itemId, color, width, points }: any) => {
    if (itemId) {
      const current = await (prisma as any).boardItem.findUnique({ where: { id: itemId } })
      if (!current || current.boardId !== boardId || current.type !== 'draw') throw new Error('draw item not found')
      const newStrokes = [ ...(current.content?.strokes||[]), { color, width, points } ]
      const updated = await (prisma as any).boardItem.update({ where: { id: itemId }, data: { content: { ...(current.content||{}), strokes: newStrokes } } })
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item: updated }) }] }
    }
    const xs = points.map((p:any)=> p.x), ys = points.map((p:any)=> p.y)
    const minX = Math.min(...xs), minY = Math.min(...ys)
    const maxX = Math.max(...xs), maxY = Math.max(...ys)
    const w = Math.max(20, maxX - minX + 10)
    const h = Math.max(20, maxY - minY + 10)
    const norm = points.map((p:any)=> ({ x: p.x - minX, y: p.y - minY }))
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'draw', x: minX, y: minY, w, h, z: 0, rotation: 0, content: { strokes: [{ color, width, points: norm }], title: '' } } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  // Rename card: set content.title
  server.registerTool('rename_card', {
    description: 'Rename a card by setting its title',
    inputSchema: {
      boardId: z.string(),
      itemId: z.string(),
      title: z.string().min(1).max(200)
    }
  }, async ({ boardId, itemId, title }: any) => {
    const item = await (prisma as any).boardItem.findUnique({ where: { id: itemId } })
    if (!item || item.boardId !== boardId) throw new Error('item not found')
    const newContent = { ...(item.content||{}), title }
    const updated = await (prisma as any).boardItem.update({ where: { id: itemId }, data: { content: newContent } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item: updated }) }] }
  })

  // Draw common shapes quickly
  server.registerTool('draw_shape', {
    description: 'Create a draw item with a simple shape',
    inputSchema: {
      boardId: z.string(),
      shape: z.enum(['rectangle','circle','arrow','scribble']).default('rectangle'),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      color: z.string().default('#22c55e'),
      width: z.number().default(3)
    }
  }, async ({ boardId, shape, x, y, w, h, color, width }: any) => {
    x = x ?? 120; y = y ?? 120; w = Math.max(20, w ?? 200); h = Math.max(20, h ?? 120)
    let strokes: any[] = []
    if (shape === 'rectangle') {
      const pts = [ {x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h},{x:0,y:0} ]
      strokes = [{ color, width, points: pts }]
    } else if (shape === 'circle') {
      const cx = w/2, cy = h/2, r = Math.min(w,h)/2
      const pts: any[] = []
      const steps = 32
      for (let i=0;i<=steps;i++){ const t = (i/steps)*2*Math.PI; pts.push({ x: cx + r*Math.cos(t), y: cy + r*Math.sin(t) }) }
      strokes = [{ color, width, points: pts }]
    } else if (shape === 'arrow') {
      const pts = [ {x:0,y:h/2}, {x:w-12,y:h/2} ]
      const head = [ {x:w-12,y:h/2}, {x:w-24,y:h/2-10}, {x:w,y:h/2}, {x:w-24,y:h/2+10}, {x:w-12,y:h/2} ]
      strokes = [ { color, width, points: pts }, { color, width, points: head } ]
    } else if (shape === 'scribble') {
      const pts: any[] = []
      const n = 40
      for (let i=0;i<n;i++){
        const px = (i/(n-1))*w
        const py = h/2 + Math.sin(i/3)*h*0.2 + (Math.random()-0.5)*8
        pts.push({ x: px, y: py })
      }
      strokes = [{ color, width, points: pts }]
    }
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'draw', x, y, w, h, z: 0, rotation: 0, content: { strokes, title: '' } } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  // Summarize selection into a note
  server.registerTool('summarize_selection', {
    description: 'Summarize selected items into a note',
    inputSchema: {
      boardId: z.string(),
      itemIds: z.array(z.string()).optional()
    }
  }, async ({ boardId, itemIds }: any) => {
    const oa = getOpenAI()
    if (!oa) throw new Error('openai_not_configured')
    const items = await (prisma as any).boardItem.findMany({ where: { boardId, ...(itemIds? { id: { in: itemIds } } : {}) } })
    if (!items.length) throw new Error('no_items')
    const text = items.map(boardItemToText).join('\n')
    const r = await oa.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.3, messages: [
      { role: 'system', content: 'Summarize succinctly as bullet points. Keep it factual and organized.' },
      { role: 'user', content: text.slice(0, 6000) }
    ], max_tokens: 400 })
    const summary = (r.choices?.[0]?.message?.content || 'Summary') as string
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'note', x: 80, y: 80, w: 360, h: 220, z: 0, rotation: 0, content: { title: 'Summary', text: summary } } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  // Cluster items and create group cards
  server.registerTool('cluster_items', {
    description: 'Cluster items by semantic similarity and create group cards',
    inputSchema: {
      boardId: z.string(),
      itemIds: z.array(z.string()).optional()
    }
  }, async ({ boardId, itemIds }: any) => {
    const oa = getOpenAI()
    if (!oa) throw new Error('openai_not_configured')
    const items: any[] = await (prisma as any).boardItem.findMany({ where: { boardId, ...(itemIds? { id: { in: itemIds } } : {}) } })
    const movable = items.filter(it => it.type !== 'group')
    if (movable.length < 2) return { content: [{ type: 'text', text: JSON.stringify({ ok: true, groups: [], updated: [] }) }] }
    const texts = movable.map(boardItemToText).map(t => t.slice(0, 4000))
    const vecs = await embedTexts(oa, texts)
    const n = movable.length
    const k = Math.min(6, Math.max(2, Math.round(Math.sqrt(n/2))))
    // k-means (basic)
    const dims = (vecs[0] || []).length
    let centroids: number[][] = []
    for (let i=0; i<k; i++) centroids.push([...(vecs[i%n]||new Array(dims).fill(0))])
    let assign: number[] = new Array(n).fill(0)
    for (let iter=0; iter<8; iter++) {
      for (let i=0; i<n; i++) {
        let best = 0, bestScore = -Infinity
        for (let c=0; c<k; c++) { const s = vecCosine(vecs[i], centroids[c]); if (s > bestScore) { bestScore = s; best = c } }
        assign[i] = best
      }
      const sum: number[][] = Array.from({ length: k }, () => new Array(dims).fill(0))
      const count: number[] = new Array(k).fill(0)
      for (let i=0; i<n; i++) { const a = assign[i]; count[a]++; const v = vecs[i]; for (let d=0; d<dims; d++) sum[a][d]+=v[d] }
      for (let c=0; c<k; c++) if (count[c]>0) for (let d=0; d<dims; d++) sum[c][d]/=count[c]
      centroids = sum
    }
    const clusters: { idx:number; items:any[]; }[] = Array.from({ length: k }, (_, idx)=> ({ idx, items: [] }))
    for (let i=0; i<n; i++) clusters[assign[i]].items.push(movable[i])
    const nonEmpty = clusters.filter(c => c.items.length)
    // Create group cards and layout in a grid near origin
    const groupItems: any[] = []
    const updatedItems: any[] = []
    const cols = Math.ceil(Math.sqrt(nonEmpty.length))
    nonEmpty.forEach((c, idx) => {
      const gx = 60 + (idx % cols) * 320
      const gy = 60 + Math.floor(idx / cols) * 240
      groupItems.push({ idx, title: `Group ${idx+1}`, x: gx, y: gy })
    })
    // Persist groups and move items near their group
    const createdGroups: any[] = []
    for (const g of groupItems) {
      const group = await (prisma as any).boardItem.create({ data: { boardId, type: 'group', x: g.x, y: g.y, w: 260, h: 48, z: 0, rotation: 0, content: { title: g.title } } })
      createdGroups.push(group)
    }
    // Arrange items roughly under the group
    let gi = 0
    for (const c of nonEmpty) {
      const group = createdGroups[gi++]
      let row = 0, col = 0
      for (const it of c.items) {
        const nx = group.x + 20 + (col * 260)
        const ny = group.y + 60 + (row * 180)
        const updated = await (prisma as any).boardItem.update({ where: { id: it.id }, data: { x: nx, y: ny } })
        updatedItems.push(updated)
        col++; if (col>=3) { col=0; row++ }
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, groups: createdGroups, updated: updatedItems }) }] }
  })

  // Suggest links between semantically similar items; optionally commit edges
  server.registerTool('suggest_links', {
    description: 'Suggest links between related items; optionally create edges',
    inputSchema: {
      boardId: z.string(),
      itemIds: z.array(z.string()).optional(),
      commit: z.boolean().optional(),
      threshold: z.number().min(0).max(1).optional(),
      max: z.number().min(1).max(100).optional(),
    }
  }, async ({ boardId, itemIds, commit, threshold, max }: any) => {
    const oa = getOpenAI()
    if (!oa) throw new Error('openai_not_configured')
    const items: any[] = await (prisma as any).boardItem.findMany({ where: { boardId, ...(itemIds? { id: { in: itemIds } } : {}) } })
    if (items.length < 2) return { content: [{ type: 'text', text: JSON.stringify({ ok: true, suggestions: [], created: [] }) }] }
    const th = Math.max(0, Math.min(1, Number(threshold ?? 0.78)))
    const maxPairs = Math.max(1, Math.min(50, Number(max ?? 25)))
    const texts = items.map(boardItemToText).map(t => t.slice(0, 4000))
    const emb = await oa.embeddings.create({ model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', input: texts })
    const vecs = (emb.data || []).map((d:any)=> (d.embedding as number[]))
    const pairs: { sourceId: string; targetId: string; score: number }[] = []
    for (let i=0;i<items.length;i++) for (let j=i+1;j<items.length;j++) {
      const s = vecCosine(vecs[i], vecs[j])
      if (s >= th) pairs.push({ sourceId: items[i].id, targetId: items[j].id, score: s })
    }
    pairs.sort((a,b)=> b.score - a.score)
    const suggestions = pairs.slice(0, maxPairs).map(p => ({ sourceId: p.sourceId, targetId: p.targetId, label: p.score.toFixed(2) }))
    const created: any[] = []
    if (commit) {
      const existing = await (prisma as any).boardEdge.findMany({ where: { boardId } })
      const exists = new Set(existing.map((e:any)=> `${e.sourceId}::${e.targetId}`))
      for (const s of suggestions) {
        const k1 = `${s.sourceId}::${s.targetId}`
        const k2 = `${s.targetId}::${s.sourceId}`
        if (exists.has(k1) || exists.has(k2)) continue
        try {
          const edge = await (prisma as any).boardEdge.create({ data: { boardId, sourceId: s.sourceId, targetId: s.targetId, label: s.label || null, style: null } })
          created.push(edge)
          exists.add(k1)
          if (created.length >= maxPairs) break
        } catch {}
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, suggestions, created }) }] }
  })

  // Generate Mermaid diagram from selected items and add as a note
  server.registerTool('diagram_from_selection', {
    description: 'Create a Mermaid diagram from selected items and insert as a note',
    inputSchema: {
      boardId: z.string(),
      itemIds: z.array(z.string()).optional(),
      type: z.enum(['flowchart','sequence','class','er','state']).default('flowchart')
    }
  }, async ({ boardId, itemIds, type }: any) => {
    const oa = getOpenAI()
    if (!oa) throw new Error('openai_not_configured')
    const items = await (prisma as any).boardItem.findMany({ where: { boardId, ...(itemIds? { id: { in: itemIds } } : {}) } })
    if (!items.length) throw new Error('no_items')
    const text = items.map(boardItemToText).filter(Boolean).join('\n')
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
    const item = await (prisma as any).boardItem.create({ data: { boardId, type: 'note', x: 80, y: 80, w: 360, h: 240, z: 0, rotation: 0, content: { mermaid, type } } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }) }] }
  })

  // Generate flashcards from selected items and save a StudySet
  server.registerTool('generate_flashcards', {
    description: 'Generate a flashcard StudySet from selected items',
    inputSchema: {
      boardId: z.string(),
      itemIds: z.array(z.string()).optional(),
      title: z.string().optional()
    }
  }, async ({ boardId, itemIds, title }: any) => {
    const oa = getOpenAI()
    const items = await (prisma as any).boardItem.findMany({ where: { boardId, ...(itemIds? { id: { in: itemIds } } : {}) } })
    if (!items.length) throw new Error('no_items')
    const subject = (title || 'Flashcards from Board').toString()
    const text = items.map(boardItemToText).filter(Boolean).join('\n')
    let content: any = {}
    if (oa) {
      try {
        const system = 'You are a helpful study assistant. Given source material, produce strict JSON with a flashcards array only.'
        const userPrompt = `Source material:\n\n${text.slice(0,20000)}\n\nReturn JSON: { "flashcards": Array<{ "front": string, "back": string }> } with 12-30 high-quality cards.`
        const r = await oa.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.2, messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ] as any, response_format: { type: 'json_object' } as any, max_tokens: 900 })
        const js = JSON.parse(String(r.choices?.[0]?.message?.content || '{}'))
        if (Array.isArray(js.flashcards)) content.flashcards = js.flashcards.map((c:any)=> ({ front: String(c.front||''), back: String(c.back||'') })).filter((c:any)=> c.front && c.back)
      } catch {}
    }
    if (!Array.isArray(content.flashcards) || content.flashcards.length === 0) {
      // Fallback: simple QA pairs from sentences
      const lines = text.split(/\n+/).map((s: string)=> s.trim()).filter(Boolean).slice(0, 20)
      content.flashcards = lines.map((l: string, i: number)=> ({ front: `Q${i+1}: ${l.slice(0,80)}?`, back: l.slice(0,200) }))
    }
    const set = await (prisma as any).studySet.create({ data: { userId: (await (prisma as any).board.findUnique({ where: { id: boardId } })).userId, title: subject, subject: 'Board', sourceText: text.slice(0,20000), tools: ['flashcards'], linkedNoteIds: [], content } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, set }) }] }
  })

  // Structure a board from a prompt using AI
  server.registerTool('structure_board', {
    description: 'Create groups and notes/checklists from a natural language prompt',
    inputSchema: {
      boardId: z.string(),
      prompt: z.string().min(4)
    }
  }, async ({ boardId, prompt }: any) => {
    const oa = getOpenAI()
    if (!oa) throw new Error('openai_not_configured')
    const system = 'You create a planning board as JSON items: groups (columns) and notes/checklists with concise content and approximate positions (x,y,w,h). Keep values reasonable.'
    const msg = `Topic: ${prompt}. Return an array named items with objects like { type, content, x, y, w, h } where type is 'group'|'note'|'checklist'.`
    const r = await oa.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.2, response_format: { type: 'json_object' } as any, messages: [ { role: 'system', content: system }, { role: 'user', content: msg } ] as any, max_tokens: 900 })
    let out: any = {}
    try { out = JSON.parse(String(r.choices?.[0]?.message?.content || '{}')) } catch {}
    const itemsIn = Array.isArray(out.items) ? out.items : []
    const toCreate = itemsIn.slice(0, 60).map((it: any) => ({
      boardId,
      type: typeof it.type === 'string' ? it.type : 'note',
      x: Number(it.x ?? 40), y: Number(it.y ?? 40), w: Number(it.w ?? 240), h: Number(it.h ?? 120), z: 0, rotation: 0,
      content: typeof it.content === 'object' ? it.content : { text: String(it.text || '') }
    }))
    const created: any[] = []
    for (const chunk of toCreate) { try { created.push(await (prisma as any).boardItem.create({ data: chunk })) } catch {} }
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, items: created }) }] }
  })

  // Update the text of an existing note
  server.registerTool('update_note_text', {
    description: 'Update the text content of a note card',
    inputSchema: { boardId: z.string(), itemId: z.string(), text: z.string().min(1) }
  }, async ({ boardId, itemId, text }: any) => {
    const item = await (prisma as any).boardItem.findUnique({ where: { id: itemId } })
    if (!item || item.boardId !== boardId || item.type !== 'note') throw new Error('note not found')
    const updated = await (prisma as any).boardItem.update({ where: { id: itemId }, data: { content: { ...(item.content||{}), text: String(text) } } })
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item: updated }) }] }
  })

  return server
}
