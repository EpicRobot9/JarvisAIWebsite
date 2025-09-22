# Voice Presets and TTS Fallback System

## Overview

The Jarvis AI Website now features a comprehensive voice system with user-selectable voice presets and a robust 3-tier fallback system ensuring speech synthesis always works.

## 🎭 Voice Presets

### Available ElevenLabs Voice Presets

Users can now select from a curated list of high-quality ElevenLabs voices in the Settings panel:

**Female Voices:**
- **Rachel** (21m00Tcm4TlvDq8ikWAM) - Young, pleasant female voice
- **Domi** (AZnzlk1XvdvUeBnXmlld) - Energetic, friendly female voice  
- **Bella** (EXAVITQu4vr4xnSDxMaL) - Sweet, soft-spoken female voice

**Male Voices:**
- **Antoni** (ErXwobaYiN019PkySvjV) - Well-rounded, versatile male voice
- **Arnold** (VR6AewLTigWG4xSOukaG) - Crisp, confident male voice
- **Adam** (pNInz6obpgDQGcFmaJgB) - Deep, authoritative male voice
- **Sam** (yoZ06aMxZJJ28mfd3POQ) - Raspy, casual male voice
- **Dave** (CYw3kZ02Hs0563khs1Fj) - British, professional male voice
- **Drew** (29vD33N1CtxCmqQRPOHJ) - Calm, soothing male voice
- **George** (JBFqnCBsd6RMkjVDRZzb) - Warm, articulate British male voice
- **Callum** (N2lVS1w4EtoT3dr4eOWO) - Intense, dramatic male voice
- **Charlie** (IKne3meq5aSn9XLyUdCD) - Casual, laid-back male voice
- **Daniel** (onwK4e9ZLuTAKqWW03F9) - British, authoritative male voice

**Custom Option:**
- **Custom Voice ID** - Enter any ElevenLabs voice ID you have access to

### How to Use Voice Presets

1. **Open Settings** - Click the "Settings" button in the app
2. **Add Your ElevenLabs API Key** - Voice presets require your own API key
3. **Select Voice Preset** - Choose from the dropdown menu of voices
4. **Save Settings** - Your voice preference is saved locally
5. **Test It** - Send a message or use call mode to hear your selected voice

### Custom Voice IDs

For advanced users, you can:
- Select "Custom Voice ID" from the preset dropdown
- Enter any ElevenLabs voice ID you have access to
- This includes voices you've cloned or premium voices from your account

## 🔄 Three-Tier TTS Fallback System

The system ensures you always hear audio through a cascading fallback chain:

### Tier 1: ElevenLabs TTS (Primary)
- **Quality**: Excellent, natural-sounding voices
- **Latency**: 200-500ms
- **Requirements**: ElevenLabs API key (user or system)
- **Features**: Voice presets, custom voices, multilingual support

### Tier 2: eSpeak-NG (Server Fallback)
- **Quality**: Basic but clear robotic voice
- **Latency**: 50-100ms (very fast)
- **Requirements**: None (built into backend)
- **Features**: Always available, offline capable, multiple languages

### Tier 3: Web Speech API (Browser Fallback)
- **Quality**: Good to excellent (varies by OS/browser)
- **Latency**: Instant
- **Requirements**: Modern browser
- **Features**: OS-native voices, customizable voice selection

## 🔧 Configuration

### User Settings

**ElevenLabs Voice Presets:**
- Requires user's own ElevenLabs API key
- Voice selection saved in browser localStorage
- Automatic fallback if API key is invalid/expired

**Web Speech Voice Selection:**
- Choose from available system voices
- Automatic English voice preference
- Fallback to any available voice if preferred unavailable

### Environment Variables

```bash
# Server defaults (fallback when user has no API key)
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=7dxS4V4NqL8xqL4PSiMp  # Default project voice

# No additional config needed for eSpeak-NG or Web Speech API
```

### Backend Dependencies

The backend container includes:
- **eSpeak-NG** - Text-to-speech synthesizer
- **LAME** - MP3 encoder for audio format conversion

## 🎛️ Technical Implementation

### Frontend (`SettingsPanel.tsx`)
- Voice preset dropdown with descriptions
- Custom voice ID input field
- Web Speech voice selection
- Local storage persistence
- Validation and user guidance

### Backend (`server.ts`)
- `/api/tts` - ElevenLabs with voice ID support
- `/api/tts/fallback` - eSpeak-NG + LAME encoding
- Header-based voice ID override: `x-elevenlabs-voice-id`
- Proper error handling and fallback triggers

### Audio Library (`audio.ts`)
- Enhanced Web Speech API with voice selection
- Automatic English voice preference
- Voice preference persistence
- Quality settings optimization

## 🧪 Testing

### Manual Testing
1. **Open the app** at http://localhost:5173
2. **Go to Settings** and configure your voice preferences
3. **Test in chat mode** - Send a message to hear TTS
4. **Test in call mode** - Use press-to-talk for real-time TTS

### Automated Testing
Use the test page: `test-tts-complete.html`
- Tests all three TTS tiers individually
- Tests voice presets with different voices
- Tests complete fallback chain
- Browser compatibility checks

### API Testing
```bash
# Test ElevenLabs with voice preset
curl -X POST http://localhost:5173/api/tts \
  -H "Content-Type: application/json" \
  -H "x-elevenlabs-voice-id: 21m00Tcm4TlvDq8ikWAM" \
  -d '{"text": "Hello from Rachel"}' \
  --output test-voice.mp3

# Test eSpeak fallback
curl -X POST http://localhost:5173/api/tts/fallback \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from eSpeak"}' \
  --output test-fallback.mp3
```

## 🎯 User Experience

### Seamless Operation
- **No configuration required** - Works out of the box with fallbacks
- **Graceful degradation** - Always produces audio, quality varies
- **Instant feedback** - Users hear something immediately
- **Preference persistence** - Settings saved across sessions

### Performance Characteristics

| Method | Response Time | Quality | Reliability | Cost |
|--------|---------------|---------|-------------|------|
| ElevenLabs | 200-500ms | Excellent | High* | Paid |
| eSpeak-NG | 50-100ms | Basic | 100% | Free |
| Web Speech | 0ms | Good-Excellent | High** | Free |

*Depends on API key validity and service availability
**Depends on browser support

## 🚀 Benefits

1. **100% Audio Availability** - Users always hear responses
2. **Quality Options** - Premium voices when available, basic when needed  
3. **Performance** - Fast fallbacks ensure minimal delay
4. **Cost Effective** - Free fallbacks reduce API usage
5. **User Choice** - Voice personality selection enhances experience
6. **Accessibility** - Multiple audio options support diverse needs
7. **Offline Capable** - eSpeak works without internet (in local deployment)

## 🔮 Future Enhancements

### Additional TTS Engines
- Google Cloud Text-to-Speech
- AWS Polly
- Azure Cognitive Services
- Festival TTS
- Pico TTS

### Advanced Features
- Voice emotion/style selection
- Speed/pitch/volume controls
- SSML markup support
- Voice cloning integration
- Real-time voice switching

### Analytics
- Fallback usage statistics
- Voice preference analytics
- Performance monitoring
- Error rate tracking

---

**The voice preset and fallback system ensures that Jarvis always has a voice, from premium AI-generated speech to reliable robotic alternatives, giving users both choice and certainty in their AI interactions.**
