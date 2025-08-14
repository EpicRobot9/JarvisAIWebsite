# Architecture

- Frontend: React (Vite), served by Nginx in Docker. Dev server proxies `/api` to backend.
- Backend: Express + Prisma. Cookie-based sessions, rate limiting, CORS, file upload.
- Database: Postgres in Docker.
- Integrations: OpenAI for transcription, ElevenLabs for TTS (optional).

Key flows:
- Auth: signup -> (optional approval) -> signin -> session cookie -> /api/auth/me.
- Voice: browser records webm -> POST /api/transcribe -> post text to n8n webhook (Prod/Test selectable) -> poll /api/jarvis/callback/:id -> optional TTS.
- Text: post text directly to n8n webhook (Prod/Test selectable). If webhook replies immediately, show it; otherwise poll callback.

Webhook integration
- Frontend decides target URL based on a persisted toggle; defaults can be set via `VITE_WEBHOOK_URL` and `VITE_WEBHOOK_TEST_URL`.
- Every webhook POST includes: `{ chatInput, userid, correlationId, callbackUrl, source }`.
- Workflows can respond immediately (synchronous text) and/or later by POSTing to `/api/jarvis/callback` using the `correlationId`.

Directory layout:
- backend/: Node/Express, Prisma schema/seed.
- frontend/: Vite React app, compiled to static files for Nginx.
- docker-compose.yml: Orchestration for db/backend/frontend.
