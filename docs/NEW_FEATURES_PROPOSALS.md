# Net‑New Feature Proposals for Jarvis AI Website

This document proposes green‑field features that build on the current voice, study, and workflow foundations. Each item includes a quick value pitch, a minimal scope for v1, and concrete integration points in this codebase.

## Summary of Top Candidates

1) Real‑time streaming conversation (full‑duplex)  
2) Live classroom quiz sessions (multi‑user)  
3) (Deprecated) Lecture recorder → auto study set (merged into Jarvis Notes flow)  
4) Role‑play simulator (interview/OSCE/language)  
5) Offline PWA mode with local study & TTS cache  
6) Personal knowledge graph explorer  
7) Study set sharing & marketplace  
8) URL/Document import → study set  
9) Voice command macros & bookmarks  
10) Expressive TTS with emotion/prosody controls

---

## 1) Real‑time Streaming Conversation (Full‑Duplex)

- Value: Natural, low‑latency back‑and‑forth; barge‑in while TTS is speaking. Great for “hands‑free” assistant mode.
- v1 user flow: Press space (or wake word), audio streams immediately to backend; interim ASR shown; assistant streams partial text + audio.
- Backend:
  - New WebSocket endpoint: `GET /ws/stream` (auth via cookie/JWT).
  - Subsystems: STT (streaming, e.g., Whisper RT/Deepgram/OpenAI Realtime), TTS stream chunker.
  - Pub/sub per session; back‑pressure and silence/endpointing.
  - Files: `backend/server.ts` (WS route), optional `backend/realtime.ts` helper.
- Frontend:
  - Hook: `src/hooks/useStreamingCall.ts` using `WebSocket` and `AudioWorklet` for mic frames.
  - UI: Add “Streaming Mode” toggle in `SettingsPanel.tsx`; badge in `CallMode.tsx`.
  - Reuse: `lib/audio.ts` for output queue but add `playStreamUrl`/`enqueueStreamUrl` variants for chunked PCM/OGG.
- Data: ephemeral; sessions keyed by `sessionId`.
- Effort: High (2–3 sprints). Start with server echo prototype + client mic streaming.

## 2) Live Classroom Quiz Sessions (Multi‑user)

- Value: Teachers host live quizzes; students join via link; real‑time scoreboard and explanations; uses existing MCQ/test generator.
- v1 flow: Host creates session from a Study Set; participants join; host starts rounds; live answers; show leaderboard.
- Backend:
  - New models: `QuizSession`, `QuizParticipant`, `QuizQuestion`, `QuizAnswer` (Prisma migrations).
  - WS endpoint: `/ws/quiz/:sessionId` for host <-> participants events.
  - REST: `POST /api/quiz/sessions` (create), `POST /api/quiz/sessions/:id/start`, `POST /api/quiz/sessions/:id/next`, `GET /api/quiz/sessions/:id/state`.
- Frontend:
  - New pages: `src/pages/quiz/Host.tsx`, `src/pages/quiz/Join.tsx`.
  - Components: `QuizStage`, `Leaderboard`, `JoinCodeModal`.
  - Integrate with existing `generateStudySet` to seed questions.
- Effort: Medium‑High (1–2 sprints). Start with single host, 10 participants, MCQ only.

## 3) (Deprecated) Lecture Recorder → Auto Study Set
Replaced by unified Jarvis Notes capture + generate flow; keeping historical context only.

- Value: One‑click capture of a lecture/talk; produces summary, key terms, flashcards, and test.
- v1 flow: User records long‑form audio in browser; upload in chunks; server transcribes and returns a Study Set.
- Backend:
  - REST: `POST /api/lectures` (create & begin), `POST /api/lectures/:id/chunk` (webm chunks), `POST /api/lectures/:id/finalize` → kicks `generateStudySet` with transcript.
  - Storage: local disk or S3; background worker optional (node queue).
  - Reuse: existing study generation pipeline (`/api/study/generate`).
- Frontend:
  - Page: `src/pages/LectureRecorder.tsx` with timer, waveform, size indicator.
  - Hook: `src/hooks/useLectureRecorder.ts` (MediaRecorder chunking, retry, resume).
  - On finalize: navigate to Study Set detail.
- Effort: Medium (1 sprint). Start with 60–90 min cap and single file.

## 4) Role-Play Simulator (Interview/OSCE/Language)

- Value: Conversational practice with scenario roles; instant feedback and rubric‑based grading; leverages TTS + mic.
- v1 flow: Select scenario preset; PTT/stream talk; system maintains role; at end produces evaluation + follow‑ups.
- Backend:
  - REST: `POST /api/roleplay/start` (config), `POST /api/roleplay/message` (text/audio), `POST /api/roleplay/finish`.
  - Uses OpenAI for role consistency and rubric scoring; output JSON.
- Frontend:
  - Page: `src/pages/RolePlay.tsx`.
  - Components: `ScenarioPicker`, `RubricPanel`, `TranscriptTurns`.
  - Hooks: reuse `useCallSession` initially; later upgrade to streaming.
- Effort: Medium (0.5–1 sprint). Start with 3 scenarios and text+TTS.

## 5) Offline PWA Mode with Local Study & TTS Cache

- Value: Works during commutes or flaky internet; keep studying and listening to cached audio.
- v1 flow: Installable PWA; user toggles “Make available offline” for study sets; TTS audio cached for each item.
- Backend: no change (optional `/api/offline/manifest` to hint assets).
- Frontend:
  - Service Worker + `workbox` build step (Vite): cache shell + `StudySet` pages.
  - Extend `lib/audio.ts` TTS cache for per‑message persistent storage (IndexedDB).
  - UI: Offline badge + “Preload” button in Study Set view.
- Effort: Medium (1 sprint). Start with read‑only + audio playback offline.

## 6) Personal Knowledge Graph Explorer

- Value: See concepts across notes and study sets; navigate relationships and coverage gaps; boosts retention.
- v1 flow: Build graph from key terms, headings, Q/A pairs; render interactive force graph.
- Backend:
  - Add `Concept` and `ConceptLink` tables; or compute ephemeral graph from existing content.
  - REST: `GET /api/graph` returns nodes/edges JSON; optional `/api/graph/rebuild`.
- Frontend:
  - Page: `src/pages/Graph.tsx` using `d3-force` or `react-force-graph`.
  - Click to open source note/study set.
- Effort: Medium (1 sprint). Start with static build; later add embeddings.

## 7) Study Set Sharing & Marketplace

- Value: Users publish curated sets; discover, rate, and remix; optional organization workspace.
- Backend:
  - Tables: `StudySetPublic`, `Rating`, `Tag`, `ForkOf`.
  - REST: `POST /api/study/sets/:id/publish`, `GET /api/study/browse`, `POST /api/study/sets/:id/fork`.
- Frontend:
  - Pages: `src/pages/study/Browse.tsx`, `src/pages/study/SetPublic.tsx`.
  - Components: `TagChips`, `StarRating`, `ForkButton`.
- Effort: Medium‑High (1–2 sprints). Start with simple publish/browse.

## 8) URL/Document Import → Study Set

- Value: Turn webpages, PDFs, or docs into study material instantly.
- v1 flow: User pastes URL or uploads PDF; server extracts text; generate study set.
- Backend:
  - REST: `POST /api/import/url` (fetch + sanitize) and `POST /api/import/file` (PDF via `pdf-parse`).
  - Reuse `/api/study/generate` downstream.
- Frontend:
  - Page: `src/pages/Import.tsx` with URL/file picker + progress.
- Effort: Medium (0.5–1 sprint). Start with URL + simple PDFs.

## 9) Voice Command Macros & Bookmarks

- Value: Hands‑free control and quick marking of moments or facts during calls/lectures.
- v1 flow: Phrases like “bookmark that”, “new flashcard: front … back …”, “repeat last answer”.
- Backend: none required initially; parse client‑side then call existing APIs (`generateStudySet`, `gradeFlashcard`, etc.).
- Frontend:
  - Extend `useCallSession` to detect commands before webhook send (client intent parser).
  - New `lib/commands.ts` to map phrase → action.
- Effort: Low‑Medium (0.5 sprint). Start with 4–5 commands.

## 10) Expressive TTS with Emotion/Prosody Controls

- Value: More engaging voice output for learning; emphasize key points, pace changes for example/definition.
- v1 flow: Per‑message emotion (e.g., neutral, excited, serious) and rate/pitch; preset buttons in UI.
- Backend:
  - Extend `/api/tts` to accept optional `emotion`, `rate`, `pitch` metadata (headers or JSON) and pass to provider if supported; fallback adjusts Web Speech rate.
- Frontend:
  - Update `SettingsPanel.tsx` for default emotion/rate; quick controls near reply playback.
  - Update `getTtsStreamUrl(text, meta)` in `lib/api.ts` and queue in `lib/audio.ts`.
- Effort: Low‑Medium (0.5 sprint). Starts as metadata with partial provider support.

---

## Prioritization and Suggested Roadmap

- Impact vs Effort (H/M/L):
  - 1) Streaming conversation: Impact H / Effort H
  - 3) Lecture recorder → study set: Impact H / Effort M (deprecated, integrated into Notes)
  - 4) Role‑play simulator: Impact H / Effort M
  - 5) Offline PWA: Impact M / Effort M
  - 8) URL/PDF import: Impact M / Effort M
  - 9) Voice macros: Impact M / Effort L

Recommended 2‑sprint plan:
- Sprint 1: (a) 3) Lecture recorder v1, (b) 9) Voice macros, (c) 8) URL import (URL only).
- Sprint 2: (a) 4) Role‑play simulator v1, (b) 5) Offline PWA shell, (c) spike on 1) streaming WS prototype.

---

## (Historical) Minimal File Touches for Lecture Recorder (Deprecated)

- Backend
  - `backend/server.ts`: new routes `/api/lectures`, `/api/lectures/:id/chunk`, `/api/lectures/:id/finalize`.
  - `backend/prisma/schema.prisma`: optional `Lecture` table with status, duration, transcript, studySetId.
  - `backend/scripts/` optional worker for transcription.
- Frontend
  - `frontend/src/pages/LectureRecorder.tsx` (new page).
  - `frontend/src/hooks/useLectureRecorder.ts` (chunking and retries).
  - `frontend/src/lib/api.ts`: client helpers for the new endpoints.
  - Navigation entry point (button in main UI or settings).

This keeps scope tight while delivering a brand‑new capability aligned with the product’s strengths.

---

## Notes

- Features above intentionally avoid refactoring existing flows; each can be built incrementally and feature‑flagged.
- For multi‑user items, we recommend a lightweight WS bus and simple room state before scaling out.

---


Implementation status (Autumn 2025):

**Implemented:**
- Real-time streaming conversation (full-duplex):
  - WS streaming endpoint + client hook + barge-in audio queue.
- Offline PWA mode with local study & TTS cache:
  - Manifest, service worker, offline shell & cached TTS playback for sets.
- Personal knowledge graph explorer:
  - Ephemeral graph builder + interactive `Graph.tsx` force layout.
- Study set sharing & marketplace (ephemeral v1):
  - Publish / browse / fork endpoints and UI pages.
- Expressive TTS with emotion/prosody controls:
  - Emotion + rate/pitch metadata plumbed through `/api/tts` and UI presets.
- URL & Document import → study set (multi-format with advanced OCR & analysis):
  - `/api/import/url` + enhanced `/api/import/file` (PDF embedded + raster OCR fallback, DOCX, PPTX, header/footer dedupe, analysis: sections/tables/flashcards, slide meta, length guard, toggles for OCR & analysis).
  - OCR: rasterizes up to first 15 pages when embedded text sparse and `ocr=true`.
- Live classroom quiz sessions (multi-user) with game modes:
  - In‑memory room manager, `/ws/quiz` events (lobby/question/reveal/end), modes: Classic, Gold Quest (gold + steals), Battle Royale (lives/elimination).
  - Host-configurable options (question time, steal %, lives), per-round stats, leaderboard.
  - Quiz summaries persisted: Prisma `QuizSummary` model + `/api/quiz/summary/:roomId` & `/api/quiz/summaries` + Past Games page.
- Discoverability enhancements:
  - Sidebar navigation exposing Graph, Shared Sets, Roleplay, Lecture, Import, Bookmarks, Live Quiz, Past Games.

**In Progress:**
- Deeper semantic enrichment (Phase 3): embeddings for concept linking, multi-language OCR, structural table normalization.

**Pending / Next Candidates:**
- Persistent quiz analytics dashboard (aggregate stats across games).
- Marketplace quality signals (ratings → recommendation heuristics).

Docs updated: Architecture and API reflect quiz summary endpoints and file import expansion.