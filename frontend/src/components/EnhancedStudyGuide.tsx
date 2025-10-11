import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, ChevronUp, Clock, BookOpen, CheckCircle, RotateCcw, Eye, EyeOff, Search, Filter, Download, Star, BarChart3, Lightbulb } from 'lucide-react'
import Markdown from './ui/Markdown'
// Lazy load Mermaid renderer to cut initial bundle size
const Mermaid = React.lazy(() => import('./ui/Mermaid'))
import { generateDiagram } from '../lib/api'

interface StudyGuideSection {
  id: string
  title: string
  content: string
  type: 'overview' | 'concepts' | 'details' | 'questions' | 'summary'
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  estimatedTime?: number // in minutes
  completed?: boolean
  importance?: number // 1-5 scale
  keywords?: string[]
}

interface StudyGuideProgress {
  id?: string
  userId?: string
  studySetId?: string
  sectionsCompleted: string[]
  timeSpent: number // in minutes
  studyScore?: number // 0-100
  lastStudied?: string
  difficultyConcepts: string[]
  strongConcepts: string[]
  personalNotes: Record<string, string>
  bookmarks: string[]
  preferences?: Record<string, any>
}

interface StudyGuideProps {
  id: string
  title: string
  subject?: string
  sections: StudyGuideSection[]
  estimatedTime?: number
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  progress?: StudyGuideProgress | null
  linkedFlashcardSetId?: string | null
  linkedTestSetId?: string | null
  linkedMatchSetId?: string | null
  onProgressUpdate?: (progress: StudyGuideProgress) => void
  onSectionComplete?: (sectionId: string) => void
  onBookmark?: (sectionId: string) => void
  onCreateFlashcards?: (content: string, sectionId?: string) => void
  onCreateTest?: (content: string) => void
  onCreateMatch?: (content: string) => void
  onInsertDiagram?: (sectionId: string, mermaid: string) => void | Promise<void>
}

export default function EnhancedStudyGuide({
  id,
  title,
  subject,
  sections,
  estimatedTime = 30,
  difficulty = 'intermediate',
  progress,
  linkedFlashcardSetId,
  linkedTestSetId,
  linkedMatchSetId,
  onProgressUpdate,
  onSectionComplete,
  onBookmark,
  onCreateFlashcards,
  onCreateTest,
  onCreateMatch,
  onInsertDiagram
}: StudyGuideProps) {
  // State management
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  // Per-section diagram state (avoid hooks in loops)
  const [diagramBySection, setDiagramBySection] = useState<Record<string, { diagram: string; type: 'flowchart'|'sequence'|'class'|'er'|'state'|''; loading: boolean }>>({})
  const getDiag = useCallback((sid: string) => diagramBySection[sid] || { diagram: '', type: '', loading: false }, [diagramBySection])
  const setDiagLoading = useCallback((sid: string, loading: boolean) => {
    setDiagramBySection(prev => ({ ...prev, [sid]: { ...(prev[sid] || { diagram: '', type: '', loading: false }), loading } }))
  }, [])
  const setDiagData = useCallback((sid: string, diagram: string, type: 'flowchart'|'sequence'|'class'|'er'|'state'|'' ) => {
    setDiagramBySection(prev => ({ ...prev, [sid]: { diagram, type, loading: false } }))
  }, [])

  console.log('EnhancedStudyGuide rendered with:', { id, sectionsCount: sections.length, progress, difficulty, estimatedTime })

  // Filtered sections
  // Filtering state
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'remaining' | 'bookmarked'>('all')
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set())
  const [difficultyFilters, setDifficultyFilters] = useState<Set<string>>(new Set())
  const storageKey = `guide-filters:${id}`

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const prefs = JSON.parse(raw)
      if (prefs.statusFilter) setStatusFilter(prefs.statusFilter)
      if (Array.isArray(prefs.typeFilters)) setTypeFilters(new Set(prefs.typeFilters))
      if (Array.isArray(prefs.difficultyFilters)) setDifficultyFilters(new Set(prefs.difficultyFilters))
      if (typeof prefs.searchQuery === 'string') setSearchQuery(prefs.searchQuery)
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    try {
      const prefs = {
        statusFilter,
        typeFilters: Array.from(typeFilters),
        difficultyFilters: Array.from(difficultyFilters),
        searchQuery
      }
      localStorage.setItem(storageKey, JSON.stringify(prefs))
    } catch {}
  }, [statusFilter, typeFilters, difficultyFilters, searchQuery, storageKey])

  const toggleType = (t: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }

  const filteredSections = useMemo(() => {
    return sections.filter(section => {
      if (statusFilter === 'completed' && !progress?.sectionsCompleted?.includes(section.id)) return false
      if (statusFilter === 'remaining' && progress?.sectionsCompleted?.includes(section.id)) return false
      if (statusFilter === 'bookmarked' && !(progress?.bookmarks || []).includes(section.id)) return false
      if (typeFilters.size && !typeFilters.has(section.type)) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!section.title.toLowerCase().includes(q) && !section.content.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [sections, searchQuery, statusFilter, typeFilters, progress?.sectionsCompleted, progress?.bookmarks])

  // Difficulty filters
  const toggleDifficulty = (d: string) => {
    setDifficultyFilters(prev => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d); else next.add(d)
      return next
    })
  }

  const filteredCountFor = (filter: 'completed' | 'remaining' | 'bookmarked') => {
    if (filter === 'completed') return progress?.sectionsCompleted?.length || 0
    if (filter === 'bookmarked') return progress?.bookmarks?.length || 0
    if (filter === 'remaining') return sections.length - (progress?.sectionsCompleted?.length || 0)
    return sections.length
  }

  // Apply difficulty filtering after base filtering
  const fullyFilteredSections = useMemo(() => {
    if (!difficultyFilters.size) return filteredSections
    return filteredSections.filter(s => difficultyFilters.has((s.difficulty || 'intermediate')))
  }, [filteredSections, difficultyFilters])

  // Progress calculations
  const progressStats = useMemo(() => {
    const completed = progress?.sectionsCompleted?.length || 0
    const total = sections.length
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
    
    return { completed, total, percentage }
  }, [progress, sections.length])

  // Relative time label for last studied
  const lastStudiedLabel = useMemo(() => {
    if (!progress?.lastStudied) return ''
    const date = new Date(progress.lastStudied)
    const diffMs = Date.now() - date.getTime()
    if (diffMs < 60_000) return 'just now'
    const mins = Math.floor(diffMs / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }, [progress?.lastStudied])

  // Toggle section expansion
  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId)
      } else {
        newSet.add(sectionId)
      }
      return newSet
    })
  }, [])

  if (sections.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <BookOpen size={48} className="mx-auto mb-4 opacity-50" />
        <p>No sections found in study guide</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-100">{title}</h2>
            {subject && <p className="text-slate-400 text-lg mt-1">{subject}</p>}
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${
              difficulty === 'beginner' ? 'bg-green-900 text-green-300' :
              difficulty === 'intermediate' ? 'bg-yellow-900 text-yellow-300' :
              'bg-red-900 text-red-300'
            }`}>
              {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <Clock size={16} />
              <span className="text-sm">{estimatedTime}min</span>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-300">Study Progress</span>
            <span className="text-sm text-slate-400">
              {progressStats.completed}/{progressStats.total} sections completed
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-blue-500 to-emerald-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressStats.percentage}%` }}
            />
          </div>
          {lastStudiedLabel && <div className="mt-1 text-xs text-slate-500">Last studied {lastStudiedLabel}</div>}
        </div>

        {/* Study Tools */}
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm text-slate-300 font-medium">Study Tools:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const fullContent = sections.map(s => s.content).join('\n\n')
                if (linkedFlashcardSetId) {
                  window.location.href = `/study/sets/${linkedFlashcardSetId}/flashcards`
                } else {
                  onCreateFlashcards?.(fullContent)
                }
              }}
              className={`px-3 py-1 ${linkedFlashcardSetId ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-purple-600 hover:bg-purple-500'} text-white rounded text-sm flex items-center gap-2`}
            >
              🃏 {linkedFlashcardSetId ? 'View Flashcards' : 'Create Flashcards'}
            </button>
            
            <button
              onClick={() => {
                const fullContent = sections.map(s => s.content).join('\n\n')
                if (linkedTestSetId) {
                  window.location.href = `/study/sets/${linkedTestSetId}/test`
                } else {
                  onCreateTest?.(fullContent)
                }
              }}
              className={`px-3 py-1 ${linkedTestSetId ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-orange-600 hover:bg-orange-500'} text-white rounded text-sm flex items-center gap-2`}
            >
              📝 {linkedTestSetId ? 'View Test' : 'Create Test'}
            </button>
            
            <button
              onClick={() => {
                const fullContent = sections.map(s => s.content).join('\n\n')
                if (linkedMatchSetId) {
                  window.location.href = `/study/sets/${linkedMatchSetId}/match`
                } else {
                  onCreateMatch?.(fullContent)
                }
              }}
              className={`px-3 py-1 ${linkedMatchSetId ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-green-600 hover:bg-green-500'} text-white rounded text-sm flex items-center gap-2`}
            >
              🧩 {linkedMatchSetId ? 'View Match Game' : 'Create Match Game'}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md flex items-center gap-3">
          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search sections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm"
          />
        </div>

        {/* Filter bar */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            {(['all','completed','remaining','bookmarked'] as const).map(f => {
              const count = f==='all' ? sections.length : filteredCountFor(f)
              return (
                <button
                  key={f}
                  aria-pressed={statusFilter===f}
                  onClick={()=> setStatusFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs border transition flex items-center gap-1 ${statusFilter===f ? 'bg-blue-700 border-blue-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
                >
                  <span className="capitalize">{f}</span>
                  <span className="px-1.5 rounded bg-slate-700 text-slate-200 text-[10px]">{count}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1">
            {(['overview','concepts','details','questions','summary'] as const).map(t => (
              <button
                key={t}
                aria-pressed={typeFilters.has(t)}
                onClick={()=>toggleType(t)}
                className={`px-2 py-1 rounded-full text-[11px] border transition ${typeFilters.has(t) ? 'bg-emerald-700 border-emerald-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
              >{t}</button>
            ))}
            {typeFilters.size>0 && (
              <button
                onClick={()=>setTypeFilters(new Set())}
                className="px-2 py-1 rounded-full text-[11px] border border-slate-600 text-slate-300 hover:bg-slate-700"
              >Clear types</button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {(['beginner','intermediate','advanced'] as const).map(d => (
              <button
                key={d}
                aria-pressed={difficultyFilters.has(d)}
                onClick={()=>toggleDifficulty(d)}
                className={`px-2 py-1 rounded-full text-[11px] border transition ${difficultyFilters.has(d) ? (d==='advanced' ? 'bg-red-700 border-red-600 text-white' : d==='beginner' ? 'bg-green-700 border-green-600 text-white' : 'bg-yellow-700 border-yellow-600 text-white') : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
              >{d}</button>
            ))}
            {difficultyFilters.size>0 && (
              <button
                onClick={()=>setDifficultyFilters(new Set())}
                className="px-2 py-1 rounded-full text-[11px] border border-slate-600 text-slate-300 hover:bg-slate-700"
              >Clear difficulty</button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Table of Contents */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BookOpen size={18} />
              Contents
            </h3>
            <nav className="space-y-2">
              {fullyFilteredSections.map((section) => {
                const isCompleted = progress?.sectionsCompleted?.includes(section.id)
                const isExpanded = expandedSections.has(section.id)
                
                return (
                  <button
                    key={section.id}
                    onClick={() => toggleSection(section.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isExpanded
                        ? 'bg-blue-900/30 border-blue-800 text-blue-300'
                        : 'bg-slate-900/30 border-slate-800 text-slate-400 hover:bg-slate-800/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isCompleted && <CheckCircle size={14} className="text-green-400" />}
                        {progress?.bookmarks?.includes(section.id) && <Star size={14} className="text-amber-400" />}
                        <span className="text-sm font-medium truncate">{section.title}</span>
                      </div>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      <span className="capitalize">{section.type}</span>
                      {section.estimatedTime && (
                        <>
                          <span>•</span>
                          <span>{section.estimatedTime}min</span>
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
            </nav>
          </div>
        </div>

        {/* Study Content */}
        <div className="lg:col-span-3">
          <div className="space-y-6">
            {filteredSections.map((section) => {
              const isExpanded = expandedSections.has(section.id)
              const isCompleted = progress?.sectionsCompleted?.includes(section.id)
              const { diagram, type: diagramType, loading: diagramLoading } = getDiag(section.id)
              return (
                <div
                  key={section.id}
                  className={`rounded-xl border transition-all ${
                    isExpanded 
                      ? 'border-blue-700 bg-slate-900/50' 
                      : 'border-slate-800 bg-slate-900/30'
                  }`}
                >
                  {/* Section Header */}
                  <div
                    className="p-4 cursor-pointer"
                    onClick={() => toggleSection(section.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          section.type === 'overview' ? 'bg-blue-900/50 text-blue-300' :
                          section.type === 'concepts' ? 'bg-emerald-900/50 text-emerald-300' :
                          section.type === 'details' ? 'bg-amber-900/50 text-amber-300' :
                          section.type === 'questions' ? 'bg-purple-900/50 text-purple-300' :
                          section.type === 'summary' ? 'bg-rose-900/50 text-rose-300' :
                          'bg-slate-800 text-slate-300'
                        }`}>
                          <BookOpen size={16} />
                        </div>
                        <div>
                          <h4 className="text-lg font-semibold text-slate-200">
                            {section.title}
                          </h4>
                          <div className="flex items-center gap-2 mt-1 text-sm text-slate-400">
                            <span className="capitalize">{section.type}</span>
                            {section.estimatedTime && (
                              <>
                                <span>•</span>
                                <Clock size={12} />
                                <span>{section.estimatedTime}min</span>
                              </>
                            )}
                            {section.difficulty && (
                              <>
                                <span>•</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize tracking-wide border ${section.difficulty==='advanced' ? 'bg-red-900/40 border-red-700 text-red-300' : section.difficulty==='beginner' ? 'bg-green-900/40 border-green-700 text-green-300' : 'bg-yellow-900/40 border-yellow-700 text-yellow-300'}`}>{section.difficulty}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isCompleted && (
                          <CheckCircle size={20} className="text-green-400" />
                        )}
                        {progress?.bookmarks && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onBookmark?.(section.id) }}
                            className={`p-1 rounded border text-xs ${progress.bookmarks.includes(section.id) ? 'border-amber-400 text-amber-300 bg-amber-900/30' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                            title={progress.bookmarks.includes(section.id) ? 'Remove bookmark' : 'Bookmark section'}
                          >
                            {progress.bookmarks.includes(section.id) ? '★' : '☆'}
                          </button>
                        )}
                        {isExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                      </div>
                    </div>
                  </div>

                  {/* Section Content */}
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      {/* Section Actions */}
                      <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-slate-800">
                        {!isCompleted && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onSectionComplete?.(section.id)
                            }}
                            className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-sm flex items-center gap-2"
                          >
                            <CheckCircle size={14} />
                            Mark Complete
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onCreateFlashcards?.(section.content, section.id) }}
                          className="px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded text-sm"
                          title="Create flashcards for this section"
                        >🃏 Section Cards</button>
                        {progress?.bookmarks && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onBookmark?.(section.id) }}
                            className={`px-3 py-1 ${progress.bookmarks.includes(section.id) ? 'bg-amber-600 hover:bg-amber-500' : 'bg-slate-700 hover:bg-slate-600'} text-white rounded text-sm flex items-center gap-2`}
                          >
                            <Star size={14} /> {progress.bookmarks.includes(section.id) ? 'Bookmarked' : 'Bookmark'}
                          </button>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-slate-400">Diagram:</span>
                          {(['flowchart','sequence','class','er','state'] as const).map(t => (
                            <button
                              key={t}
                              onClick={async (e) => {
                                e.stopPropagation()
                                // simple throttle: ignore rapid repeated requests within 600ms
                                const now = Date.now()
                                const lastKey = '__lastGen_' + section.id
                                const last = (window as any)[lastKey] || 0
                                if (now - last < 600) return
                                ;(window as any)[lastKey] = now
                                setDiagLoading(section.id, true)
                                try {
                                  const { mermaid, type } = await generateDiagram({ text: section.content, type: t })
                                  setDiagData(section.id, mermaid, type as any)
                                } catch (err) { console.error('diagram failed', err) }
                                finally { setDiagLoading(section.id, false) }
                              }}
                              className={`px-2 py-1 rounded text-xs border ${diagramType===t ? 'bg-blue-700 border-blue-600 text-white' : 'border-slate-700 hover:bg-slate-800 text-slate-300'}`}
                            >{t}</button>
                          ))}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (!diagram) return
                              try { await onInsertDiagram?.(section.id, diagram) } catch (err) { console.error('insert diagram failed', err) }
                            }}
                            disabled={!diagram}
                            className={`px-2 py-1 rounded text-xs border ${diagram ? 'border-emerald-600 text-emerald-300 hover:bg-emerald-900/30' : 'border-slate-800 text-slate-500 cursor-not-allowed'}`}
                          >Insert</button>
                        </div>
                      </div>

                      {/* Main Content */}
                      <div className="prose prose-invert max-w-none">
                        <Markdown content={section.content} />
                      </div>

                      {/* Diagram Preview */}
                      {(diagramLoading || diagram) && (
                        <div className="mt-4 p-3 rounded-lg border border-slate-800 bg-slate-900/40">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm text-slate-300">Generated {diagramType || 'diagram'}</div>
                            <div className="text-xs text-slate-400">
                              {diagramLoading ? 'Generating…' : (diagram ? 'Ready' : '')}
                            </div>
                          </div>
                          {diagram ? (
                            <React.Suspense fallback={<div className="text-slate-500 text-xs">Loading diagram renderer…</div>}>
                              <Mermaid chart={diagram} />
                            </React.Suspense>
                          ) : (
                            <div className="text-slate-400 text-sm">Generating…</div>
                          )}
                          {diagram && (
                            <div className="mt-2">
                              <button
                                className="px-2 py-1 text-xs border border-slate-700 hover:bg-slate-800 rounded text-slate-300"
                                onClick={async ()=>{ try { await navigator.clipboard.writeText('```mermaid\n' + diagram + '\n```') } catch {} }}
                              >Copy mermaid code</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            
            {fullyFilteredSections.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <BookOpen size={48} className="mx-auto mb-4 opacity-50" />
                <p>No sections match your search.</p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-blue-400 hover:text-blue-300 underline"
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}