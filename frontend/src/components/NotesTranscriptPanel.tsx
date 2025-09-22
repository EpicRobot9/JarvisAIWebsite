import React, { useEffect, useRef } from 'react'

export default function NotesTranscriptPanel({
  open,
  onClose,
  transcript,
  interim,
  paused,
  onTogglePause,
  summarizing,
}: {
  open: boolean
  onClose: () => void
  transcript: string
  interim?: string
  paused: boolean
  onTogglePause: () => void
  summarizing?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [open, transcript, interim])

  return (
    <div className={`fixed inset-y-0 right-0 z-50 transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="h-full w-[380px] sm:w-[420px] bg-slate-950/85 backdrop-blur border-l border-white/10 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-slate-200 font-semibold">Transcript</span>
            {summarizing && (
              <span className="ml-2 text-xs text-amber-300">Summarizing…</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`jarvis-btn ${paused ? '' : 'jarvis-btn-primary'}`}
              onClick={onTogglePause}
              title={paused ? 'Resume' : 'Pause'}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="jarvis-btn jarvis-btn-danger" onClick={onClose} title="Close transcript">×</button>
          </div>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 text-sm leading-relaxed text-slate-200">
          {transcript ? (
            <div className="whitespace-pre-wrap">
              {transcript}
              {interim && !paused && (
                <span className="opacity-70 italic"> {interim}</span>
              )}
            </div>
          ) : (
            <div className="text-slate-400">Say “Start notes” to begin capturing your transcript.</div>
          )}
        </div>
      </div>
    </div>
  )
}
