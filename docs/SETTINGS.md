# Settings Panel

The Settings modal groups options into collapsible sections to keep things tidy as features grow. Open it from the main portal sidebar (Settings button).

## Behavior

- Each section is collapsible and remembers its open/closed state per-device using localStorage keys of the form `settings_section_open:<id>`.
- All sections default to collapsed to make the structure obvious at first open.
- Changes are stored in localStorage. Most options take effect immediately; a few are picked up on the next interaction.

## Sections

1. API Keys (optional)
   - OpenAI API Key
   - ElevenLabs API Key
   - Voice Preset or Custom Voice ID (used only when a user ElevenLabs key is provided)

2. TTS Fallback Voice
   - Web Speech Voice (auto or a specific OS voice)
   - Web Speech Speed slider (0.50× – 1.50×; default 0.85×)

3. Profile
   - Friendly name (optional)

4. UI
   - Typewriter effect toggle
   - Typing speed (chars/sec)

5. Performance
   - Performance mode (lighter visuals)

6. Always‑Listening / VAD
   - Verbose VAD logs (console + on‑screen overlay)
   - Engine: JS or WASM (MicVAD)
   - Tuning sliders: Enter/Exit SNR dB, Relative Drop dB, Silence Hangover ms, Absolute Silence dB, Check Interval ms

7. Wake Word & Chime
   - Wake words/phrases (up to 8)
   - Play chime on wake (toggle)
   - Chime volume
   - Custom chime file (small audio data URL)
   - Preset chime (Ding, Ding‑dong, Soft pop)
   - Test chime
   - Import/Export wake/chime JSON

8. Conversation
   - Continuous conversation (toggle)
   - Play chime before follow‑up
   - No‑speech timeout after follow‑up starts (1–15s)
   - No‑speech timeout after wake (1–15s)
   - Follow‑up “Speak now” nudge duration (0.3–5.0s)

9. Audio Devices
   - Microphone input selector (per‑browser)
   - Speaker/output selector (when supported by the browser via setSinkId)
   - Mic test meter and 2s sample record/playback
   - Output test tone

10. Push‑to‑Talk
   - Enable/disable Spacebar push‑to‑talk (global)
   - Mode: Hold (press and hold to talk) or Toggle (tap to start/stop)
   - Play chime on start/stop (uses Wake Chime preset/volume)

## Persistence keys (reference)

- User keys/voice: `user_openai_api_key`, `user_elevenlabs_api_key`, `user_elevenlabs_voice_id`
- Web Speech: `user_web_speech_voice`, `ux_web_speech_rate`
- Typewriter: `ux_typewriter_enabled`, `ux_typewriter_speed_cps`
- Performance: `ux_perf_mode`
- VAD debug: `jarvis_debug_vad`
   - Engine override (optional): `vad_engine` = `js` | `wasm`
   - JS tuning: `vad_calibration_ms`, `vad_enter_snr_db`, `vad_exit_snr_db`, `vad_relative_drop_db`, `vad_min_speech_ms`, `vad_silence_hangover_ms`, `vad_abs_silence_db`, `vad_check_interval_ms`
   - WASM tuning: `vad_wasm_guard_ms`, `vad_wasm_min_speech_ms`
- Wake & chime: `ux_wake_words`, `ux_wake_word` (legacy), `ux_wake_chime_enabled`, `ux_wake_chime_volume`, `ux_wake_chime_data_url`, `ux_wake_chime_preset`
- Conversation: `ux_continuous_conversation`, `ux_followup_chime_enabled`, `ux_followup_no_speech_sec`, `ux_initial_no_speech_sec`, `ux_followup_nudge_duration_ms`
- Audio devices: `ux_audio_input_device_id`, `ux_audio_output_device_id`
- Push‑to‑Talk: `ux_space_ptt_enabled`
   - Additional PTT controls: `ux_ptt_mode` = `hold` | `toggle`, `ux_ptt_chime_enabled` = boolean
- Section state: `settings_section_open:<id>`

## Tips

- Changing Web Speech voice/speed affects only the final fallback layer used when ElevenLabs/eSpeak aren’t available.
- The VAD debug toggle also shows a compact on‑screen overlay with live level/SNR/speech state to help tune endpointing.
- Import/Export makes it easy to carry your wake/chime config across devices. After importing, a banner prompts you to Save to persist.

Related docs: WAKE_WORD_ALWAYS_LISTENING.md, TTS_FALLBACK.md, INTERSTELLAR.md.


## Jarvis Notes Settings

Location
- From the Notes page (`/notes`), click Settings in the History header, or go directly to `/notes/settings`.

What it controls
- Instructions: free‑form guidance for the AI note‑taker (tone, structure, fields to emphasize).
- Categories: ask the summarizer to group content by clear headings.
- Collapsible sections: allow the model to wrap sections in `<details><summary>...</summary>...</details>` for scannability.
- Summary icon: tweak the disclosure icon — triangle, chevron, or plus/minus.
- Accent color: change the summary text color accent (slate, blue, emerald, amber, rose).
- Expand all: auto‑expand all sections on render.
- Expand categories: auto‑expand only top‑level sections on render.

Defaults
- Collapsible: true
- Categories: true
- Icon: triangle
- Color: slate
- Expand all: false
- Expand categories: false

Storage
- Preferences are persisted per user in the backend settings store under the key `NOTES_PREFS:<userId>` and fetched by the frontend on the Notes page.
