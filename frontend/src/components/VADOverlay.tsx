import React from 'react'

type VADOverlayProps = {
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

export default function VADOverlay({ vadMetrics, vadEngine = 'js', wasmActive = false }: VADOverlayProps) {
  if (!vadMetrics) return null
  const { levelDb, snrDb, silenceMs, speechMs, inSpeech } = vadMetrics

  const dot = (
    <span className={`inline-block w-2 h-2 rounded-full ${inSpeech ? 'bg-green-400' : 'bg-slate-500'}`} />
  )

  return (
    <div className="fixed left-4 bottom-4 z-[60] rounded-lg border border-cyan-300/30 bg-slate-900/90 px-3 py-2 text-xs text-slate-100 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2 mb-1">
        {dot}
        <span className="font-semibold text-cyan-200">VAD</span>
        <span className="text-slate-400">[{vadEngine}{vadEngine === 'wasm' ? (wasmActive ? ':on' : ':off') : ''}]</span>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1">
        <div>
          <span className="text-slate-400">Level</span>{' '}
          <span className="font-mono">{levelDb.toFixed(1)} dB</span>
        </div>
        <div>
          <span className="text-slate-400">SNR</span>{' '}
          <span className="font-mono">{snrDb.toFixed(1)} dB</span>
        </div>
        <div>
          <span className="text-slate-400">Speech</span>{' '}
          <span className="font-mono">{Math.round(speechMs)} ms</span>
        </div>
        <div>
          <span className="text-slate-400">Silence</span>{' '}
          <span className="font-mono">{Math.round(silenceMs)} ms</span>
        </div>
        <div className="col-span-2">
          <div className="h-1.5 w-full bg-slate-800 rounded">
            <div
              className="h-1.5 bg-cyan-400 rounded"
              style={{ width: `${Math.max(0, Math.min(1, (snrDb) / 20)) * 100}%` }}
              aria-label="SNR bar"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
