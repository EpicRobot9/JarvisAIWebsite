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
		- If `voice` is true, the UI will TTS and play.
		- If `say` is true on text push, the UI will TTS and play.
		- `role` defaults to `assistant`.

Voice/Callbacks
- POST `/transcribe` multipart-form: file(webm), correlationId
- POST `/jarvis/callback` { correlationId, result }
- GET `/jarvis/callback/:id` -> stored callback result or null
- POST `/tts` { text } -> audio/mpeg stream (if ELEVENLABS_API_KEY)
	- Uses default voice `ELEVENLABS_VOICE_ID` (defaults to `7dxS4V4NqL8xqL4PSiMp`).
	- If the client supplies `x-elevenlabs-key`, the call will use that key; and if `x-elevenlabs-voice-id` is also provided, it will use that voice id. Without a custom key, the project key and default voice are used.

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
