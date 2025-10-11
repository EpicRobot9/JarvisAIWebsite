# JarvisAIWebsite

A simple full-stack app with an Express/Prisma backend and a React (Vite) frontend. Includes auth (sessions via cookies), optional admin approvals, audio recording with browser MediaRecorder, transcription via OpenAI, direct n8n webhook integration, and optional ElevenLabs TTS.

Highlights
- Modern UI (at `/`) with chat and press‑to‑talk.
- Jarvis Notes at `/notes`: capture live transcripts and summarize into organized notes with optional collapsible sections. Per‑user preferences (instructions, categories/collapsible, icon, color, expand behavior) at `/notes/settings`.
- Always‑Listening mode with wake word (“Jarvis”) and hands‑free flow.
- Wake word customization: multiple phrases, optional chime, volume, presets, and custom sound upload with Test button.
- Import/Export of wake/chime settings (JSON) and a Save‑required banner after import.
- VAD endpointing to auto‑stop: selectable engine (JS or WASM MicVAD) with tuning controls (SNR thresholds, hangover, silence floor, check interval) and hybrid Web Speech endpointing.
- Debug tools: Wake Word Debug panel with live VAD meters and a “Verbose VAD logs” toggle.
- Direct calls to your n8n webhook with a Test/Prod toggle.
- Callback polling via `/api/jarvis/callback/:id` with automatic retries and timeout.
- Optional per‑user API key overrides for OpenAI and ElevenLabs from the Settings panel.
	- ElevenLabs default voice is now `7dxS4V4NqL8xqL4PSiMp`. Users with their own ElevenLabs key can set a custom Voice ID in Settings and switch back anytime.
	- **NEW**: Voice presets - Choose from 14 curated ElevenLabs voices (Rachel, Antoni, Adam, etc.) or use custom voice IDs.
- Three-tier TTS fallback system: ElevenLabs → eSpeak-NG → Web Speech API ensures audio always works.
- Token‑secured per‑user pushes from external systems (like n8n) to speak in the active session: `POST /api/integration/push-to-user` with `Authorization: Bearer <INTEGRATION_PUSH_TOKEN>`.
- In call mode, the UI uses streaming TTS for low latency and queues messages; if streaming fails, it falls back to buffered TTS automatically.
 - NEW: Push‑to‑Talk modes — Hold or Toggle (Spacebar) — plus optional chime on start/stop (reuses Wake Chime preset/volume). PTT ignores inputs/textareas to prevent conflicts.

Explore net‑new feature ideas and roadmap proposals in `docs/NEW_FEATURES_PROPOSALS.md`.

Jarvis Notes improvements
- NEW: Chunked summarization for long transcripts with a compact progress indicator (e.g., “Summarizing 2/5”, then “Merging…”)
- NEW: Smart title suggestion — uses the first heading from generated notes, else the first 60 characters of the transcript

## Study Tools & Learning Features

- **Study Dashboard** (`/study`): Unified interface for creating and managing study content
- **AI-Generated Study Materials**: Create study guides, flashcards, tests, and match games from any content
- **Enhanced Study Guides**: Interactive guides with progress tracking, bookmarks, personal notes, and section navigation
- **Smart Customization**: Control study duration (10-120min), difficulty level, learning style, and content inclusions
- **Flashcard System**: Spaced repetition with SRS algorithm, study modes, and progress tracking
- **Study Tools Integration**: Generate flashcards, tests, and match games directly from study guide headers
- **Bidirectional Linking**: Seamless navigation between study guides and their generated materials
- **Progress Persistence**: All study progress saved to database and synced across sessions
- **Quick Presets**: Pre-configured templates for common study scenarios (quick review, exam prep, deep dive, etc.)

Detailed documentation:
- Study guide improvements: `docs/STUDY_GUIDE_IMPROVEMENTS.md`
- Customization features: `docs/STUDY_GUIDE_CUSTOMIZATION.md`

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

Always‑Listening, wake word, and VAD docs
- Overview and how‑to: `docs/WAKE_WORD_ALWAYS_LISTENING.md`
- Voice presets and TTS fallback: `docs/VOICE_PRESETS.md`
 - Jarvis Notes: `docs/API.md#jarvis-notes-api`, `docs/SETTINGS.md#jarvis-notes-settings`, and the architecture section in `docs/ARCHITECTURE.md`.

## Production deployment

- Target: Hostinger VPS (Ubuntu 24.04) + Cloudflare domain
- Domain used in this project: https://techexplore.us

Recommended path: Cloudflare Tunnel for zero‑downtime and no port conflicts with existing apps.

Docs:
- Step‑by‑step guide: `docs/DEPLOYMENT.md`
- Environment reference: `docs/ENV.md`
 - DB persistence & migrations: `docs/DB_PERSISTENCE.md`

Quick commands (from the repo root on the VPS):

```
# internal-only services, no host ports
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# add Cloudflare Tunnel (set CLOUDFLARE_TUNNEL_TOKEN in .env first)
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml up -d --build
```

With the tunnel active and a Public Hostname configured to `http://frontend:80`, the site is served securely at `https://techexplore.us` without changing other containers on the VPS.

One‑liner installer (keeps your .env as‑is except `FRONTEND_ORIGIN` when domain is provided):

```
bash <(curl -fsSL https://raw.githubusercontent.com/EpicRobot9/JarvisAIWebsite/main/scripts/install.sh) --domain techexplore.us --token <CLOUDFLARE_TUNNEL_TOKEN>
```

Clean rebuild tip

If things look cached or the admin password didn’t reset as expected, do a from‑scratch rebuild:

```
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml down --volumes --rmi all --remove-orphans
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml build --no-cache --pull
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml up -d
# optional one-time reset and summary
./scripts/update.sh --admin-user admin --admin-password 'Admin123!' --admin-reset once
```
See more in `docs/DEPLOYMENT.md`.

Full wipe (dangerous; erases everything)

If you need to completely remove Jarvis as if it was never installed — containers, images (best‑effort), database/data, and even the install directory — use the helper script:

```
# interactive: asks you to type NUKE
./scripts/full-wipe.sh

# non-interactive: no prompts
./scripts/full-wipe.sh -y

# with custom compose project name
./scripts/full-wipe.sh -p techexplore -y
```

Notes
- This runs `scripts/uninstall.sh` with `--purge --nuke` (and `--force` when you pass `-y`).
- It will delete the entire repo directory (`DIR_ROOT`). Make sure you have backups if needed.
- After wiping, re-clone or re-run the installer to bring the app back.

## Accounts

- Sign up at `/signup`. If `REQUIRE_ADMIN_APPROVAL=true`, new users start as pending; an admin must approve (admin tools are in the Admin page of the app).
- Default admin (development):
	- Username: `admin`
	- Password: `changeme` (override with `ADMIN_DEFAULT_PASSWORD`)
	- In production, the bootstrap default is also `changeme` unless you set `ADMIN_DEFAULT_PASSWORD`.
	- Admin bootstrap can be seeded on start when `SEED_ON_START=true`. You can set `ADMIN_USERNAMES` to a comma‑separated list; default includes `admin`.
	- If the user already exists, the seeder will set the role to admin, mark status active, and reset the password to the default.
	- Password behavior: `ADMIN_SEED_MODE=ensure` (default) keeps existing passwords; set `ADMIN_SEED_MODE=reset` to force resetting to `ADMIN_DEFAULT_PASSWORD`.
	- Change the password immediately in production.
- Backward compatibility: you can still specify `ADMIN_EMAILS` to bootstrap admins from email addresses; the seeder will treat them as usernames if `ADMIN_USERNAMES` isn’t set.
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
- At container start, the backend runs `prisma migrate deploy` and optional `prisma db seed` when `SEED_ON_START=true`.
- Inspect DB with psql:

	psql postgresql://postgres:postgres@localhost:5432/jarvis

## Troubleshooting

- 502 from frontend: Check backend logs and that `DATABASE_URL` is reachable.
- Auth not sticking: Ensure `SESSION_SECRET` is non-empty and browser accepts cookies.
- Transcription errors: Set `OPENAI_API_KEY` and verify model name via `TRANSCRIBE_MODEL` env (default whisper-1).
- TTS 500: Add `ELEVENLABS_API_KEY` and verify voice ID.
- Webhook errors: Confirm the toggle target, your n8n URL, and that your flow responds synchronously (optional) and/or calls back to `/api/jarvis/callback` with the `correlationId` provided in the webhook payload.
 - Voice push shows but doesn’t speak: ensure the user is in Call mode; check Network for `/api/tts/stream` followed by a `/api/tts` fallback if needed. Verify `INTEGRATION_PUSH_TOKEN` header when pushing via `/api/integration/push-to-user`.