# JarvisAIWebsite

A simple full-stack app with an Express/Prisma backend and a React (Vite) frontend. Includes auth (sessions via cookies), optional admin approvals, audio recording with browser MediaRecorder, transcription via OpenAI, direct n8n webhook integration, and optional ElevenLabs TTS.

Highlights
- Modern UI (at `/`) with chat and press‑to‑talk.
- Direct calls to your n8n webhook with a Test/Prod toggle.
- Callback polling via `/api/jarvis/callback/:id` with automatic retries and timeout.
- Optional per‑user API key overrides for OpenAI and ElevenLabs from the Settings panel.
	- ElevenLabs default voice is now `7dxS4V4NqL8xqL4PSiMp`. Users with their own ElevenLabs key can set a custom Voice ID in Settings and switch back anytime.
 - Token‑secured per‑user pushes from external systems (like n8n) to speak in the active session: `POST /api/integration/push-to-user` with `Authorization: Bearer <INTEGRATION_PUSH_TOKEN>`.
 - In call mode, the UI uses streaming TTS for low latency and queues messages; if streaming fails, it falls back to buffered TTS automatically.

## Quick start

- Prereqs: Docker and Docker Compose.
- Configure environment: copy and adjust `.env` at the repo root if needed. Defaults work for local.
	- DATABASE_URL points to dockerized Postgres by default.
	- Add OPENAI_API_KEY and ELEVENLABS_API_KEY if using those features.
	- Frontend webhook URLs: set `VITE_WEBHOOK_URL` (Prod) and `VITE_WEBHOOK_TEST_URL` (Test). The UI toggle persists in localStorage.
- Start the stack:

	docker compose up --build

- Open the app at http://localhost:5173

Default routing:
- Frontend: http://localhost:5173
- API proxied from frontend at `/api` -> backend http://localhost:8080
- Postgres exposed on 5432 for local inspection

Verify the webhook wiring
- Open the app at `/` and locate the sidebar control: “Webhook: [Prod] [Test]”.
- Send a message. In your browser Network tab you should see a POST to either:
	- Prod: `https://n8n.srv955268.hstgr.cloud/webhook/n8n`
	- Test: `https://n8n.srv955268.hstgr.cloud/webhook-test/n8n`
- The app then polls `GET /api/jarvis/callback/:correlationId` until your workflow posts a result to `POST /api/jarvis/callback`.

See also: `docs/N8N.md` for detailed n8n HTTP Request node examples (push/push-voice/call-end and callback). During calls, you should see two TTS requests when sending a voice push alongside the webhook reply (one for each message).

## Accounts

- Sign up at `/signup`. If `REQUIRE_ADMIN_APPROVAL=true`, new users start as pending; an admin must approve (admin tools live in the API; the standalone Dashboard has been removed in favor of the main Portal).
- Default admin (development):
	- Email: admin@example.com
	- Password: changeme (or override with `ADMIN_DEFAULT_PASSWORD`)
	- This user is created automatically when `SEED_DB=true` (enabled in docker-compose) and `ADMIN_EMAILS=admin@example.com`.
	- If the user already exists, the seeder will set the role to admin, mark status active, and reset the password to the default.
	- Change the password immediately in production.
- To make additional admins, set `ADMIN_EMAILS="admin@example.com,another@site.com"` before first run (or run the seed again with `SEED_DB=true`).
- Sign in at `/signin`.

## Environment variables

- `DATABASE_URL`: Postgres connection string for Prisma.
- `SESSION_SECRET`: Cookie signature secret.
- `BACKEND_PORT`: Port for backend (default 8080).
- `FRONTEND_ORIGIN`: CORS allowlist for backend.
- `OPENAI_API_KEY`: Enables transcription via OpenAI Whisper/gpt-4o-mini-transcribe.
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`: Enables TTS.
- `REQUIRE_ADMIN_APPROVAL`, `LOCK_NEW_ACCOUNTS`, `ADMIN_EMAILS`
- `VITE_WEBHOOK_URL`, `VITE_WEBHOOK_TEST_URL`: Frontend’s Prod/Test n8n webhook endpoints.
- `VITE_CALLBACK_URL`, `VITE_SOURCE_NAME`: Frontend callback path and source label.

Per-user API keys (optional)
- Users can supply their own OpenAI and ElevenLabs keys from the Settings panel. The frontend sends them via headers (`x-openai-key`, `x-elevenlabs-key`) so STT/TTS calls use user-supplied credentials; otherwise server defaults are used.
 - When a user supplies their own ElevenLabs key, they may also provide a Voice ID. The frontend sends `x-elevenlabs-voice-id`, and the backend will use it together with the custom key. Without a custom key, the backend uses the project’s default voice.

## Development without Docker

Backend:

	cd backend
	cp ../.env .env
	npm install
	npx prisma generate
	npm run dev

Frontend:

	cd frontend
	npm install
	npm run dev

The frontend dev server proxies `/api` to `http://localhost:8080`.

## Database

- Prisma schema is in `backend/prisma/schema.prisma`.
- At container start, the backend runs `prisma db push` and optional `prisma db seed` if `SEED_DB=true`.
- Inspect DB with psql:

	psql postgresql://postgres:postgres@localhost:5432/jarvis

## Troubleshooting

- 502 from frontend: Check backend logs and that `DATABASE_URL` is reachable.
- Auth not sticking: Ensure `SESSION_SECRET` is non-empty and browser accepts cookies.
- Transcription errors: Set `OPENAI_API_KEY` and verify model name via `TRANSCRIBE_MODEL` env (default whisper-1).
- TTS 500: Add `ELEVENLABS_API_KEY` and verify voice ID.
- Webhook errors: Confirm the toggle target, your n8n URL, and that your flow responds synchronously (optional) and/or calls back to `/api/jarvis/callback` with the `correlationId` provided in the webhook payload.
 - Voice push shows but doesn’t speak: ensure the user is in Call mode; check Network for `/api/tts/stream` followed by a `/api/tts` fallback if needed. Verify `INTEGRATION_PUSH_TOKEN` header when pushing via `/api/integration/push-to-user`.