# Architecture

- Frontend: React (Vite), served by Nginx in Docker. Dev server proxies `/api` to backend.
- Backend: Express + Prisma. Cookie-based sessions, rate limiting, CORS, file upload.
- Database: Postgres in Docker.
- Integrations: OpenAI for transcription, ElevenLabs for TTS (optional).

Key flows:
- Auth: signup -> (optional approval) -> signin -> session cookie -> /api/auth/me.
- Voice: browser records webm -> POST /api/transcribe -> post text to n8n webhook (Prod/Test selectable) -> poll /api/jarvis/callback/:id -> optional TTS.
- Text: post text directly to n8n webhook (Prod/Test selectable). If webhook replies immediately, show it; otherwise poll callback.

Event delivery
- Each browser session opens a WS/SSE channel `/api/events?sessionId=...&userId=...` bound to the signed‑in user. Backend can publish to a specific session or broadcast to all sessions for a user (`publishToUser`).

Call‑mode speech
- In call mode, the UI speaks via low‑latency streaming TTS (`/api/tts/stream`) and queues multiple messages sequentially. If streaming fails, it falls back to `/api/tts` with buffered playback.
- The UI auto‑unmutes at call start and restores the prior mute state when the call ends.

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
