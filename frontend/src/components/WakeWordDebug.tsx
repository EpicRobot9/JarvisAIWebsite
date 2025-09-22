import { useState, useEffect, useRef } from 'react'
import { useWakeWordDetection } from '../hooks/useWakeWordDetection'

interface WakeWordDebugProps {
  externalWakeWordDetection?: {
    isListening: boolean;
    error: string;
    isInitialized: boolean;
    retryCount: number;
    cleanup?: () => void;
  };
  enabled?: boolean;
  onForceReinitialize?: () => void;
  vadMetrics?: {
    levelDb: number
    noiseFloorDb: number
    snrDb: number
    speechPeakDb: number
    inSpeech: boolean
    silenceMs: number
    speechMs: number
  } | null
  vadEngine?: 'js' | 'wasm'
  wasmActive?: boolean
}

export default function WakeWordDebug({ externalWakeWordDetection, enabled, onForceReinitialize, vadMetrics, vadEngine, wasmActive }: WakeWordDebugProps = {}) {
  const [isEnabled, setIsEnabled] = useState(false)
  const [detections, setDetections] = useState<string[]>([])
  const [lastTranscript, setLastTranscript] = useState('')
  const [permissionTest, setPermissionTest] = useState<string>('Not tested')
  const levelTrendRef = useRef<number[]>([])
  const snrTrendRef = useRef<number[]>([])

  const testMicPermissions = async () => {
    try {
      setPermissionTest('Testing...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      setPermissionTest('✅ Granted')
      setDetections(prev => [...prev.slice(-9), `✅ Microphone test successful at ${new Date().toLocaleTimeString()}`])
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      setPermissionTest(`❌ ${errorMsg}`)
      setDetections(prev => [...prev.slice(-9), `❌ Microphone test failed: ${errorMsg}`])
    }
  }

  // Use external wake word detection if provided, otherwise use own instance
  const ownWakeWordDetection = useWakeWordDetection({
    enabled: isEnabled,
    onWakeWord: () => {
      const timestamp = new Date().toLocaleTimeString()
      setDetections(prev => [...prev.slice(-9), `✅ WAKE WORD DETECTED at ${timestamp}`])
    },
    wakeWords: ['jarvis', 'hey jarvis', 'okay jarvis']
  })
  
  const wakeWordDetection = externalWakeWordDetection || ownWakeWordDetection
  const isUsingExternal = !!externalWakeWordDetection

  // Override console.log to capture debug messages
  useEffect(() => {
    const originalLog = console.log
    console.log = (...args) => {
      originalLog(...args)
      if (args[0]?.includes?.('[Wake Word Debug]')) {
        const message = args.join(' ')
        if (message.includes('Raw transcript:')) {
          const transcript = message.split('Raw transcript: ')[1]
          setLastTranscript(transcript)
        }
      }
    }
    
    return () => {
      console.log = originalLog
    }
  }, [])

  const clearLogs = () => {
    setDetections([])
    setLastTranscript('')
    levelTrendRef.current = []
    snrTrendRef.current = []
  }

  // Update trends when metrics change
  useEffect(() => {
    if (!vadMetrics) return
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
    // Normalize to [0,1] roughly over [-80, -20] dB window
    const levelNorm = clamp((vadMetrics.levelDb + 80) / 60, 0, 1)
    const snrNorm = clamp((vadMetrics.snrDb) / 20, 0, 1)
    const push = (arr: number[], v: number, max = 48) => { arr.push(v); if (arr.length > max) arr.shift() }
    push(levelTrendRef.current, levelNorm)
    push(snrTrendRef.current, snrNorm)
  }, [vadMetrics?.levelDb, vadMetrics?.snrDb])

  const TrendBar = ({ values, color }: { values: number[]; color: string }) => (
    <div className="h-6 flex items-end gap-[1px]">
      {values.map((v, i) => (
        <div key={i} style={{ height: `${Math.round(v * 100)}%` }} className={`${color} w-[3px] rounded-sm`}></div>
      ))}
    </div>
  )

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg p-4 text-white z-50">
      <h3 className="text-lg font-semibold mb-3">
        🎤 Wake Word Debug {isUsingExternal ? '(Always Listening)' : '(Debug Instance)'}
      </h3>
      
      <div className="space-y-3">
        <div className="flex gap-2">
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            className={`px-3 py-1 rounded text-sm font-medium ${
              isEnabled 
                ? 'bg-green-600 hover:bg-green-700' 
                : 'bg-gray-600 hover:bg-gray-700'
            }`}
          >
            {isEnabled ? '🟢 Stop Debug' : '▶️ Start Debug'}
          </button>
          
          <button
            onClick={() => {
              // Force restart by turning off and on
              setIsEnabled(false)
              setTimeout(() => setIsEnabled(true), 100)
              setDetections(prev => [...prev, `🔄 Force restart at ${new Date().toLocaleTimeString()}`])
            }}
            className="px-3 py-1 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700"
          >
            🔄 Restart
          </button>
          
          <button
            onClick={clearLogs}
            className="px-3 py-1 rounded text-sm font-medium bg-slate-600 hover:bg-slate-700"
          >
            🗑️ Clear
          </button>
          
          <button
            onClick={testMicPermissions}
            className="px-3 py-1 rounded text-sm font-medium bg-purple-600 hover:bg-purple-700"
          >
            🎤 Test Mic
          </button>
          
          <button
            onClick={() => {
              console.log('[Debug Panel] Force initialize clicked')
              if (isUsingExternal && onForceReinitialize) {
                console.log('[Debug Panel] Using external force reinitialize')
                onForceReinitialize()
                setDetections(prev => [...prev.slice(-9), `🔧 External force init at ${new Date().toLocaleTimeString()}`])
              } else if (!isUsingExternal) {
                console.log('[Debug Panel] Using own instance force reinitialize')
                wakeWordDetection.cleanup?.()
                // Force re-initialization by toggling enabled state for own instance
                setIsEnabled(false)
                setTimeout(() => {
                  setIsEnabled(true)
                  setDetections(prev => [...prev.slice(-9), `🔧 Own force init at ${new Date().toLocaleTimeString()}`])
                }, 200)
              } else {
                setDetections(prev => [...prev.slice(-9), `🔧 No force init method available at ${new Date().toLocaleTimeString()}`])
              }
            }}
            className="px-3 py-1 rounded text-sm font-medium bg-orange-600 hover:bg-orange-700"
          >
            🔧 Force Init
          </button>
        </div>

        <div className="text-xs space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <strong>Enabled:</strong>{' '}
              <span className={enabled !== undefined ? (enabled ? 'text-green-400' : 'text-red-400') : (isEnabled ? 'text-green-400' : 'text-red-400')}>
                {enabled !== undefined ? (enabled ? 'Yes' : 'No') : (isEnabled ? 'Yes' : 'No')}
              </span>
            </div>
            <div>
              <strong>VAD Engine:</strong>{' '}
              <span className="text-blue-400">{vadEngine ?? 'js'}</span>
            </div>
            <div>
              <strong>Initialized:</strong>{' '}
              <span className={wakeWordDetection.isInitialized ? 'text-green-400' : 'text-red-400'}>
                {wakeWordDetection.isInitialized ? 'Yes' : 'No'}
              </span>
            </div>
            <div>
              <strong>Listening:</strong>{' '}
              <span className={wakeWordDetection.isListening ? 'text-green-400' : 'text-red-400'}>
                {wakeWordDetection.isListening ? 'Yes' : 'No'}
              </span>
            </div>
            <div>
              <strong>WASM Active:</strong>{' '}
              <span className={wasmActive ? 'text-green-400' : 'text-slate-400'}>
                {wasmActive ? 'Yes' : 'No'}
              </span>
            </div>
            <div>
              <strong>Browser:</strong>{' '}
              <span className="text-blue-400">
                {navigator.userAgent.includes('Chrome') ? 'Chrome' : 
                 navigator.userAgent.includes('Firefox') ? 'Firefox' : 
                 navigator.userAgent.includes('Safari') ? 'Safari' : 'Other'}
              </span>
            </div>
            <div>
              <strong>Mic Test:</strong>{' '}
              <span className={
                permissionTest.includes('✅') ? 'text-green-400' : 
                permissionTest.includes('❌') ? 'text-red-400' : 'text-yellow-400'
              }>
                {permissionTest}
              </span>
            </div>
            <div>
              <strong>Retry Count:</strong>{' '}
              <span className="text-yellow-400">
                {wakeWordDetection.retryCount || 0}
              </span>
            </div>
          </div>

          {vadMetrics && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <strong>VAD Level dB:</strong> {vadMetrics.levelDb.toFixed(1)}
              </div>
              <div>
                <strong>Noise Floor dB:</strong> {vadMetrics.noiseFloorDb.toFixed(1)}
              </div>
              <div>
                <strong>SNR dB:</strong> {vadMetrics.snrDb.toFixed(1)}
              </div>
              <div>
                <strong>Peak dB:</strong> {vadMetrics.speechPeakDb.toFixed(1)}
              </div>
              <div>
                <strong>In Speech:</strong> {vadMetrics.inSpeech ? 'Yes' : 'No'}
              </div>
              <div>
                <strong>Silence ms:</strong> {Math.round(vadMetrics.silenceMs)}
              </div>
              <div>
                <strong>Speech ms:</strong> {Math.round(vadMetrics.speechMs)}
              </div>
              <div className="col-span-2">
                <div className="text-slate-300 mb-1">Level trend</div>
                <TrendBar values={levelTrendRef.current} color="bg-green-400" />
              </div>
              <div className="col-span-2">
                <div className="text-slate-300 mb-1">SNR trend</div>
                <TrendBar values={snrTrendRef.current} color="bg-blue-400" />
              </div>
            </div>
          )}
          
          {wakeWordDetection.error && (
            <div className="text-red-400">
              <strong>Error:</strong> {wakeWordDetection.error}
            </div>
          )}

          <div>
            <strong>Last Speech:</strong>
            <div className="bg-slate-800 p-2 rounded mt-1 break-all">
              {lastTranscript || 'No speech detected yet'}
            </div>
          </div>

          <div>
            <strong>Detection Log:</strong>
            <div className="bg-slate-800 p-2 rounded mt-1 max-h-32 overflow-y-auto text-xs">
              {detections.length > 0 ? (
                detections.map((detection, i) => (
                  <div key={i} className="mb-1">
                    {detection}
                  </div>
                ))
              ) : (
                <div className="text-gray-400">No detections yet. Try saying "Jarvis"</div>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-400">
          <strong>Wake Words:</strong> "jarvis", "hey jarvis", "okay jarvis"<br/>
          <strong>Tip:</strong> Speak clearly and check your browser's microphone permissions
        </div>
      </div>
    </div>
  )
}