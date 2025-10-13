import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import EnhancedStudyGuide from '../components/EnhancedStudyGuide'
import { getStudySet, type StudySet, getStudyProgress, completeStudySection, type StudyProgress, deleteStudySet, replaceStudyProgress, generateStudySet, updateStudySet } from '../lib/api'
import { useToast } from '../components/ToastHost'
import { parseStudyGuideContent } from '../lib/studyGuideUtils'

export default function EnhancedStudyGuideView() {
  const { id } = useParams()
  const [setData, setSetData] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<StudyProgress | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [pendingSections, setPendingSections] = useState<string[] | null>(null)
  const [pendingBookmarks, setPendingBookmarks] = useState<string[] | null>(null)
  const [lastBatchedAt, setLastBatchedAt] = useState<number>(0)
  const toast = useToast()
  // Linked tool set ids (if this guide already has created sets or embeds tools itself)
  const [linkedFlashId, setLinkedFlashId] = useState<string | null>(null)
  const [linkedTestId, setLinkedTestId] = useState<string | null>(null)
  const [linkedMatchId, setLinkedMatchId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    if (id) {
      getStudySet(id).then(s => { if (mounted) setSetData(s) }).catch(e => setError(e?.message || 'Failed to load'))
      getStudyProgress(id).then(p => { if (mounted) setProgress(p) })
    }
    return () => { mounted = false }
  }, [id])

  // Resolve existing linked tool sets (from localStorage reverse links or embedded content)
  useEffect(() => {
    if (!id) return
    // If current set already contains tools, prefer self
    if (setData?.content?.flashcards && setData.content.flashcards.length > 0) {
      setLinkedFlashId(id)
    } else {
      try {
        const map = JSON.parse(localStorage.getItem('flashcard-study-links') || '{}')
        const found = Object.keys(map).find(k => map[k] === id) || null
        setLinkedFlashId(found)
      } catch { setLinkedFlashId(null) }
    }
    if (setData?.content?.test && setData.content.test.length > 0) {
      setLinkedTestId(id)
    } else {
      try {
        const map = JSON.parse(localStorage.getItem('test-study-links') || '{}')
        const found = Object.keys(map).find(k => map[k] === id) || null
        setLinkedTestId(found)
      } catch { setLinkedTestId(null) }
    }
    if (setData?.content?.match && setData.content.match.length > 0) {
      setLinkedMatchId(id)
    } else {
      try {
        const map = JSON.parse(localStorage.getItem('match-study-links') || '{}')
        const found = Object.keys(map).find(k => map[k] === id) || null
        setLinkedMatchId(found)
      } catch { setLinkedMatchId(null) }
    }
    // Try server-derived sets (DB persisted reverse links)
    ;(async () => {
      try {
        const r = await fetch(`/api/study/sets/${encodeURIComponent(id)}/derived`, { credentials: 'include' })
        if (!r.ok) return
        const data = await r.json()
        const items = Array.isArray(data.items) ? data.items : []
        const flash = items.find((x:any)=> Array.isArray(x?.content?.flashcards) && x.content.flashcards.length>0)?.id || null
        const test  = items.find((x:any)=> Array.isArray(x?.content?.test) && x.content.test.length>0)?.id || null
        const match = items.find((x:any)=> Array.isArray(x?.content?.match) && x.content.match.length>0)?.id || null
        if (flash) setLinkedFlashId(prev => prev || flash)
        if (test) setLinkedTestId(prev => prev || test)
        if (match) setLinkedMatchId(prev => prev || match)
      } catch {}
    })()
  }, [id, setData])

  // Time tracking (accumulate every 30s -> send after 2 min or on unload)
  useEffect(() => {
    if (!id) return
    const start = Date.now()
    let lastPersistedMin = 0
    const interval = setInterval(async () => {
      const elapsed = Date.now() - start
      setElapsedMs(elapsed)
      const mins = Math.floor(elapsed / 60000)
      if (mins > 0 && mins !== lastPersistedMin) {
        lastPersistedMin = mins
        queueProgressSave({ timeSpent: mins })
      }
    }, 10000) // check every 10s
    const flush = async () => {
      const elapsed = Date.now() - start
      const mins = Math.floor(elapsed / 60000)
      if (mins > 0 && mins !== lastPersistedMin) {
        queueProgressSave({ timeSpent: mins, immediate: true })
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => { clearInterval(interval); window.removeEventListener('beforeunload', flush) }
  }, [id, progress])

  // Debounced progress save batching
  const queueProgressSave = (opts: { timeSpent?: number; immediate?: boolean } = {}) => {
    if (!id) return
    setDirty(true)
    if (progress) {
      if (pendingSections === null) setPendingSections(progress.sectionsCompleted)
      if (pendingBookmarks === null) setPendingBookmarks(progress.bookmarks || [])
    }
    const now = Date.now()
    const delay = opts.immediate ? 0 : 800
    const scheduleAt = now + delay
    // simple timeout without ref: use setTimeout each call; no need to cancel old if immediate
    setTimeout(async () => {
      if (!id) return
      if (!progress) return
      // if recent save happened <400ms ago and not immediate, postpone one more cycle
      if (!opts.immediate && Date.now() - lastBatchedAt < 400) return
      try {
        // Only include bookmarks in payload if we have an explicit pending value; otherwise skip to avoid overwriting server state (e.g., from toggle endpoint)
        const payload: { timeSpent?: number; bookmarks?: string[] } = { timeSpent: opts.timeSpent ?? progress.timeSpent }
        if (pendingBookmarks !== null) payload.bookmarks = pendingBookmarks
        const p = await replaceStudyProgress(id, pendingSections || progress.sectionsCompleted, payload)
        setProgress(p)
        setLastBatchedAt(Date.now())
        setDirty(false)
        setPendingSections(null)
        setPendingBookmarks(null)
      } catch (e) {
        // swallow; UI already optimistic
      }
    }, delay)
  }

  const sections = useMemo(() => {
    if (!setData?.content?.guide) return []
    try {
      return parseStudyGuideContent(setData.content.guide).map((s,i) => ({
        id: s.id || `sec-${i}`,
        title: s.title || `Section ${i+1}`,
        content: s.content || '',
        type: s.type || 'details',
        estimatedTime: s.estimatedTime,
        difficulty: s.difficulty
      }))
    } catch {
      return []
    }
  }, [setData])

  const loading = !setData && !error

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to="/study" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Back</Link>
        <div className="font-medium">Enhanced Study Guide</div>
        <div className="ml-auto flex items-center gap-2">
          {id && (
            <button
              onClick={async () => { try { await deleteStudySet(id); window.location.href='/study' } catch (e:any) { setError(e?.message || 'Delete failed') } }}
              className="px-3 py-2 rounded-md border border-red-700 bg-red-900 text-red-200 hover:bg-red-800 text-sm"
            >Delete</button>
          )}
          {id && (
            <button
              disabled={resetting || !progress || progress.sectionsCompleted.length===0}
              onClick={async ()=>{
                if (!id) return
                if (!confirm('Reset all progress for this study guide?')) return
                setResetting(true)
                try {
                  const p = await replaceStudyProgress(id, [])
                  setProgress(p)
                  toast({ message: 'Progress reset', type: 'success' })
                } finally { setResetting(false) }
              }}
              className="px-3 py-2 rounded-md border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
            >{resetting ? 'Resetting…' : 'Reset Progress'}</button>
          )}
          {id && sections.length>0 && (
            <button
              onClick={async ()=>{
                if (!id) return
                try {
                  const allIds = sections.map(s=>s.id)
                  const p = await replaceStudyProgress(id, allIds)
                  setProgress(p)
                  toast({ message: 'All sections marked complete', type: 'success' })
                } catch (e:any) { toast({ message: e?.message || 'Failed to mark all', type: 'error' }) }
              }}
              className="px-3 py-2 rounded-md border border-emerald-700 bg-emerald-900 text-emerald-200 hover:bg-emerald-800 text-sm"
            >Mark All Complete</button>
          )}
          <button
            onClick={()=> setShowRaw(r=>!r)}
            className="px-3 py-2 rounded-md border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 text-sm"
          >{showRaw ? 'Enhanced View' : 'Raw Markdown'}</button>
          {!published && id && (
            <button
              disabled={publishing}
              onClick={async () => {
                setPublishing(true)
                try {
                  const r = await fetch(`/api/study/publish/${encodeURIComponent(id)}`, { method: 'POST', credentials: 'include' })
                  if (!r.ok) throw new Error('Publish failed')
                  setPublished(true)
                  alert('Set published!')
                } catch (e:any) { setError(e?.message || 'Publish failed') } finally { setPublishing(false) }
              }}
              className="px-3 py-2 rounded-md border border-cyan-700 bg-cyan-900 text-cyan-200 hover:bg-cyan-800 text-sm"
            >{publishing ? 'Publishing…' : 'Publish'}</button>
          )}
        </div>
      </div>
      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}
      {loading && <div className="p-6 text-slate-400">Loading…</div>}
      {setData && setData.content?.guide && (
        <div className="p-6">
          {!showRaw && (
          <EnhancedStudyGuide
            id={setData.id}
            title={setData.title || 'Study Guide'}
            subject={setData.subject || undefined}
            sections={sections}
            estimatedTime={30}
            difficulty={'intermediate'}
            progress={progress ? { sectionsCompleted: progress.sectionsCompleted, timeSpent: progress.timeSpent || 0, difficultyConcepts: [], strongConcepts: [], personalNotes: {}, bookmarks: progress.bookmarks || [], lastStudied: progress.lastStudied } : undefined}
            linkedFlashcardSetId={linkedFlashId}
            linkedTestSetId={linkedTestId}
            linkedMatchSetId={linkedMatchId}
            onSectionComplete={async (sectionId) => {
              console.log('🔘 Mark Complete clicked:', { sectionId, studySetId: id })
              if (!id) {
                console.error('❌ No study set ID!')
                return
              }
              // optimistic update
              setProgress(p => p ? { ...p, sectionsCompleted: p.sectionsCompleted.includes(sectionId) ? p.sectionsCompleted : [...p.sectionsCompleted, sectionId] } : p)
              try {
                console.log('📡 Calling completeStudySection API...')
                const p = await completeStudySection(id, sectionId)
                console.log('✅ API response:', p)
                if (p) setProgress(p)
                queueProgressSave()
              } catch (e:any) {
                console.error('❌ Mark complete failed:', e)
                // rollback if failed
                setProgress(p => p ? { ...p, sectionsCompleted: p.sectionsCompleted.filter(s=>s!==sectionId) } : p)
                toast({ message: e?.message || 'Failed to mark complete', type: 'error' })
              }
            }}
            onBookmark={async (sectionId) => {
              if (!id) return
              // optimistic bookmark toggle using replaceStudyProgress with bookmarks
              setProgress(p => p ? { ...p, bookmarks: p.bookmarks.includes(sectionId) ? p.bookmarks.filter(b=>b!==sectionId) : [...p.bookmarks, sectionId] } : p)
              try {
                const res = await fetch(`/api/study/progress/${encodeURIComponent(id)}/bookmark/${encodeURIComponent(sectionId)}`, { method: 'POST', credentials: 'include' })
                if (!res.ok) throw new Error('Bookmark toggle failed')
                const data = await res.json()
                if (data?.progress) setProgress(prev => prev ? { ...prev, bookmarks: data.progress.bookmarks || [] } : prev)
                // Do not queue a progress save here to avoid overwriting bookmarks with stale state
              } catch (e:any) {
                // rollback
                setProgress(p => p ? { ...p, bookmarks: p.bookmarks.includes(sectionId) ? p.bookmarks.filter(b=>b!==sectionId) : [...p.bookmarks, sectionId] } : p)
                toast({ message: e?.message || 'Failed to toggle bookmark', type: 'error' })
              }
            }}
            onCreateFlashcards={async (content, sectionId) => {
              if (!id || !setData) return
              try {
                const set = await generateStudySet({
                  subject: setData.subject || setData.title,
                  info: setData.sourceText || content,
                  tools: ['flashcards'],
                  title: sectionId ? `${setData.title || 'Study Set'} – Flashcards: ${sections.find(s=>s.id===sectionId)?.title || 'Section'}` : `${setData.title || 'Study Set'} – Flashcards`,
                  sourceGuideId: id
                })
                // link: flashcard set -> guide id
                try {
                  const map = JSON.parse(localStorage.getItem('flashcard-study-links') || '{}')
                  map[set.id] = id
                  localStorage.setItem('flashcard-study-links', JSON.stringify(map))
                } catch {}
                setLinkedFlashId(set.id)
                toast({ message: 'Flashcards created', type: 'success' })
                window.location.href = `/study/sets/${set.id}/flashcards`
              } catch (e:any) {
                toast({ message: e?.message || 'Failed to create flashcards', type: 'error' })
              }
            }}
            onCreateTest={async (content) => {
              if (!id || !setData) return
              try {
                // Build simple adapt hints: focus on remaining and advanced sections
                const remaining = sections.filter(s => !progress?.sectionsCompleted?.includes(s.id)).map(s => s.id)
                const adv = sections.filter(s => s.difficulty === 'advanced').map(s => s.id)
                const focus = Array.from(new Set([...remaining, ...adv]))
                const diffWeights: Record<string, number> = { beginner: 0.2, intermediate: 0.4, advanced: 0.4 }
                const set = await generateStudySet({
                  subject: setData.subject || setData.title,
                  info: setData.sourceText || content,
                  tools: ['test'],
                  title: `${setData.title || 'Study Set'} – Test`,
                  sourceGuideId: id,
                  adapt: { focusSectionIds: focus, difficultyWeight: diffWeights }
                })
                try {
                  const map = JSON.parse(localStorage.getItem('test-study-links') || '{}')
                  map[set.id] = id
                  localStorage.setItem('test-study-links', JSON.stringify(map))
                } catch {}
                setLinkedTestId(set.id)
                toast({ message: 'Test created', type: 'success' })
                window.location.href = `/study/sets/${set.id}/test`
              } catch (e:any) {
                toast({ message: e?.message || 'Failed to create test', type: 'error' })
              }
            }}
            onCreateMatch={async (content) => {
              if (!id || !setData) return
              try {
                const set = await generateStudySet({
                  subject: setData.subject || setData.title,
                  info: setData.sourceText || content,
                  tools: ['match'],
                  title: `${setData.title || 'Study Set'} – Match`,
                  sourceGuideId: id
                })
                try {
                  const map = JSON.parse(localStorage.getItem('match-study-links') || '{}')
                  map[set.id] = id
                  localStorage.setItem('match-study-links', JSON.stringify(map))
                } catch {}
                setLinkedMatchId(set.id)
                toast({ message: 'Match game created', type: 'success' })
                window.location.href = `/study/sets/${set.id}/match`
              } catch (e:any) {
                toast({ message: e?.message || 'Failed to create match game', type: 'error' })
              }
            }}
            onInsertDiagram={async (sectionId, mermaid) => {
              // Update UI and persist to backend
              try {
                const { insertMermaidDiagramIntoGuide } = await import('../lib/studyGuideUtils')
                let updatedGuide = setData?.content?.guide || ''
                updatedGuide = insertMermaidDiagramIntoGuide(updatedGuide, sectionId, mermaid)
                if (id) {
                  await updateStudySet(id, { content: { guide: updatedGuide } })
                }
                setSetData(prev => prev ? { ...prev, content: { ...prev.content, guide: updatedGuide } } : prev)
                toast({ message: 'Diagram inserted and saved', type: 'success' })
              } catch (e:any) {
                toast({ message: e?.message || 'Failed to insert diagram', type: 'error' })
              }
            }}
          />
          )}
          {showRaw && (
            <div className="prose prose-invert max-w-none whitespace-pre-wrap font-mono text-xs bg-slate-950/60 p-4 rounded-md border border-slate-800 overflow-x-auto">{setData.content?.guide || ''}</div>
          )}
        </div>
      )}
      {setData && !setData.content?.guide && (
        <div className="p-6 text-slate-400">This set has no guide content.</div>
      )}
    </div>
  )
}
