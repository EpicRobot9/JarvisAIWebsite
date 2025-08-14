# Environment Reference

Root `.env` variables (used by docker-compose):

- DATABASE_URL=postgresql://postgres:postgres@db:5432/jarvis
- SESSION_SECRET=change-me-in-prod
- BACKEND_PORT=8080
- FRONTEND_ORIGIN=http://localhost:5173
- OPENAI_API_KEY=
- ELEVENLABS_API_KEY=
- ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
- REQUIRE_ADMIN_APPROVAL=false
- LOCK_NEW_ACCOUNTS=false
- ADMIN_EMAILS=
- SEED_DB=true
- VITE_WEBHOOK_URL=... (frontend prod webhook)
- VITE_WEBHOOK_TEST_URL=... (frontend test webhook)
- VITE_CALLBACK_URL=/api/jarvis/callback (frontend)
- VITE_SOURCE_NAME=jarvis-portal (frontend)

Backend-only:
- TRANSCRIBE_MODEL=whisper-1 (or gpt-4o-mini-transcribe)

Notes:
- For production, set strong SESSION_SECRET and use HTTPS terminated at a proxy.
- Disable SEED_DB after initial bootstrap.
- Users may override OpenAI/ElevenLabs keys client-side. The frontend will attach headers `x-openai-key` and `x-elevenlabs-key` to STT/TTS requests if present.
