# Notes background recording

Jarvis Notes now keeps recording when you switch to another tab.

How it works
- Foreground: uses Web Speech API for low-latency interim transcript.
- Background (tab hidden): switches to MediaRecorder that captures 5s audio chunks and sends them to the server STT endpoint (`/api/stt`). Recognized text is appended to your transcript when each chunk completes.
- Foreground again: stops MediaRecorder and resumes Web Speech.

What you’ll see
- A brief "Recording continues in background…" toast when the tab is hidden while recording.
- When you return, a brief "Resumed listening after tab switch" message.

Limitations
- Browser/OS policies: Some environments may throttle or suspend background tabs (especially on battery saver or mobile). Desktop Chrome typically allows background audio capture; iOS Safari may suspend when the screen locks.
- Permissions: Microphone permission must be granted. If permission is revoked or the device sleeps deeply, recording may pause and auto-resume when possible.
- Network: Background STT uploads 5s chunks while hidden.

Tips
- Keep the browser window open; avoid OS-level sleep for uninterrupted capture.
- If you rely heavily on background capture, consider disabling aggressive power-saving settings.

Testing
1) Open Notes, click Play, say a short sentence.
2) Switch to another tab for ~10–15 seconds and continue speaking.
3) Return to the Notes tab. You should see the interim message and the transcript updated with your background speech.
