# AI Board – Next Features Plan

Date: 2025-10-13

This short plan enumerates the immediate “Next (planned)” features, their dependencies, and the backend/frontend work we’ll implement next. It aligns with the AI_Board_Agent_Features.md (status as of 2025-10-13).

## Next features (bullet list)

- AI
  - Suggest Links: propose edges between semantically related cards (notes/checklists/links).
  - Cluster: auto-group related items and create “group” cards; apply auto-structurer layout improvements.
- Memory
  - Enable VectorMemory schema and APIs for upsert and search (and top-k retrieval).
  - Integrate memory retrieval into AI prompts for better context and cross-board linking.
  - Pluggable vector provider: in-DB embeddings first; external store optional later (Supabase Vector/Pinecone/Weaviate).
- Voice
  - Voice narration toggle within Board view.
  - Integrate Always Listening and Push-to-Talk for voice commands on boards.
- Collaboration & Export
  - Real-time presence/sync via SSE or WebSocket (phase 1: SSE stream + simple broadcast hooks).
  - Export board to JSON and PNG.
- UI Enhancements
  - New card types: checklist, link, image, group (server already supports types; expand UI renderers).
  - Edge labels and drag handles.
  - Toolbar improvements with AI, link, voice toggles, and visual feedback when clustering/linking occurs.
  - Optimistic UI with rollback on errors.

## Dependencies and touchpoints

- Backend
  - Prisma model enablement for VectorMemory.
  - Endpoints for vector upsert/search, board AI suggest-links/cluster, optional SSE stream, and export routes.
  - OpenAI usage for embeddings and (optionally) group titles.
  - Respect existing auth/session, ownership checks, and header overrides (x-openai-key, x-elevenlabs-* where applicable).
- Frontend
  - API helpers for new endpoints (suggest-links, cluster, vector-memory upsert/search).
  - BoardView toolbar additions; accept edges/groups results and update canvas state.
  - Optional voice toggle leveraging existing TTS/STT utilities and Always Listening component.
- Vector Memory
  - Store embeddings in Postgres (Float[]) for initial iteration; naive cosine search in app layer.
  - Later: add external vector DB adapter if configured (provider key in settings/env).
- UI
  - Extend card rendering for checklist/link/image/group; show edge labels; basic handles.
  - Visual feedback (toasts, spinners) during AI operations.

## Schema migrations (Prisma)

Add VectorMemory model (first-party store):

```
model VectorMemory {
  id         String   @id @default(cuid())
  userId     String
  boardId    String
  kind       String   // 'card' | 'summary' | 'agent' | 'intent'
  topic      String   @default("")
  summary    String   @default("")
  importance Int      @default(0)
  embedding  Float[]
  payload    Json
  createdAt  DateTime @default(now())

  @@index([userId, boardId])
}
```

Notes:
- Uses Postgres double precision arrays for embeddings. For external vector stores, keep this as a metadata table (or stub) and store vectors remotely.
- No FKs to User/Board to keep migrations simple; ownership enforced in queries.

## New/updated endpoints (server)

- AI (Boards)
  - POST `/api/boards/:id/ai/suggest-links` → `{ edges: BoardEdge[] }`
    - Computes embeddings for selected/all items, finds similar pairs, creates edges (dedup), returns created edges.
  - POST `/api/boards/:id/ai/cluster` → `{ groups: Array<{ title: string, itemIds: string[] }>, groupItems: BoardItem[], updatedItems?: BoardItem[] }`
    - Embedding-based clustering; creates “group” cards and applies an auto-structurer layout (columns) and returns changes.

- Memory
  - POST `/api/vector-memory/upsert` `{ items: Array<{ boardId, kind, topic, summary, importance, embedding?, payload, text? }> }` → `{ ok: true, count }`
  - GET `/api/vector-memory/search?boardId=...&query=...&k=5` → `{ items: VectorMemory[] }`
  - Convenience aliases (optional):
    - POST `/api/boards/:id/memory/upsert`
    - GET `/api/boards/:id/memory/search?query=...&k=5`

- Collaboration (phase 1)
  - GET `/api/boards/:id/stream` (SSE): presence heartbeats + server-originated updates (hook points in CRUD/AI routes).

- Export
  - GET `/api/boards/:id/export.json` → `{ board, items, edges }`
  - GET `/api/boards/:id/export.png` → PNG snapshot (basic server-side rendering of boxes/text via node-canvas).

## Frontend tasks

- Add API helpers: `aiSuggestLinks(boardId)`, `aiCluster(boardId)`, `vectorUpsert()`, `vectorSearch()`.
- Update `BoardView` toolbar: Suggest Links, Cluster, Voice toggle; show progress and results.
- Extend card UIs for new types; minimal text-only rendering for link/image initially (image by URL).
- Optional: small “preview overlay” summarizing clusters/links before applying.

## Validation and rollout

- Start with server-first (routes + schema). Add minimal UI buttons wired to endpoints.
- Verify typecheck/lint; run `prisma db push` on dev; ensure auth and ownership checks.
- Smoke test suggest-links/cluster on a sample board; verify layout updates and edge dedup.
- Add quick demo script steps to README for clustering/linking and voice narration.

## Update (implemented in this iteration)

- Boards voice control: Added a press-to-talk button in `BoardView` using the existing `useCallSession` hook. Recognized commands are parsed by a new `parseBoardCommand` in `frontend/src/lib/commands.ts` and mapped to board actions (create note with optional dictated text, suggest links, cluster, link/unlink, summarize/diagram selection, selection/view helpers). Short confirmations are spoken via the TTS stream queue.
- PNG export: Added client-side export using `html2canvas` (`frontend/src/lib/export.ts`) and an "Export PNG" button in the Board toolbar that captures the canvas.
