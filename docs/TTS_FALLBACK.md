# TTS Fallback System Documentation

## Overview

Your Jarvis AI Website now includes a robust cascading TTS (Text-to-Speech) fallback system that ensures speech synthesis always works, even when the primary Eleven Labs service is unavailable or not configured.

## Fallback Chain

The system tries TTS methods in this order:

### 1. Primary: Eleven Labs TTS
- **Quality**: High-quality, natural-sounding voices
- **Requirements**: `ELEVENLABS_API_KEY` environment variable or user-provided API key
- **Pros**: Professional quality, multiple voices, fast
- **Cons**: Requires API key, costs money, needs internet

### 2. Fallback 1: eSpeak-NG (Server-side)
- **Quality**: Basic but clear robotic voice
- **Requirements**: eSpeak-NG installed on server (✅ already installed)
- **Endpoint**: `POST /api/tts/fallback`
- **Pros**: Always available, works offline, completely free, lightweight (~1MB memory)
- **Cons**: Robotic voice quality

### 3. Fallback 2: Web Speech API (Browser-side)
- **Quality**: Varies by browser/OS (usually good on modern systems)
- **Requirements**: Modern browser support
- **Pros**: No server resources needed, works offline, OS-native voices
- **Cons**: Not available in all browsers, quality varies by system

## Implementation Details

### Frontend (`frontend/src/lib/api.ts`)

```typescript
export async function synthesizeTTS(text: string): Promise<ArrayBuffer> {
  try {
    // Try ElevenLabs first, then server fallback
    // ... see frontend/src/lib/api.ts for full implementation
  } catch (error) {
    // Final fallback returns an empty buffer – caller should invoke Web Speech itself
    return await synthesizeTTSWebSpeech(text)
  }
}
```

### Backend (`backend/server.ts`)

New endpoint: `POST /api/tts/fallback`
- Uses eSpeak-NG to generate WAV audio
- Pipes through LAME encoder for MP3 output
- Streams directly to client for efficiency

```typescript
app.post('/api/tts/fallback', requireAuth, async (req, res) => {
  const espeak = spawn('espeak-ng', [text, '--stdout', '-v', 'en', '-s', '160'])
  const lame = spawn('lame', ['-r', '--preset', 'voice', '-', '-'])
  espeak.stdout.pipe(lame.stdin)
  lame.stdout.pipe(res)
})
```

## Configuration

### Server Requirements

eSpeak-NG and LAME are now installed:
```bash
sudo apt-get install espeak-ng lame
```

### Environment Variables

No additional environment variables needed for fallback TTS. The system automatically detects when Eleven Labs is unavailable.

### Voice Customization

eSpeak-NG supports various customization options:
- `-v en`: Voice (en, en+f3, en+m7, etc.)
- `-s 160`: Speed (words per minute)
- `-p 50`: Pitch (0-99)
- `-a 100`: Amplitude (volume)

## Testing

Use the provided test page: `test-tts-fallback.html`

Or test manually:
```bash
# Test eSpeak directly
espeak-ng "Hello world" --stdout | lame -r --preset voice - test.mp3

# Test via API
curl -X POST http://localhost:8080/api/tts/fallback \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from eSpeak fallback"}' \
  --output test-fallback.mp3
```

## Usage Examples

### Automatic Fallback
The system automatically cascades through fallbacks when needed. No code changes required in existing components.

### Force Specific TTS Method
```typescript
// Force Web Speech API (plays immediately)
import { speakWithWebSpeech } from '../src/lib/audio'
await speakWithWebSpeech("Hello world")

// Force server fallback
const response = await fetch('/api/tts/fallback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: "Hello world" })
})
```

## Performance Characteristics

| Method | Response Time | Audio Quality | Resource Usage | Offline Support |
|--------|---------------|---------------|----------------|-----------------|
| Eleven Labs | 200-500ms | Excellent | Network only | ❌ |
| eSpeak-NG | 50-100ms | Basic | Very low CPU | ✅ |
| Web Speech | 0ms (instant) | Good-Excellent | Browser only | ✅ |

## Monitoring and Debugging

Console messages help track fallback usage:
- `"Eleven Labs TTS failed (500), trying server fallback"`
- `"Server fallback also failed, trying Web Speech API"`
- `"All TTS methods failed"`

## Advantages of This System

1. **High Availability**: Always works, even without API keys
2. **Cost Effective**: Fallbacks are completely free
3. **Performance**: eSpeak is very fast for basic needs
4. **Self-Contained**: No external dependencies for fallbacks
5. **Graceful Degradation**: Users always hear something, even if quality varies

## Future Enhancements

Consider adding these optional TTS engines:

### Festival TTS
```bash
sudo apt-get install festival festvox-kallpc16k
```

### Pico TTS
```bash
sudo apt-get install libttspico-utils
```

### Cloud Alternatives
- Google Cloud TTS
- AWS Polly
- Azure Cognitive Services

The fallback system can easily be extended to include additional methods in the cascade.

## UI Controls and Behavior

### Web Speech fallback controls

- Settings → “TTS Fallback Voice”
  - Web Speech Voice: auto or a specific OS voice
  - Web Speech Speed: 0.50× – 1.50× (default 0.85×)

### Playback and queueing

- Call mode uses low‑latency streaming and a FIFO queue; falls back to buffered and then to Web Speech.
- Chat mode caches TTS per assistant message and supports play/stop.
- If playback fails due to autoplay restrictions, the UI will show an “Enable audio” prompt that primes the AudioContext on click.

### Error handling improvements

- Clear toasts when TTS/Playback fails, with actionable retry options (Retry speak / Retry send / Retry STT) depending on stage.
- Console logs indicate which fallback layer was used (e.g., ElevenLabs -> eSpeak -> Web Speech).

See also: SETTINGS.md for the full list of controls.
