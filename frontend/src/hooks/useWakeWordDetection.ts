import { useCallback, useEffect, useRef, useState } from 'react'
import { playChime, primeAudio, playDataUrlWithVolume, playPresetChime } from '../lib/audio'

interface UseWakeWordDetectionProps {
  onWakeWord?: () => void
  enabled?: boolean
  wakeWords?: string[]
}

// Add types for Speech Recognition API
declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

// Simple wake word detection using Web Speech API
// This is a fallback implementation until we can properly configure Porcupine

// Browser compatibility check
function checkBrowserCompatibility() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const userAgent = navigator.userAgent.toLowerCase()
  
  const isChrome = userAgent.includes('chrome') && !userAgent.includes('edg')
  const isEdge = userAgent.includes('edg')
  const isSafari = userAgent.includes('safari') && !userAgent.includes('chrome')
  const isFirefox = userAgent.includes('firefox')
  
  console.log('[Wake Word Debug] Browser detection:', {
    isChrome, isEdge, isSafari, isFirefox,
    hasSpeechRecognition: !!SpeechRecognition,
    userAgent
  })
  
  return {
    supported: !!SpeechRecognition,
    browser: isChrome ? 'Chrome' : isEdge ? 'Edge' : isSafari ? 'Safari' : isFirefox ? 'Firefox' : 'Unknown',
    recommended: isChrome || isEdge
  }
}

export function useWakeWordDetection({
  onWakeWord,
  enabled = false,
  wakeWords = ['jarvis', 'hey jarvis']
}: UseWakeWordDetectionProps = {}) {
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  
  const recognitionRef = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Retry logic for initialization
  const retryTimeoutRef = useRef<number | null>(null)
  const [retryCount, setRetryCount] = useState(0);

  const initialize = useCallback(async (retry = 0) => {
    console.log('[Wake Word Debug] Initializing wake word detection... (retry:', retry, ")");
    console.log('[Wake Word Debug] Current state - enabled:', enabled, 'isInitialized:', isInitialized);
    
    try {
      setError(null);
      setIsInitialized(false);
      console.log('[Wake Word Debug] Reset state, starting checks...');
      
      // Check browser compatibility first
      const compatibility = checkBrowserCompatibility();
      console.log('[Wake Word Debug] Browser compatibility:', compatibility);
      if (!compatibility.supported) {
        const errorMsg = `Speech Recognition not supported in ${compatibility.browser}. Please use Chrome or Edge for best results.`;
        console.error('[Wake Word Debug]', errorMsg);
        setError(errorMsg);
        return;
      }
      if (!compatibility.recommended) {
        console.warn('[Wake Word Debug] ⚠️  This browser has limited Speech Recognition support. Chrome or Edge recommended.');
      }
      // Check if Speech Recognition is available
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        const errorMsg = 'Speech Recognition not supported in this browser';
        console.error('[Wake Word Debug]', errorMsg);
        setError(errorMsg);
        return;
      }
      console.log('[Wake Word Debug] Speech Recognition API available');
      // Request microphone permission
      console.log('[Wake Word Debug] Requesting microphone permission...');
      // Check available audio devices
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        console.log('[Wake Word Debug] Available audio input devices:', audioInputs.length);
        audioInputs.forEach((device, i) => {
          console.log(`[Wake Word Debug]   ${i + 1}. ${device.label || 'Unknown Device'} (${device.deviceId})`);
        });
      } catch (err) {
        console.warn('[Wake Word Debug] Could not enumerate devices:', err);
      }
      // Check current permission status first
      if (navigator.permissions) {
        try {
          const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          console.log('[Wake Word Debug] Current microphone permission:', permission.state);
          if (permission.state === 'denied') {
            const errorMsg = 'Microphone permission denied. Please allow microphone access and refresh the page.';
            console.error('[Wake Word Debug]', errorMsg);
            setError(errorMsg);
            return;
          }
        } catch (err) {
          console.log('[Wake Word Debug] Could not check permission status:', err);
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;
      console.log('[Wake Word Debug] Microphone permission granted and stream acquired');
      console.log('[Wake Word Debug] Stream details:', {
        active: stream.active,
        tracks: stream.getAudioTracks().length,
        trackStates: stream.getAudioTracks().map(t => ({ label: t.label, enabled: t.enabled, readyState: t.readyState }))
      });
      // Initialize Speech Recognition
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      console.log('[Wake Word Debug] Speech Recognition configured:', {
        continuous: recognition.continuous,
        interimResults: recognition.interimResults,
        lang: recognition.lang
      });
      
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript.toLowerCase())
          .join('')

        // Enhanced debugging
        console.log('[Wake Word Debug] Raw transcript:', transcript)
        console.log('[Wake Word Debug] Looking for words:', wakeWords)
        
        // Merge provided wakeWords with user-configured wake word
        const userWake = (localStorage.getItem('ux_wake_word') || '').trim().toLowerCase()
        let userWakeList: string[] = []
        try {
          const arr = JSON.parse(localStorage.getItem('ux_wake_words') || '[]')
          if (Array.isArray(arr)) userWakeList = arr.filter(x => typeof x === 'string').map(x => x.trim().toLowerCase())
        } catch {}
        const mergedWakeWords = Array.from(new Set([
          ...wakeWords.map(w => w.toLowerCase().trim()),
          ...userWakeList,
          ...(userWake ? [userWake] : [])
        ]))

        // Check for wake words with more flexible matching
        const foundWakeWord = mergedWakeWords.some(word => {
          const cleanWord = word.toLowerCase().trim()
          const cleanTranscript = transcript.trim()
          
          // Direct match
          const directMatch = cleanTranscript.includes(cleanWord)
          
          // Word boundary match (more precise)
          const wordBoundaryMatch = new RegExp(`\\b${cleanWord}\\b`, 'i').test(cleanTranscript)
          
          // Partial match for "jarvis" in longer phrases
          const partialMatch = cleanWord === 'jarvis' && cleanTranscript.includes('jarvis')
          
          const found = directMatch || wordBoundaryMatch || partialMatch
          console.log(`[Wake Word Debug] Checking "${cleanWord}":`, {
            directMatch,
            wordBoundaryMatch, 
            partialMatch,
            found,
            transcript: cleanTranscript
          })
          return found
        })

        if (foundWakeWord) {
          console.log('[Wake Word Debug] ✅ WAKE WORD DETECTED:', transcript)
          // Optional chime
          try {
            const chimeOn = JSON.parse(localStorage.getItem('ux_wake_chime_enabled') || 'true')
            if (chimeOn) {
              const volRaw = Number(localStorage.getItem('ux_wake_chime_volume') || '0.2')
              const vol = Number.isFinite(volRaw) ? Math.max(0, Math.min(1, volRaw)) : 0.2
              const dataUrl = localStorage.getItem('ux_wake_chime_data_url')
              const preset = localStorage.getItem('ux_wake_chime_preset') || 'ding'
              void primeAudio()
              if (dataUrl) {
                void playDataUrlWithVolume(dataUrl, vol)
              } else if (preset) {
                void playPresetChime(preset as any, vol)
              } else {
                void playChime({ volume: vol })
              }
            }
          } catch {}
          onWakeWord?.()
        } else {
          console.log('[Wake Word Debug] ❌ No wake word found in:', transcript)
        }
      }

      recognition.onerror = (event: any) => {
        console.error('[Wake Word Debug] ❌ Speech recognition error:', event.error, event)
        if (event.error === 'not-allowed') {
          setError('Microphone permission denied')
          setIsListening(false)
        } else if (event.error === 'no-speech') {
          console.log('[Wake Word Debug] ⚠️  No speech detected, this is normal')
          // Don't set error for no-speech, it's expected
        } else if (event.error === 'audio-capture') {
          setError('Microphone not available')
          setIsListening(false)
        } else if (event.error === 'network') {
          console.log('[Wake Word Debug] ⚠️  Network error, will retry')
          // Network errors are temporary, don't stop
        } else if (event.error === 'aborted') {
          console.log('[Wake Word Debug] ⚠️  Recognition aborted - this usually means multiple starts, will retry after delay')
          setIsListening(false)
          // Don't set this as an error, just retry after a delay
        } else {
          console.warn('[Wake Word Debug] ⚠️  Recognition error:', event.error)
          setError(`Speech recognition error: ${event.error}`)
        }
      }

      recognition.onstart = () => {
        console.log('[Wake Word Debug] ✅ Speech recognition started successfully')
        setIsListening(true)
      }

      recognition.onend = () => {
        console.log('[Wake Word Debug] ⏹️ Speech recognition ended')
        setIsListening(false)
        // Restart recognition if still enabled, but with a delay to prevent rapid cycling
        if (enabled && recognitionRef.current) {
          console.log('[Wake Word Debug] 🔄 Will restart recognition after 500ms delay...')
          setTimeout(() => {
            try {
              if (recognitionRef.current && enabled && !isListening) {
                console.log('[Wake Word Debug] Attempting restart...')
                recognitionRef.current.start()
              } else {
                console.log('[Wake Word Debug] Skipping restart - conditions changed')
              }
            } catch (err) {
              console.error('[Wake Word Debug] ❌ Failed to restart recognition:', err)
              // If it fails to restart, try reinitializing after a longer delay
              setTimeout(() => {
                if (enabled) {
                  console.log('[Wake Word Debug] 🔄 Reinitializing after restart failure...')
                  initialize()
                }
              }, 2000)
            }
          }, 500) // Longer delay to prevent rapid cycling
        }
      }

      recognitionRef.current = recognition;
      console.log('[Wake Word Debug] 🎯 Recognition object created and configured')
      
      setIsInitialized(true);
      setError(null);
      setRetryCount(0);
      console.log('[Wake Word Debug] ✅ Wake word detection initialized successfully - ready to start listening');
    } catch (err) {
      console.error('[Wake Word Debug] ❌ Failed to initialize wake word detection:', err);
      setError(`Failed to initialize: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsInitialized(false);
      // Retry with exponential backoff up to 5 times
      if (retry < 5) {
        const delay = Math.pow(2, retry) * 1000;
        setRetryCount(retry + 1);
  if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
  retryTimeoutRef.current = setTimeout(() => initialize(retry + 1), delay) as unknown as number;
        console.log(`[Wake Word Debug] Retrying initialization in ${delay / 1000}s (attempt ${retry + 1})`);
      }
    }
  }, [onWakeWord, wakeWords]) // Removed enabled from dependencies to avoid circular calls

  const startListening = useCallback(async () => {
    console.log('[Wake Word Debug] startListening called:', { hasRecognition: !!recognitionRef.current, isListening, enabled })
    
    if (!recognitionRef.current) {
      console.log('[Wake Word Debug] No recognition object available')
      return
    }
    
    if (isListening) {
      console.log('[Wake Word Debug] Already listening, skipping start')
      return
    }
    
    if (!enabled) {
      console.log('[Wake Word Debug] Not enabled, skipping start')
      return
    }

    try {
      console.log('[Wake Word Debug] Starting speech recognition...')
      recognitionRef.current.start()
      // Note: setIsListening(true) will be called by onstart event
      setError(null)
      console.log('[Wake Word Debug] ✅ Speech recognition start() called successfully')
    } catch (err) {
      console.error('[Wake Word Debug] ❌ Failed to start listening:', err)
      // If already started, just mark as listening
      if ((err as Error).message.includes('already started')) {
        console.log('[Wake Word Debug] Recognition already started, marking as listening')
        setIsListening(true)
      } else {
        setError(`Failed to start: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
  }, [isListening, enabled])

  const stopListening = useCallback(() => {
    console.log('[Wake Word Debug] stopListening called:', { hasRecognition: !!recognitionRef.current, isListening })
    if (!recognitionRef.current) return

    try {
      recognitionRef.current.stop()
      setIsListening(false)
    } catch (err) {
      console.error('[Wake Word Debug] ❌ Failed to stop listening:', err)
    }
  }, [isListening])

  // Ensure initialized and actively listening now
  const ensureStarted = useCallback(async () => {
    try {
      console.log('[Wake Word Debug] ensureStarted called. enabled:', enabled, 'initialized:', isInitialized, 'listening:', isListening)
      if (!isInitialized) {
        console.log('[Wake Word Debug] ensureStarted -> initializing...')
        await initialize(0)
      }
      // Start after a microtask to allow onstart/onend handlers to bind
      setTimeout(() => {
        startListening()
      }, 0)
    } catch (e) {
      console.error('[Wake Word Debug] ensureStarted failed:', e)
    }
  }, [enabled, isInitialized, isListening])
  const cleanup = useCallback(() => {
    console.log('[Wake Word Debug] Cleaning up wake word detection...')
    
    // Clear any retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
    
    try {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      setIsListening(false)
      setIsInitialized(false)
      setRetryCount(0)
    } catch (err) {
      console.error('[Wake Word Debug] ❌ Failed to cleanup:', err)
    }
  }, [])

  // Health check and auto-recovery
  useEffect(() => {
    if (!enabled || !isInitialized) return
    
    const healthCheck = setInterval(() => {
      if (enabled && isInitialized && !isListening) {
        console.log('[Wake Word Debug] 🏥 Health check: Recognition not listening, attempting restart...')
        startListening()
      }
    }, 5000) // Check every 5 seconds
    
    return () => clearInterval(healthCheck)
  }, [enabled, isInitialized, isListening, startListening])

  // Initialize when enabled changes; cleanup when disabled or unmount
  useEffect(() => {
    console.log('[Wake Word Debug] Initialize effect triggered - enabled:', enabled)
    if (enabled) {
      console.log('[Wake Word Debug] Enabled -> calling initialize...')
      initialize()
    } else {
      console.log('[Wake Word Debug] Disabled -> cleaning up...')
      cleanup()
    }
    return () => {
      if (enabled) {
        console.log('[Wake Word Debug] Effect cleanup (enabled was true) -> cleaning up...')
        cleanup()
      }
    }
  }, [enabled]) // only track enabled to avoid cleanups on internal state changes

  // Start/stop listening based on enabled state
  useEffect(() => {
    console.log('[Wake Word Debug] Listen effect - enabled:', enabled, 'initialized:', isInitialized, 'listening:', isListening);
    if (enabled && isInitialized && !isListening) {
      console.log('[Wake Word Debug] Should be listening - starting...');
      startListening();
    } else if (!enabled && isListening) {
      console.log('[Wake Word Debug] Should stop listening - stopping...');
      stopListening();
    }
  }, [enabled, isInitialized, isListening]) // Removed function dependencies

  return {
    isListening,
    error,
    isInitialized,
    retryCount,
    startListening,
    stopListening,
    cleanup,
    ensureStarted
  }
}
