# Jarvis Board AI – Multi-Mode Intelligent Agent

Date: 2025-10-13

This document specifies the AI Boards feature and the integrated voice-enabled Jarvis Board AI agent. It is the authoritative reference for features, data models, APIs, and integration points. Implementation must begin only after this document is approved.

---

## 1) Goals and Philosophy

- Deliver a Milanote-like freeform board with cards, groups, and connectors.
- Integrate an intelligent, voice-enabled agent that understands board context, can act on it, and maintains memory.
- Reuse existing Jarvis capabilities (auth, TTS/STT, OpenAI overrides, SSE/WS, study generation, diagramming) for maximum leverage and coherence.
- Design for progressive enhancement: MVP single-user boards, then collaboration and advanced AI.

---

## 2) Core Features

### 2.1 Board Awareness
- Full context of the currently open board: metadata (title, viewport), cards (text/type/position/size/z/relations/timestamps), selections, and groups.
- Context injected into AI prompts for accurate reasoning and actionable suggestions.

### 2.2 Memory System
- Short-Term Memory (STM): last N=10 user-agent interactions per board, stored server-side and included in prompts.
- Long-Term Memory (LTM): vector store with embeddings of cards, summaries, AI outputs, and intents; top-k retrieval by board/topic.
- Context retrieval on board open and topic switches.

### 2.3 Voice Mode
- Uses existing STT `/api/stt` and TTS `/api/tts` (or `/api/tts/stream`) with user key overrides.
- Modes: Always Listening, Push-to-Talk, or Off. Reuses existing wake word and PTT settings.
- Voice triggers, narration, and verbal confirmations for actions.

### 2.4 Personality Customization
- Per-user AI profile defines tone, style, emotion, and default TTS voice.
- Agent tailors both text and voice to the profile; persisted in DB and editable in Settings.

### 2.5 Agent Mode (Action Execution)
- Multi-step reasoning then actions via board APIs:
  - createCard(type, content, position?)
  - editCard(id, newContent)
  - moveCard(id, newPosition)
  - summarizeSelection(ids[])
  - suggestLinks(ids[])
  - generateStudySet(ids[])
  - generateDiagram(ids[], type?)
  - clusterByTheme()
  - speak(text)
  - exportBoard(format)

### 2.6 Extra AI Features
- Auto-Structurer: reorganize layout for clarity.
- Insight Summarizer: roll-up summaries and highlights.
- AI Threads: per-card sub-conversations with STM/LTM links.
- Study Mentor Mode: question user based on board, with voice.
- Auto-Themes: detect topic and propose color/themes.
- Cross-Board Context: related items via vector similarity.
- Memory Highlights: show top remembered facts when opening a board.
- Voice Narration Mode: spoken overview of board contents.

---

## 3) Data Models (Prisma)

Additions:

```prisma
model Board {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  title     String
  viewport  Json     // { x, y, zoom }
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  items     BoardItem[]
  edges     BoardEdge[]
}

model BoardItem {
  id        String   @id @default(cuid())
  boardId   String
  board     Board    @relation(fields: [boardId], references: [id])
  type      String   // 'note' | 'checklist' | 'link' | 'image' | 'group'
  x         Float
  y         Float
  w         Float
  h         Float
  z         Int      @default(0)
  rotation  Float    @default(0)
  content   Json     // shape varies by type
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model BoardEdge {
  id        String   @id @default(cuid())
  boardId   String
  board     Board    @relation(fields: [boardId], references: [id])
  sourceId  String
  targetId  String
  label     String? 
  style     Json?
  createdAt DateTime @default(now())
}

model AIProfile {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  name      String   @default("Default")
  tone      String   @default("friendly")
  style     String   @default("concise")
  emotion   String   @default("calm")
  ttsVoice  String   @default("")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model VectorMemory {
  id        String   @id @default(cuid())
  userId    String
  boardId   String
  kind      String   // 'card' | 'summary' | 'agent' | 'intent'
  topic     String   @default("")
  summary   String   @default("")
  importance Int     @default(0)
  embedding Float[]
  payload   Json
  createdAt DateTime @default(now())

  @@index([userId, boardId])
}
```

Notes:
- `Float[]` requires PostgreSQL `double precision[]` (Prisma supports). If not, store embeddings externally and keep references.
- Alternatively, store vectors in external DB (Pinecone/Weaviate/Supabase Vector) and persist references here.

---

## 4) Backend API

All endpoints require authenticated session (`requireAuth`). OpenAI/ElevenLabs header overrides are honored like existing flows.

### 4.1 Boards CRUD
- POST `/api/boards` { title? } → `{ board }`
- GET `/api/boards?take=50&cursor=<id>` → `{ items, nextCursor }`
- GET `/api/boards/:id` → `{ board, items, edges }` (ownership enforced)
- PATCH `/api/boards/:id` { title?, viewport? } → `{ board }`
- DELETE `/api/boards/:id` → `{ ok: true }`

### 4.2 Board Items
- POST `/api/boards/:id/items` { type, x,y,w,h,z?,rotation?,content } → `{ item }`
- PATCH `/api/boards/:id/items/:itemId` { x?,y?,w?,h?,z?,rotation?,content? } → `{ item }`
- DELETE `/api/boards/:id/items/:itemId` → `{ ok: true }`

### 4.3 Edges
- POST `/api/boards/:id/edges` { sourceId, targetId, label?, style? } → `{ edge }`
- DELETE `/api/boards/:id/edges/:edgeId` → `{ ok: true }`

### 4.4 AI Actions
- POST `/api/boards/:id/ai/structure` { prompt } → `{ items }`
- POST `/api/boards/:id/ai/summarize` { itemIds: string[] } → `{ note: { text }, item }`
- POST `/api/boards/:id/ai/diagram` { itemIds: string[], type: 'flowchart'|'sequence'|'class'|'er'|'state' } → `{ mermaid, item }`
- POST `/api/boards/:id/ai/flashcards` { itemIds: string[], title?: string } → `{ set }`
- POST `/api/boards/:id/ai/suggest-links` { itemIds?: string[] } → `{ suggestions: Array<{ sourceId, targetId, label? }> }`
- POST `/api/boards/:id/ai/cluster` {} → `{ groups: Array<{ title, itemIds: string[] }> }`

### 4.5 Memory APIs
- POST `/api/boards/:id/memory/upsert` { items: Array<{ kind, topic, summary, importance, embedding, payload }> } → `{ ok: true }`
- GET `/api/boards/:id/memory/search?query=...&k=5` → `{ items: [...] }`
- GET `/api/boards/:id/memory/top?k=5` → `{ items: [...] }`

### 4.6 Voice Integration
- Reuse existing endpoints:
  - STT: `POST /api/stt` multipart: `audio`
  - TTS: `POST /api/tts` or `GET /api/tts/stream?text=...`

### 4.7 Developer API Schemas (JSON)

BoardItem.content examples:
```json
// note
{ "text": "Idea: Build onboarding flow..." }

// checklist
{ "items": [ { "text": "Wireframes", "done": false }, { "text": "User testing", "done": false } ] }

// link
{ "url": "https://example.com", "title": "Launch doc", "desc": "Overview" }

// image (URL)
{ "url": "https://.../image.png", "caption": "User flow" }

// group (column)
{ "title": "Brainstorm", "color": "#334155" }
```

AI action request/response:
```json
// structure
{ "prompt": "Plan a mobile app MVP", "items": [ { "type": "group", "content": { "title": "Ideas" }, "x": 0, "y": 0, "w": 300, "h": 600 }, { "type": "note", "content": { "text": "User auth" }, "x": 320, "y": 40, "w": 240, "h": 140 } ] }

// summarize
{ "itemIds": ["abc","def"], "note": { "text": "Summary ..." } }

// flashcards
{ "itemIds": ["abc","def"], "set": { "id": "...", "title": "..." } }
```

---

## 5) Frontend Integration

### 5.1 Routes
- `/boards` → BoardsDashboard (list/create)
- `/boards/:id` → BoardCanvas (React Flow)

### 5.2 Libraries
- `reactflow` (canvas, nodes, edges, minimap, controls)
- `zustand` (optional) for local board state
- `weaviate-client` or pinecone/supabase vector client (if used directly; otherwise server mediates)

### 5.3 Components
- BoardCanvas: pan/zoom, selection, drag/resize; custom node types: NoteCard, ChecklistCard, LinkCard, ImageCard, GroupCard.
- BoardToolbar: add card, AI actions, zoom, export, voice toggle/PTT.
- BoardAIPanel: AI prompts (Structure, Summarize, Diagram, Flashcards, Suggest Links, Cluster).
- Voice controls: reuse existing mic/tts utilities from `lib/audio.ts` and `lib/api.ts`.

### 5.4 Settings & Personality
- Extend Settings to include:
  - `voiceMode`: boolean (Always Listening/Push-to-Talk/Off)
  - Personality editor mapped to `AIProfile` (tone/style/emotion/ttsVoice)

---

## 6) Vector Memory Architecture

### 6.1 Embedding Flow
- On selected events (create/edit card, AI response, explicit “Remember this”), server computes embeddings (OpenAI embedding model or same chat model with `text-embedding-3-small`) and upserts into `VectorMemory` or external vector DB.
- Metadata: `{ userId, boardId, kind, topic, summary, importance, payload }`.

### 6.2 Retrieval Flow
- On board open: fetch top-5 by `boardId` (vector + recency score) and inject into agent context.
- On summarize/cluster/suggest-links: retrieve relevant memories and merge into prompt.

### 6.3 External Store Option
- If enabling Pinecone/Weaviate/Supabase Vector: configure provider in settings; server stores vectors there, keeps pointer in DB.

---

## 7) Voice Mode Details

- STT: `POST /api/stt` (already implemented). Frontend mic pipeline reused from CallMode/AlwaysListening.
- TTS: prefer `/api/tts/stream` for low-latency during narration; fallback to `/api/tts` then WebSpeech.
- Respect user’s ElevenLabs/Web Speech preferences and expressive controls (stability/similarity/style/boost) already wired in headers.
- Voice triggers: keyword spotting piggybacks on existing wake word logic; commands parsed client-side then call board APIs.

---

## 8) Personality Customization

- Prisma `AIProfile` model; CRUD endpoints:
  - GET `/api/ai/profile` → current profile
  - POST `/api/ai/profile` { name?, tone?, style?, emotion?, ttsVoice? } → `{ ok: true }`
- Frontend Settings pane for AI Board Agent with preview (“Speak sample”).
- Agent prompt prelude built from profile (tone/style/emotion) + board context.

---

## 9) Developer API: Detailed Schemas

### 9.1 Requests
- `CreateBoard`: `{ title?: string }`
- `CreateItem`: `{ type: string, x: number, y: number, w: number, h: number, z?: number, rotation?: number, content: any }`
- `PatchItem`: partial of above
- `CreateEdge`: `{ sourceId: string, targetId: string, label?: string, style?: any }`

### 9.2 Responses
- `BoardFull`: `{ board: Board, items: BoardItem[], edges: BoardEdge[] }`
- `AI.Structure`: `{ items: BoardItem[] }`
- `AI.Summarize`: `{ note: { text: string }, item: BoardItem }`
- `AI.Diagram`: `{ mermaid: string, item: BoardItem }`
- `AI.Flashcards`: `{ set: StudySet }`
- `Memory.Search`: `{ items: VectorMemory[] }`

### 9.3 Error Codes
- `unauthorized`, `not_found`, `invalid_body`, `rate_limited`, `openai_not_configured`, `vector_not_configured`.

---

## 10) Security & Limits
- All endpoints behind `requireAuth`. Ownership checks on every board and item.
- Rate limit AI endpoints (per user) similar to Notes/Study endpoints.
- Sanitize Markdown/HTML in note content (reuse Notes rendering allowlist).

---

## 11) Rollout Plan

### Phase 1 (MVP)
- DB migrations for Board/Item/Edge/AIProfile/VectorMemory (or minimal subset: Board/Item + AIProfile; edges optional).
- Backend: Boards CRUD + Items CRUD + minimal Edges + AI endpoints: structure, summarize, diagram, flashcards.
- Frontend: /boards and /boards/:id with React Flow; AI panel for four core actions; voice toggle (PTT/Always Listening) with TTS narration.
- Export JSON/PNG; tests + docs.

### Phase 2
- Suggest-links, Cluster, Auto-Structurer, AI Threads, Memory top-k on open, Cross-board context; WS collaboration.

### Phase 3
- Study Mentor mode (voice quiz), Auto-Themes, deep Knowledge Graph integration, offline cache.

---

## 12) Dependencies
- `reactflow` – canvas, nodes, edges, controls, minimap
- `zustand` – local state (optional)
- Vector client (optional): `weaviate-client` or `@pinecone-database/pinecone` or `@supabase/supabase-js`
- Reuse existing: OpenAI SDK, `remark`/`rehype` pipeline for safe Markdown

---

## 13) OpenAI Models and Settings
- Chat: `gpt-4o`, fallback `gpt-4o-mini` (per Notes/Study)
- Embeddings: `text-embedding-3-small` (if embeddings added; else fallback to storing none in MVP)
- Honor header `x-openai-key` and DB/ENV fallbacks like existing code.

---

## 14) Example Prompts (System and User)

### 14.1 System Prompt (Agent)
```
You are Jarvis Board AI, an intelligent, voice-enabled agent integrated into Jarvis AI Boards.
Use the user’s AI profile for tone, style, and emotion. Be concise and actionable by default.
You have access to the current board context and short-term memory, and you may call tools to modify the board.
If voice mode is enabled, keep responses clear and speak them.
```

### 14.2 Structure Prompt (User → Tool)
```
Create a starter board for: {prompt}
Return JSON items: groups (columns) and notes/checklists with concise content.
Prioritize clarity; avoid duplicates. Place columns left to right.
```

### 14.3 Summarize Selection Prompt
```
Summarize the following selected cards concisely for an overview note:
- {title}: {excerpt}
...
Produce a short note (5-8 bullets).
```

### 14.4 Suggest Links Prompt
```
Given these cards, propose related pairs that should be connected with short labels.
Return JSON: [{ sourceId, targetId, label }]
```

---

## 15) Settings Extensions

- User settings additions (frontend storage + backend profile):
  - `voiceMode`: 'off' | 'ptt' | 'always'
  - `personalityProfile`: maps to `AIProfile`

---

## 16) Future Roadmap
- Real-time collaboration (presence cursors, selection sync) via `/ws/board/:id`.
- Image uploads with server storage and OCR-to-card.
- Board templates library & sharing; permissions model.
- Deeper study integration: per-section quick-generate flashcards/tests.
- Offline PWA cache for boards; background sync.
- Analytics: time on board, AI usage, memory insights.

---

## 17) Acceptance Criteria (Phase 1)
- Create/list/open a board; add/move/resize cards; changes persist.
- AI Structure generates columns and starter cards.
- Summarize Selection creates a new note card with concise summary.
- Diagram generation adds a diagram card using Mermaid.
- Flashcards action creates a Study Set and deep-links to it.
- Voice mode narrates actions/results using existing TTS settings.
- Build, lint, and minimal tests pass.

---

This document is complete. Upon approval, proceed with DB migration, backend endpoints, and frontend pages as outlined (Phase 1).
