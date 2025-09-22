# Backend API

Base URL: `/api`

Auth
- POST `/auth/signup` { email, password }
- POST `/auth/signin` { email, password } -> sets signed cookie
- POST `/auth/signout`
- GET `/auth/me` -> null or { id, email, role, status }

Admin
- GET `/admin/pending`
- POST `/admin/approve` { userId }
- POST `/admin/deny` { userId }

Integration (token-secured; no cookie)
- POST `/integration/push-to-user`
	- Auth: `Authorization: Bearer <INTEGRATION_PUSH_TOKEN>` (or `x-api-token` header or `?token=` query)
	- Body:
		```json
		{ "userId": "..." | null, "email": "user@example.com" | null, "text": "message", "say": false, "voice": false, "role": "assistant" }
		```
		- Provide either `userId` or `email`.
		- If `voice` is true, the UI will stream TTS and play in sequence.
		- If `say` is true on text push, the UI will TTS and play.
		- `role` defaults to `assistant`.
		- Delivery: messages are broadcast to all active sessions for the userId bound to their event channel.

Voice/Callbacks
- POST `/transcribe` multipart-form: file(webm), correlationId
- POST `/jarvis/callback` { correlationId, result }
- GET `/jarvis/callback/:id` -> stored callback result or null
- POST `/tts` { text } -> audio/mpeg (if ELEVENLABS_API_KEY)
	- Uses default voice `ELEVENLABS_VOICE_ID` (defaults to `7dxS4V4NqL8xqL4PSiMp`).
	- If the client supplies `x-elevenlabs-key`, the call will use that key; and if `x-elevenlabs-voice-id` is also provided, it will use that voice id. Without a custom key, the project key and default voice are used.
- GET `/tts/stream?text=...&opt=2[&key=...][&voiceId=...]` -> low‑latency streaming audio/mpeg
	- The UI uses this for in‑call speech and voice pushes. If the stream fails, the UI falls back to `/api/tts` automatically.
	- If buffered TTS fails, the UI will try `/api/tts/fallback` (eSpeak) and finally Web Speech.

Frontend → n8n webhook (direct)
- The frontend posts to either `VITE_WEBHOOK_URL` or `VITE_WEBHOOK_TEST_URL` with JSON:
	```json
	{
		"chatInput": "hello",
		"userid": "user-id-or-anon",
		"correlationId": "uuid-v4",
		"callbackUrl": "/api/jarvis/callback",
		"source": "jarvis-portal",
		"sessionId": "<web-session-id>",
		"messageType": "TextMessage" // or "CallMessage" when sent from voice/call flow
	}
	```
- The workflow may:
	- Reply immediately with a string or JSON body (shown to the user), and/or
	- POST later to `/api/jarvis/callback` with the same `correlationId`.

Per-user API key override headers
- STT: frontend adds `x-openai-key` when present.
- TTS: frontend adds `x-elevenlabs-key` when present. If also configured, it sends `x-elevenlabs-voice-id` which is honored only when a custom key is used.

Notes
- All endpoints except signup/signin/me require authenticated session (`requireAuth`).
- Admin endpoints require user.role === 'admin'.
- Integration endpoints require a valid `INTEGRATION_PUSH_TOKEN` (comma-separated list allowed).
 - Call‑mode behavior: the UI auto‑unmutes when entering a call and restores the previous mute state after the call ends. Voice pushes are always spoken during an active call.
 - Continuous Conversation (optional): after the assistant reply ends, the UI can play a chime and start a follow‑up recording; if no speech is detected within configured timeouts, the mic closes and wake‑word listening resumes.

## Jarvis Notes API

All Notes APIs require an authenticated session.

Summarize transcript
- POST `/notes/summarize`
	- Headers (optional): `x-openai-key: <user-openai-key>` to override server key
	- Body:
		```json
		{
			"text": "full transcript text",
			"instructions": "optional extra guidance for the note-taker",
			"collapsible": true,
			"categories": true
		}
		```
		- `collapsible` and `categories` default to true when unspecified (either here or in saved settings).
	- Response: `{ "notes": "markdown+html output", "model": "gpt-4o|gpt-4o-mini" }`

Per-user Notes Settings
- GET `/notes/settings` -> returns current preferences
	```json
	{
		"instructions": "",
		"collapsible": true,
		"categories": true,
		"icon": "triangle|chevron|plusminus",
		"color": "slate|blue|emerald|amber|rose",
		"expandAll": false,
		"expandCategories": false
	}
	```
- POST `/notes/settings`
	- Body (any subset accepted):
		```json
		{
			"instructions": "...",
			"collapsible": true,
			"categories": true,
			"icon": "triangle",
			"color": "slate",
			"expandAll": false,
			"expandCategories": false
		}
		```
	- Response: `{ "ok": true }`

Notes CRUD
- POST `/notes` { transcript, notes?, title?, pinned? } -> create
- GET `/notes?query=...&take=50&cursor=<id>[&pinned=true]` -> list with search/cursor
- PATCH `/notes/:id` { transcript?, notes?, title?, pinned? } -> partial update
- DELETE `/notes/:id` -> delete one
- DELETE `/notes` -> clear all for current user

Rendering note content
- The frontend renders Markdown with support for safe HTML `<details><summary>...</summary>...</details>` blocks when `collapsible` is enabled. Sanitization is enforced; only allowed tags/attributes are permitted.

## Study Tools API

All Study APIs require an authenticated session.

Generate study set
- POST `/study/generate` { subject?, info?, noteIds?: string[], tools?: ["guide"|"flashcards"|"test"|"match"], title? }
	- Returns `{ ok: true, set }` where `set.content` may contain any of the requested tools.

List and read
- GET `/study/sets?take=50&cursor=<id>` -> `{ items, nextCursor }`
- GET `/study/sets/:id` -> full StudySet row
- DELETE `/study/sets/:id` -> `{ ok: true }`

Grading (free study mode)
- POST `/study/grade` { front, expectedBack, userAnswer } -> `{ correct: boolean, explanation?: string }`

Spaced Repetition (SRS) for Flashcards
- GET `/study/sets/:id/srs/due?limit=20` -> `{ items: FlashcardProgress[] }`
	- Each `FlashcardProgress` has fields: `cardIndex`, `dueAt`, `easiness`, `intervalDays`, `repetitions`, etc.
	- If no progress exists yet, the first N cards are seeded as due.
- POST `/study/sets/:id/srs/review` { cardIndex, quality } -> `{ ok: true, progress }`
	- `quality` is 0–5 (SM-2). The server updates easiness, interval, and next `dueAt`.

## Frontend Routing for Study Tools

**Study Dashboard**: `/study`
- Lists all study sets by type (flashcards, guides, tests, match games)
- Provides direct access to main interfaces

**Study Sets**: `/study/sets/:id`
- Main study set page (for guides, tests, and mixed content)

**Flashcard Sets**: `/study/sets/:id/flashcards`
- **Main flashcard viewer interface** (browse all cards with reveal functionality)
- Includes "Study Mode" button for interactive study session
- Shows bidirectional links to source study guides when applicable

**Flashcard Study Mode**: `/study/sets/:id/study`
- Interactive study game with lives, scoring, and AI feedback
- Supports spaced repetition system (SRS)
- Different AI feedback based on performance (win vs. lose scenarios)

**Test Mode**: `/study/sets/:id/test`
- Multiple choice and written answer tests

**Match Games**: `/study/sets/:id/match`
- Card matching games for memorization
