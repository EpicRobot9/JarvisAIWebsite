# Architecture

- Frontend: React (Vite), served by Nginx in Docker. Dev server proxies `/api` to backend.
- Backend: Express + Prisma. Cookie-based sessions, rate limiting, CORS, file upload.
- Database: Postgres in Docker.
- Integrations: OpenAI for transcription, ElevenLabs for TTS (optional).

Key flows:
- Auth: signup -> (optional approval) -> signin -> session cookie -> /api/auth/me.
- Voice: browser records webm -> POST /api/transcribe -> post text to n8n webhook (Prod/Test selectable) -> poll /api/jarvis/callback/:id -> optional TTS.
- (Removed) Lecture Recorder: previously captured long-form audio to auto-generate a Study Set. This workflow is now unified under Jarvis Notes (record/transcribe -> summarize -> generate study assets) and the dedicated /lecture route has been removed.
- Import URL: client POST /api/import/url -> backend fetches page and extracts readable text -> client POST /api/study/generate.
	- In call mode, TTS prefers `/api/tts/stream` and maintains a FIFO queue. If streaming fails, it falls back to `/api/tts`, `/api/tts/fallback`, then Web Speech.
- Text: post text directly to n8n webhook (Prod/Test selectable). If webhook replies immediately, show it; otherwise poll callback.

Event delivery
- Each browser session opens a WS/SSE channel `/api/events?sessionId=...&userId=...` bound to the signed‑in user. Backend can publish to a specific session or broadcast to all sessions for a user (`publishToUser`).

Call‑mode speech
- In call mode, the UI speaks via low‑latency streaming TTS (`/api/tts/stream`) and queues multiple messages sequentially. If streaming fails, it falls back to `/api/tts` with buffered playback.
- The UI auto‑unmutes at call start and restores the prior mute state when the call ends.
 - Optional Continuous Conversation mode: after speaking, the UI may chime and re‑open the mic for a follow‑up with configurable no‑speech timeouts and a brief “Speak now…” nudge.
 - Push‑to‑Talk: Spacebar supports Hold (press/hold to talk) and Toggle (tap to start/stop). Optional start/stop chime reuses the Wake Chime preset/volume. PTT is disabled when focus is in inputs/textareas.

Webhook integration
- Frontend decides target URL based on a persisted toggle; defaults can be set via `VITE_WEBHOOK_URL` and `VITE_WEBHOOK_TEST_URL`.
- Every webhook POST includes: `{ chatInput, userid, correlationId, callbackUrl, source }`.
- Workflows can respond immediately (synchronous text) and/or later by POSTing to `/api/jarvis/callback` using the `correlationId`.

Directory layout:
TTS configuration and overrides
- Backend uses ElevenLabs with a default project voice (env `ELEVENLABS_VOICE_ID`, default `7dxS4V4NqL8xqL4PSiMp`).
- Users can set their own ElevenLabs API key and Voice ID in the portal Settings. When present, requests include headers `x-elevenlabs-key` and `x-elevenlabs-voice-id`. The backend only honors a custom voice id when a custom key is provided; otherwise it falls back to the project voice.

- backend/: Node/Express, Prisma schema/seed.
- frontend/: Vite React app, compiled to static files for Nginx.
- docker-compose.yml: Orchestration for db/backend/frontend.

Routes and surfaces:
- Portal UI: `/`
- Portal (legacy view): `/portal`
- Admin Panel: `/admin`
- Interstellar Admin: `/admin/interstellar`
- Interstellar Manager: `/interstellar`
- Study Dashboard: `/study`
- Study Tools:
  - Study Set View: `/study/sets/:id` (for guides, tests, mixed content)
  - Flashcard Viewer: `/study/sets/:id/flashcards` (main card browsing interface)
  - Study Mode: `/study/sets/:id/study` (interactive flashcard game)
  - Test Mode: `/study/sets/:id/test`
  - Match Games: `/study/sets/:id/match`

Jarvis Notes
- Page: `/notes` (Jarvis Notes)
	- Live transcript with Play/Stop. Pressing Play with an existing transcript appends new speech to it (no new note is created).
	- Auto‑summarize toggle: when enabled, Stop triggers summarization; otherwise use Manual Summarize.
	- History panel with search, titles, pinning. Updating an existing note avoids duplicate entries.
	- Notes render in Markdown with safe HTML collapsible sections (`<details><summary>…</summary>…</details>`).
	- A Home button links back to the main site.
 - Chunked summarization: long transcripts are split and summarized in chunks, then merged. The UI shows progress (e.g., “Summarizing 2/5”, “Merging…”) and suggests a title from the first heading of the generated notes (fallback: first 60 chars of the transcript).

Backend
- Summarize: `POST /api/notes/summarize` (tries `gpt-4o`, falls back to `gpt-4o-mini`). Accepts `instructions`, `collapsible`, `categories`; defaults `collapsible/categories` to true when unset.
- Settings: `GET/POST /api/notes/settings` — per‑user prefs: instructions, collapsible, categories, icon, color, expandAll, expandCategories.
- CRUD: `POST/GET/PATCH/DELETE /api/notes` — store transcript, notes, title, pinned.

Rendering & safety
- Frontend uses `react-markdown` + `remark-gfm` + `rehype-raw` + `rehype-sanitize` with allowlisted `details/summary` tags.
- UI supports configurable disclosure icon (triangle/chevron/plus‑minus), accent color, and auto‑expand behavior (all or top‑level only).
