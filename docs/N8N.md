# n8n Integration Guide

This app posts user messages directly to your n8n Webhook (Prod/Test). Your workflow can:

1) Reply immediately (sync response body), and/or
2) Post back later using the callback endpoint, and optionally
3) Push live messages or voice via the Control API.

The frontend webhook payload includes:

```json
{
  "chatInput": "hello",
  "userid": "user-123",          // same as userId
  "correlationId": "<uuid>",     // use this when calling the callback endpoint
  "callbackUrl": "/api/jarvis/callback",
  "source": "jarvis-portal",
  "sessionId": "<web-session-id>", // use this to push events to the active UI
  "messageType": "TextMessage"      // "TextMessage" from chat UI, "CallMessage" for voice/call flows
}
```

## A) Immediate reply (optional)
Your Webhook node can respond with a string or JSON; the UI will render it. Example JSON body:

```json
{ "result": "Hi there!" }
```

## B) Callback later
When your flow finishes, post the result to the app’s callback endpoint:

Endpoint
- POST `${callbackUrl}` (default `/api/jarvis/callback`)

Body shapes supported
- `{ correlationId, result: "text" }`
- `{ correlationId, output: "text" }`
- `{ correlationId, data: [...] }` or `[{ output: "text" }, ...]`

HTTP Request (n8n HTTP Request node)
- Method: POST
- URL: `http://backend:8080/api/jarvis/callback` (inside docker) or `https://your.app/api/jarvis/callback` externally
- Headers: `Content-Type: application/json`
- JSON/Body:
  ```json
  { "correlationId": "{{$json.correlationId}}", "result": "Your final message." }
  ```

Equivalent curl
```bash
curl -X POST http://localhost:8080/api/jarvis/callback \
  -H 'Content-Type: application/json' \
  -d '{"correlationId":"<uuid>","result":"Your final message."}'
```

## C) Push live messages to the UI
Use the Control API with the `sessionId` to stream content while the flow runs.

1) Push a text message (assistant/system)
- Endpoint: POST `/api/push`
- Body:
  ```json
  { "sessionId": "<session>", "text": "Thinking...", "role": "assistant", "say": false }
  ```

2) Push a voice message (client will TTS and play)
- Endpoint: POST `/api/push-voice`
- Body:
  ```json
  { "sessionId": "<session>", "text": "Here is the spoken update." }
  ```

3) End the call (optional)
- Endpoint: POST `/api/call/end`
- Body:
  ```json
  { "sessionId": "<session>", "reason": "Completed" }
  ```

n8n HTTP Request node examples (inside docker-compose)
- URL base: `http://backend:8080`
- Headers: `Content-Type: application/json`

Push text (assistant)
```json
{
  "url": "http://backend:8080/api/push",
  "method": "POST",
  "json": true,
  "body": {
    "sessionId": "{{$json.sessionId}}",
    "text": "Working on it...",
    "role": "assistant",
    "say": false
  }
}
```

Push voice
```json
{
  "url": "http://backend:8080/api/push-voice",
  "method": "POST",
  "json": true,
  "body": {
    "sessionId": "{{$json.sessionId}}",
    "text": "Your appointment is confirmed."
  }
}
```

End call
```json
{
  "url": "http://backend:8080/api/call/end",
  "method": "POST",
  "json": true,
  "body": {
    "sessionId": "{{$json.sessionId}}",
    "reason": "Completed"
  }
}
```

Notes
- sessionId is included in the initial webhook payload from the UI; store it in your workflow context and reuse it for pushes.
- If your n8n instance sits outside docker, call the externally reachable base URL for the backend (e.g. `https://your.app/api/...`).
- The UI supports immediate replies plus later callbacks; providing both will show the immediate text then replace/append with the callback result when it arrives.
 - Voice push behavior: when the UI receives a voice push during a call, it performs a low‑latency streaming TTS request and plays it in sequence. If streaming fails, it falls back to non‑streaming TTS automatically.
 - Expect two TTS streams during an active call when you also stream your webhook reply: one for your reply, one for any `push-voice` you emit.

## D) Push by user (no sessionId required; token-secured)
If your workflow doesn’t keep a sessionId, you can target a user by `userId` or `email` using a shared token configured in the app.

1) Configure the backend
- Set `INTEGRATION_PUSH_TOKEN` in environment (comma-separated for multiple). Example:
  - `INTEGRATION_PUSH_TOKEN=prod-xyz-123,staging-abc-789`

2) Use this HTTP Request node in n8n
- Method: `POST`
- URL: `http://backend:8080/api/integration/push-to-user` (inside compose) or `https://your.app/api/integration/push-to-user`
- Headers:
  - `Authorization: Bearer prod-xyz-123`
  - `Content-Type: application/json`
 - Authentication: None (do not attach n8n credentials; set the headers above directly)
- JSON Body (choose one targeting field):
  - By userId:
    ```json
    { "userId": "{{$json.userid}}", "text": "Working on it...", "say": false }
    ```
  - By email:
    ```json
    { "email": "{{$json.userEmail}}", "text": "Your report is ready.", "voice": true }
    ```

Example node configuration (JSON view)
```json
{
  "url": "http://backend:8080/api/integration/push-to-user",
  "method": "POST",
  "json": true,
  "headers": {
    "Authorization": "Bearer prod-xyz-123",
    "Content-Type": "application/json"
  },
  "body": {
    "userId": "{{$json.userid}}",
    "text": "Working on it...",
    "say": false
  }
}
```

Notes
- `voice: true` tells the UI to speak the message.
- For text pushes, `say: true` will also speak the message.
- Optional `role: "system"` will render as a system message; default is `assistant`.
 - Targeting: provide either `userId` or `email`. The app routes pushes to all active sessions for that user; the UI subscribes with its userId to ensure delivery.
 - During calls, voice pushes are streamed and played immediately, regardless of the UI’s chat mute toggle; after the call ends, the previous mute state is restored.

### Troubleshooting
- 401 invalid_token from `/api/integration/push-to-user`: ensure your `Authorization: Bearer <token>` matches `INTEGRATION_PUSH_TOKEN` (comma‑separated tokens allowed). Alternatively pass `x-api-token: <token>` or `?token=<token>`.
- Push appears in chat but no audio: confirm the user is in Call mode. In Network, you should see `/api/tts/stream` for the voice push; if it fails, a subsequent `/api/tts` fallback should appear.
- No push reaches the UI: make sure you target by the correct `userId`/`email` and that the user is signed in so the event channel is bound to their ID.
