import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Markdown from '../components/ui/Markdown'
import { AppError, summarizeTranscript, createNote, listNotes, deleteNote, clearNotes, updateNote, type NoteItem, getNotesSettings, type NotesPrefs } from '../lib/api'

// Lightweight recorder using Web Speech for interim transcript + MediaRecorder for final high quality blob if we want to extend later.
// For this MVP, we use Web Speech interim results to fill the left transcript panel live.

export default function JarvisNotes() {
  const [searchParams] = useSearchParams()
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState(() => {
    try { return localStorage.getItem('jarvis_notes_transcript') || '' } catch { return '' }
  })
  const [notes, setNotes] = useState(() => {
    try { return localStorage.getItem('jarvis_notes_last') || '' } catch { return '' }
  })
  const [title, setTitle] = useState<string>("")
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const [pinnedOnly, setPinnedOnly] = useState<boolean>(false)
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState<boolean>(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  type NoteEntry = { id: string; at: number; transcript: string; notes: string }
  const [history, setHistory] = useState<NoteEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('jarvis_notes_history') || '[]') } catch { return [] }
  })
  // Server-side history state
  const [serverNotes, setServerNotes] = useState<NoteItem[] | null>(null)
  const [serverNextCursor, setServerNextCursor] = useState<string | null>(null)
  const [serverAvailable, setServerAvailable] = useState<boolean>(true)
  const [search, setSearch] = useState<string>('')
  const searchRef = useRef<number | null>(null)
  const [autoSummarize, setAutoSummarize] = useState<boolean>(() => {
    try { return localStorage.getItem('jarvis_notes_auto') === '1' } catch { return true }
  })
  const [prefs, setPrefs] = useState<NotesPrefs>({ instructions: '', collapsible: false, categories: true })

  const recognitionRef = useRef<any>(null)
  const shouldBeRecordingRef = useRef<boolean>(false)
  const restartBackoffRef = useRef<number>(0)
  const wakeLockRef = useRef<any>(null)
  const resumeGuardRef = useRef<boolean>(false)
  const lastHiddenAtRef = useRef<number | null>(null)

  const canUseSpeech = useMemo(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    return !!SR
  }, [])

  // Persist transcript/notes
  useEffect(() => {
    try { localStorage.setItem('jarvis_notes_transcript', transcript) } catch {}
  }, [transcript])
  useEffect(() => {
    try { if (notes) localStorage.setItem('jarvis_notes_last', notes) } catch {}
  }, [notes])
  useEffect(() => {
    try { localStorage.setItem('jarvis_notes_history', JSON.stringify(history)) } catch {}
  }, [history])
  useEffect(() => {
    try { localStorage.setItem('jarvis_notes_auto', autoSummarize ? '1' : '0') } catch {}
  }, [autoSummarize])
  useEffect(() => {
    let mounted = true
    getNotesSettings().then(p => { if (mounted) setPrefs(p) }).catch(()=>{})
    return () => { mounted = false }
  }, [])

  // If navigated with a specific id/title (e.g., from "New Note"), preselect it for editing
  useEffect(() => {
    try {
      const id = searchParams.get('id')
      const t = searchParams.get('title') || ''
      if (id) {
        setCurrentNoteId(id)
        if (t) setTitle(t)
        // Ensure we start with a blank editor for a fresh note
        setTranscript('')
        finalTextRef.current = ''
        setNotes('')
        // Optimistically add to server list if present
        setServerNotes(prev => {
          if (!prev) return prev
          if (prev.some(n => n.id === id)) return prev
          const placeholder: NoteItem = { id, transcript: '', notes: '', title: t || 'Untitled', createdAt: new Date().toISOString() }
          return [placeholder, ...prev]
        })
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch server notes (with search)
  const fetchServerNotes = useCallback(async (query: string, cursor?: string) => {
    try {
      const res = await listNotes({ query, take: 50, cursor, pinned: pinnedOnly ? true : undefined })
      if (cursor) {
        setServerNotes(prev => ([...(prev || []), ...res.items]))
      } else {
        setServerNotes(res.items)
      }
      setServerNextCursor(res.nextCursor)
      setServerAvailable(true)
    } catch (e) {
      // If unauthorized or failed, fall back to local
      setServerAvailable(false)
      if (!cursor) {
        setServerNotes(null)
        setServerNextCursor(null)
      }
    }
  }, [pinnedOnly])

  // Initial load and on search debounce
  useEffect(() => {
    if (searchRef.current) window.clearTimeout(searchRef.current)
    searchRef.current = window.setTimeout(() => {
      fetchServerNotes(search.trim())
    }, 300)
    return () => { if (searchRef.current) window.clearTimeout(searchRef.current) }
  }, [search, fetchServerNotes])
  useEffect(() => { fetchServerNotes('') }, [fetchServerNotes])

  const saveNote = useCallback(async (text: string, noteText: string) => {
    // Local history: only create a new entry when this is a brand new note
    if (!currentNoteId) {
      const localEntry: NoteEntry = { id: crypto.randomUUID(), at: Date.now(), transcript: text, notes: noteText || '' }
      setHistory(h => [localEntry, ...h].slice(0, 100))
    }
    // Try server persist
    try {
      const defaultTitle = (title || text.slice(0, 60) || 'Untitled').trim()
      if (currentNoteId) {
        const updated = await updateNote(currentNoteId, { transcript: text, notes: noteText, title: defaultTitle })
        setServerNotes(prev => prev ? prev.map(n => n.id === updated.id ? updated : n) : prev)
        setServerAvailable(true)
        setTitle(updated.title || defaultTitle)
      } else {
        const created = await createNote({ transcript: text, notes: noteText, title: defaultTitle })
        setServerNotes(prev => prev ? [{ ...created }, ...prev] : prev)
        setServerAvailable(true)
        setCurrentNoteId(created.id)
        if (!title) setTitle(defaultTitle)
      }
    } catch {
      setServerAvailable(false)
    }
  }, [title, currentNoteId])

  const finalTextRef = useRef('')
  // Best-effort Screen Wake Lock (prevents screen from sleeping; lid close may still suspend on some devices)
  const acquireWakeLock = useCallback(async () => {
    try {
      // Only attempt when page is visible
      if (document.visibilityState !== 'visible') return
      // @ts-ignore – experimental API
      if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
        // @ts-ignore
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
        wakeLockRef.current?.addEventListener?.('release', () => {
          wakeLockRef.current = null
        })
      }
    } catch {
      // Ignore failures; not supported or permission denied
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    try { wakeLockRef.current?.release?.() } catch {}
    wakeLockRef.current = null
  }, [])

  const createAndStartRecognition = useCallback(async (options?: { resume?: boolean }) => {
    const resume = !!options?.resume
    // Do not reset existing partials when resuming after sleep
    if (!resume) finalTextRef.current = (transcript || '').trim()

    if (!canUseSpeech) {
      setError('Speech Recognition not supported in this browser. Try Chrome or Edge.')
      return
    }
    try {
      // Ensure mic permission; some platforms require a fresh getUserMedia after sleep
      await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError('Microphone permission denied')
      return
    }

    try {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      const rec = new SR()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'

      rec.onresult = (ev: any) => {
        try {
          const interim: string[] = []
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const res = ev.results[i]
            const text = res[0]?.transcript || ''
            if (res.isFinal) {
              finalTextRef.current = (finalTextRef.current + ' ' + text).replace(/\s+/g, ' ').trim()
            } else {
              interim.push(text)
            }
          }
          const joined = (finalTextRef.current + ' ' + interim.join(' ')).replace(/\s+/g, ' ').trim()
          setTranscript(joined)
        } catch {}
      }

      rec.onerror = (e: any) => {
        // Common transient errors while backgrounded or after sleep: abort, audio-capture, no-speech
        const code = e?.error || ''
        if (code === 'no-speech' || code === 'aborted' || code === 'audio-capture' || code === 'network') {
          // Schedule a soft restart if user still expects to be recording
          if (shouldBeRecordingRef.current) restartWithBackoff()
          return
        }
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setError('Microphone permission blocked. Allow mic access to continue.')
          shouldBeRecordingRef.current = false
          return
        }
        // Unknown error – show but try to continue gracefully
        setError('Speech recognition error: ' + code)
        if (shouldBeRecordingRef.current) restartWithBackoff()
      }

      rec.onend = () => {
        // Chrome often fires onend after tab sleep/visibility change.
        // If we intend to keep recording, don't flip the UI to Play; quietly restart.
        if (shouldBeRecordingRef.current) {
          restartWithBackoff()
        } else {
          setIsRecording(false)
        }
      }

      recognitionRef.current = rec
      try { await acquireWakeLock() } catch {}
      rec.start()
      setIsRecording(true)
      setPanelOpen(true)
      restartBackoffRef.current = 0 // reset backoff on success
    } catch (e) {
      setError('Failed to start recognition')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseSpeech, transcript, acquireWakeLock])

  const restartWithBackoff = useCallback((immediate?: boolean) => {
    if (!shouldBeRecordingRef.current) return
    if (resumeGuardRef.current) return
    const doStart = async () => {
      resumeGuardRef.current = false
      if (!shouldBeRecordingRef.current) return
      await createAndStartRecognition({ resume: true })
    }
    if (immediate) {
      resumeGuardRef.current = true
      restartBackoffRef.current = 0
      void doStart()
      return
    }
    resumeGuardRef.current = true
    // Exponential backoff from 300ms up to 10s (faster resume after tab switch)
    const next = restartBackoffRef.current > 0 ? Math.min(10000, restartBackoffRef.current * 2) : 300
    restartBackoffRef.current = next
    window.setTimeout(doStart, next)
  }, [createAndStartRecognition])

  const start = useCallback(async () => {
    setError(null)
    // Do not clear existing transcript; append new speech to it
    shouldBeRecordingRef.current = true
    await createAndStartRecognition({ resume: false })
  }, [canUseSpeech, transcript])

  const stop = useCallback(async () => {
    shouldBeRecordingRef.current = false
    try { recognitionRef.current?.stop?.() } catch {}
    releaseWakeLock()
    setIsRecording(false)
    const text = (finalTextRef.current || transcript).trim()
    if (!text) return
    if (autoSummarize) {
      setSummarizing(true)
      try {
        const { notes } = await summarizeTranscript(text)
        setNotes(notes || '')
        // Save locally and server-side
        await saveNote(text, notes || '')
      } catch (e) {
        const err = e as any
        setError(err?.message || 'Failed to summarize')
      } finally {
        setSummarizing(false)
      }
    } else {
      // Just persist transcript and keep existing notes as-is
      try {
        await saveNote(text, (notes || ''))
      } catch {}
    }
  }, [transcript, saveNote, autoSummarize, notes])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Attempt to reacquire wake lock and resume if user intended to keep recording
        acquireWakeLock()
        const now = Date.now()
        const hiddenFor = lastHiddenAtRef.current ? now - lastHiddenAtRef.current : 0
        // Only auto-restart if we were hidden for a meaningful time (likely sleep) to avoid
        // rapid retry loops on quick tab switches. Threshold ~1.5s (tunable).
        const THRESHOLD_MS = 1500
        if (shouldBeRecordingRef.current && !isRecording) {
          // If it was a quick tab switch (< threshold), restart immediately for snappiness.
          restartWithBackoff(hiddenFor < THRESHOLD_MS)
        }
        lastHiddenAtRef.current = null
      } else {
        // Release lock when hidden to comply with platform policies
        releaseWakeLock()
        lastHiddenAtRef.current = Date.now()
      }
    }
    const onPageShow = () => {
      // pageshow often fires on tab restore; prefer immediate restart for better UX
      if (shouldBeRecordingRef.current && !isRecording) restartWithBackoff(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      try { recognitionRef.current?.stop?.() } catch {}
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      releaseWakeLock()
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Left transcript panel */}
      <div className={`transition-all duration-300 ease-in-out bg-slate-900/70 border-r border-slate-800 ${panelOpen ? 'w-80' : 'w-0'} overflow-hidden`}>
        <div className="p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Transcript</h2>
            <button className="text-slate-400 hover:text-slate-200 text-xs" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? 'Hide' : 'Show'}</button>
          </div>
          <div className="flex-1 rounded-md bg-slate-950/60 p-0 overflow-hidden text-slate-200 text-sm">
            <textarea
              className="w-full h-full bg-transparent p-3 outline-none resize-none"
              value={transcript}
              onChange={e => { setTranscript(e.target.value); finalTextRef.current = e.target.value }}
              placeholder={isRecording ? 'Listening…' : 'Press Play to start capturing. You can also paste or edit text here before summarizing.'}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={async () => {
                const text = (transcript || '').trim()
                if (!text) { setError('Transcript is empty'); return }
                setError(null)
                try {
                  setSummarizing(true)
                  const { notes } = await summarizeTranscript(text, prefs)
                  setNotes(notes || '')
                  // Persist: if currentNoteId exists, update; else create and set id
                  if (currentNoteId) {
                    try {
                      const updated = await updateNote(currentNoteId, { transcript: text, notes: notes || '' })
                      setServerNotes(prev => prev ? prev.map(n => n.id === updated.id ? updated : n) : prev)
                    } catch {}
                  } else {
                    try {
                      const created = await createNote({ transcript: text, notes: notes || '', title: (title || text.slice(0,60) || 'Untitled').trim() })
                      setCurrentNoteId(created.id)
                      setServerNotes(prev => prev ? [{ ...created }, ...prev] : prev)
                      if (!title) setTitle(created.title || (text.slice(0,60) || 'Untitled'))
                    } catch {}
                  }
                } catch (e) {
                  const err = e as any
                  setError(err?.message || 'Failed to summarize')
                } finally { setSummarizing(false) }
              }}
              className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm"
              title="Summarize the current transcript"
            >
              Summarize
            </button>
          </div>
        </div>
      </div>

      {/* Edge handle to reopen transcript when hidden */}
      {!panelOpen && (
        <button
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 px-2 py-3 rounded-r-md bg-slate-900/80 text-slate-200 ring-1 ring-white/10 hover:bg-slate-800/80"
          aria-label="Show transcript"
          onClick={() => setPanelOpen(true)}
        >
          Transcript
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
          <Link
            to="/"
            className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm"
            title="Go to main site"
          >Home</Link>
          <button
            onClick={() => (isRecording ? stop() : start())}
            className={`px-4 py-2 rounded-md font-medium ${isRecording ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
            title={isRecording ? (autoSummarize ? 'Stop and summarize' : 'Stop recording') : 'Start listening'}
          >
            {isRecording ? 'Stop' : 'Play'}
          </button>
          <span className="text-xs text-slate-400" title="While in a call overlay, press T to toggle the transcript panel">
            Tip: press T in calls to toggle transcript
          </span>
          <button
            onClick={async () => {
              try {
                // Create a fresh blank note and load it into the editor
                const ts = new Date()
                const nice = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString()}`
                const baseTitle = `Untitled (${nice})`
                // Backend requires either transcript or notes to be non-empty
                const created = await createNote({ transcript: '', notes: ' ', title: baseTitle })
                setCurrentNoteId(created.id)
                setTranscript('')
                finalTextRef.current = ''
                setNotes('')
                setTitle(created.title || baseTitle)
                setServerNotes(prev => prev ? [{ ...created }, ...prev] : prev)
                // Focus title for quick rename
                setTimeout(() => titleInputRef.current?.focus(), 0)
                // Ensure transcript panel is visible and auto-start listening if supported
                setPanelOpen(true)
                if (!isRecording && canUseSpeech) {
                  try { await start() } catch {}
                }
              } catch (e) {
                const err = AppError.from(e)
                setError(`Failed to create a new note: ${err.message}`)
              }
            }}
            className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm"
            title="Create a new note"
          >New Note</button>
          <span className="text-slate-400 text-sm">Jarvis Notes</span>
          <input
            ref={titleInputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Untitled note"
            className="ml-2 flex-1 max-w-md text-sm bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700"
            title="Name your notes"
          />
          <label className="flex items-center gap-2 text-xs text-slate-300 select-none" title="When on, stopping recording will auto-summarize the transcript">
            <input type="checkbox" checked={autoSummarize} onChange={e => setAutoSummarize(e.target.checked)} /> Auto summarize
          </label>
          <button
            onClick={async () => {
              const t = title.trim()
              if (!currentNoteId) {
                // If the note isn't saved yet, create now
                const text = (transcript || '').trim()
                if (!text && !notes) return
                try {
                  const created = await createNote({ transcript: text, notes, title: t || (text.slice(0,60)||'Untitled') })
                  setCurrentNoteId(created.id)
                  setTitle(created.title)
                  setServerNotes(prev => prev ? [{ ...created }, ...prev] : prev)
                } catch {}
              } else {
                try {
                  const updated = await updateNote(currentNoteId, { title: t })
                  setTitle(updated.title)
                  setServerNotes(prev => prev ? prev.map(n => n.id === updated.id ? updated : n) : prev)
                } catch {}
              }
            }}
            className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm"
            title="Save title"
          >Save</button>
          <button
            onClick={() => { setTranscript(''); finalTextRef.current=''; setNotes(''); setError(null) }}
            className="ml-auto px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm"
            title="Clear transcript and notes"
          >
            Clear
          </button>
        </div>

        <div className="p-6 overflow-auto flex-1">
          {summarizing && (
            <div className="mb-4 text-sm text-blue-300 bg-blue-950/40 border border-blue-900 rounded p-3 flex items-center gap-2">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-300 border-t-transparent rounded-full"></span>
              Summarizing…
            </div>
          )}
          {error && (
            <div className="mb-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>
          )}

          {!notes && (
            <div className="text-slate-500 text-sm">
              When you stop, the transcript will be summarized into organized notes using your OpenAI key if set in Settings (or the server key).
            </div>
          )}
          {notes && (
            <div className="prose prose-invert max-w-3xl">
              <Markdown content={notes} prefs={prefs as any} />
            </div>
          )}
        </div>
      </div>

      {/* History panel (right) */}
      <div className={`transition-all duration-300 ease-in-out bg-slate-900/70 border-l border-slate-800 ${historyOpen ? 'w-80' : 'w-0'} overflow-hidden`}>
        <div className="p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">History</h2>
            <div className="flex items-center gap-3">
              <Link to="/notes/settings" className="text-slate-400 hover:text-slate-200 text-xs underline">Settings</Link>
              <button className="text-slate-400 hover:text-slate-200 text-xs" onClick={() => setHistoryOpen(!historyOpen)}>{historyOpen ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search notes…"
              className="w-full text-sm bg-slate-950/60 border border-slate-800 rounded px-2 py-1 outline-none focus:border-slate-700"
            />
            <label className="text-xs text-slate-400 flex items-center gap-1">
              <input type="checkbox" checked={pinnedOnly} onChange={e => setPinnedOnly(e.target.checked)} /> Pinned only
            </label>
          </div>
          <div className="flex-1 overflow-auto space-y-2 pr-1">
            {serverAvailable && serverNotes && serverNotes.length === 0 && (
              <div className="text-slate-500 text-sm">No saved notes yet. Generate notes to see them here.</div>
            )}
            {serverAvailable && serverNotes && serverNotes.map(item => (
              <div key={item.id} className="rounded-md border border-slate-800 bg-slate-950/40 p-2">
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span className="truncate max-w-[11rem]" title={item.title || undefined}>{item.title || new Date(item.createdAt).toLocaleString()}</span>
                  <div className="flex items-center gap-2">
                    <button
                      className={item.pinned ? 'text-yellow-300 hover:text-yellow-200' : 'text-slate-400 hover:text-slate-200'}
                      title={item.pinned ? 'Unpin' : 'Pin'}
                      onClick={async () => {
                        try {
                          const updated = await updateNote(item.id, { pinned: !item.pinned })
                          setServerNotes(list => list ? list.map(n => n.id === item.id ? updated : n) : list)
                        } catch {}
                      }}
                    >★</button>
                    <button
                      className="text-blue-400 hover:text-blue-300"
                      title="Load this into editor"
                      onClick={() => { setTranscript(item.transcript); finalTextRef.current = item.transcript; setNotes(item.notes); setTitle(item.title || ''); setCurrentNoteId(item.id) }}
                    >Load</button>
                    <button
                      className="text-red-400 hover:text-red-300"
                      title="Delete this entry"
                      onClick={async () => {
                        try { await deleteNote(item.id); setServerNotes(list => (list || []).filter(x => x.id !== item.id)); if (currentNoteId === item.id) setCurrentNoteId(null) } catch {}
                      }}
                    >Delete</button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-300 line-clamp-2 whitespace-pre-wrap">{item.transcript}</div>
              </div>
            ))}

            {/* Local fallback when server not available */}
            {!serverAvailable && (
              <>
                {history.length === 0 && (
                  <div className="text-slate-500 text-sm">No local notes yet. Generate notes to see them here.</div>
                )}
                {history
                  .filter(h => !search.trim() || h.transcript.toLowerCase().includes(search.trim().toLowerCase()) || h.notes.toLowerCase().includes(search.trim().toLowerCase()))
                  .map(item => (
                  <div key={item.id} className="rounded-md border border-slate-800 bg-slate-950/40 p-2">
                    <div className="text-xs text-slate-400 flex items-center justify-between">
                      <span>{new Date(item.at).toLocaleString()}</span>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-blue-400 hover:text-blue-300"
                          title="Load this into editor"
                          onClick={() => { setTranscript(item.transcript); finalTextRef.current = item.transcript; setNotes(item.notes) }}
                        >Load</button>
                        <button
                          className="text-red-400 hover:text-red-300"
                          title="Delete this entry"
                          onClick={() => setHistory(h => h.filter(hh => hh.id !== item.id))}
                        >Delete</button>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-slate-300 line-clamp-2 whitespace-pre-wrap">{item.transcript}</div>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between">
            {serverAvailable && serverNextCursor && (
              <button
                className="text-xs text-slate-400 hover:text-slate-200"
                onClick={() => fetchServerNotes(search.trim(), serverNextCursor || undefined)}
              >Load more</button>
            )}
            {(serverAvailable ? (serverNotes && serverNotes.length > 0) : history.length > 0) && (
              <button
                className="ml-auto text-xs text-slate-400 hover:text-slate-200"
                onClick={async () => {
                  if (serverAvailable) {
                    try { await clearNotes(); setServerNotes([]); setServerNextCursor(null); setCurrentNoteId(null); setTitle('') } catch {}
                  } else {
                    setHistory([]); setCurrentNoteId(null); setTitle('')
                  }
                }}
                title="Clear all history"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Edge handle to reopen history when hidden */}
      {!historyOpen && (
        <button
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 px-2 py-3 rounded-l-md bg-slate-900/80 text-slate-200 ring-1 ring-white/10 hover:bg-slate-800/80"
          aria-label="Show history"
          onClick={() => setHistoryOpen(true)}
        >
          History
        </button>
      )}
    </div>
  )
}
