# Environment Reference

Root `.env` variables (used by docker-compose):

- DATABASE_URL=postgresql://postgres:postgres@db:5432/jarvis
- SESSION_SECRET=change-me-in-prod
- BACKEND_PORT=8080
- FRONTEND_ORIGIN=http://localhost:5173
- OPENAI_API_KEY=
- ELEVENLABS_API_KEY=
- ELEVENLABS_VOICE_ID=7dxS4V4NqL8xqL4PSiMp
- REQUIRE_ADMIN_APPROVAL=false
- LOCK_NEW_ACCOUNTS=false
- ADMIN_EMAILS=
- ADMIN_USERNAMES=admin  # preferred for seeding admin(s); defaults to 'admin' in docker-compose
- SEED_DB=true
 - ADMIN_SEED_MODE=ensure  # ensure: keep existing password; reset: overwrite to ADMIN_DEFAULT_PASSWORD
- VITE_WEBHOOK_URL=... (frontend prod webhook)
- VITE_WEBHOOK_TEST_URL=... (frontend test webhook)
- VITE_CALLBACK_URL=/api/jarvis/callback (frontend)
- VITE_SOURCE_NAME=jarvis-portal (frontend)
- INTEGRATION_PUSH_TOKEN=token1,token2  # tokens allowed for /api/integration/push-to-user
 - CLOUDFLARE_TUNNEL_TOKEN=...  # only if using Cloudflare Tunnel for techexplore.us

Backend-only:
- TRANSCRIBE_MODEL=whisper-1 (or gpt-4o-mini-transcribe)
- COOKIE_SECURE=false  # set true to force Secure cookies; otherwise auto-true in production when FRONTEND_ORIGIN is https

Notes:
- For production, set strong SESSION_SECRET and use HTTPS terminated at a proxy.
- Disable SEED_DB after initial bootstrap.
- Users may override OpenAI/ElevenLabs keys client-side. The frontend will attach headers `x-openai-key` and `x-elevenlabs-key` to STT/TTS requests if present. When a custom ElevenLabs key is provided, the frontend will also send `x-elevenlabs-voice-id` if set in Settings; otherwise, the backend uses the default project voice.
- To enable token-secured integration pushes (no admin session), set `INTEGRATION_PUSH_TOKEN` to a strong secret (or multiple, comma-separated). n8n or other systems call `/api/integration/push-to-user` with `Authorization: Bearer <token>`.
 - If you deploy via Cloudflare Tunnel, set `FRONTEND_ORIGIN=https://techexplore.us` and add `CLOUDFLARE_TUNNEL_TOKEN`.
