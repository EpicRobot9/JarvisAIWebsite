import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listNotes, listStudySets, generateStudySet, type StudySet, type NoteItem, type StudyToolsRequested } from '../lib/api'
import { STUDY_GUIDE_PRESETS, applyPreset } from '../lib/studyGuidePresets'

export default function StudyDashboard() {
  const navigate = useNavigate()
  const [sets, setSets] = useState<StudySet[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<NoteItem[]>([])

  // Inline create form state
  const [subject, setSubject] = useState('')
  const [info, setInfo] = useState('')
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([])
  const [tools, setTools] = useState<StudyToolsRequested>(['guide','flashcards'])
  const [creating, setCreating] = useState(false)
  
  // Study guide customization options
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [studyDuration, setStudyDuration] = useState(30)
  const [targetDifficulty, setTargetDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate')
  const [studyStyle, setStudyStyle] = useState<'comprehensive' | 'outline' | 'visual' | 'interactive'>('comprehensive')
  const [includeExamples, setIncludeExamples] = useState(true)
  const [includePracticeQuestions, setIncludePracticeQuestions] = useState(true)
  const [includeKeyTerms, setIncludeKeyTerms] = useState(true)
  const [includeSummary, setIncludeSummary] = useState(true)
  // Flashcard customization
  const [flashcardCount, setFlashcardCount] = useState<number | null>(null) // null means "let AI decide"

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const r = await listStudySets({ take: 200 })
        if (mounted) setSets(r.items)
        const notesRes = await listNotes({ take: 100 })
        if (mounted) setNotes(notesRes.items)
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load sets')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  const totals = useMemo(() => {
    const totalSets = sets.length
    const totalCards = sets.reduce((sum, s) => sum + (s.content?.flashcards?.length || 0), 0)
    const totalGuides = sets.reduce((sum, s) => sum + (s.content?.guide ? 1 : 0), 0)
    // Placeholder average score (requires tracking gameplay); keep 0 for now
    const avgScore = 0
    return { totalSets, totalCards, totalGuides, avgScore }
  }, [sets])

  const flashcardSets = useMemo(() => sets.filter(s => (s.content?.flashcards?.length || 0) > 0), [sets])
  const guideSets = useMemo(() => sets.filter(s => !!s.content?.guide), [sets])
  const testSets = useMemo(() => sets.filter(s => (s.content?.test?.length || 0) > 0), [sets])
  const matchSets = useMemo(() => sets.filter(s => (s.content?.match?.length || 0) > 0), [sets])

  function toggleTool(t: 'guide'|'flashcards'|'test'|'match') {
    setTools(prev => prev.includes(t) ? (prev.filter(x => x !== t) as StudyToolsRequested) : ([...prev, t] as StudyToolsRequested))
  }

  const canCreate = (subject.trim() || info.trim() || selectedNoteIds.length > 0) && tools.length > 0 && !creating

  async function createSetInline() {
    if (!canCreate) return
    setCreating(true)
    setError(null)
    try {
      // Build enhanced info with customization
      let enhancedInfo = info.trim()
      
      if (tools.includes('guide')) {
        const guideInstructions = []
        guideInstructions.push(`Target study duration: ${studyDuration} minutes`)
        guideInstructions.push(`Difficulty level: ${targetDifficulty}`)
        guideInstructions.push(`Study style: ${studyStyle}`)
        
        if (includeExamples) guideInstructions.push('Include practical examples and real-world applications')
        if (includePracticeQuestions) guideInstructions.push('Include practice questions and self-assessment')
        if (includeKeyTerms) guideInstructions.push('Highlight key terms and definitions')
        if (includeSummary) guideInstructions.push('Provide a comprehensive summary section')
        
        if (guideInstructions.length > 0) {
          enhancedInfo += `\n\n### Study Guide Requirements:\n${guideInstructions.map(inst => `- ${inst}`).join('\n')}`
        }
      }
      
      if (tools.includes('flashcards') && flashcardCount !== null) {
        enhancedInfo += `\n\n### Flashcard Requirements:\n- Generate exactly ${flashcardCount} flashcards`
      }
      
      const set = await generateStudySet({ 
        subject: subject.trim() || undefined, 
        info: enhancedInfo || undefined, 
        noteIds: selectedNoteIds, 
        tools 
      })
      // Refresh and navigate
      setSubject(''); setInfo(''); setSelectedNoteIds([])
      const r = await listStudySets({ take: 200 })
      setSets(r.items)
      navigate(`/study/sets/${set.id}`)
    } catch (e:any) {
      setError(e?.message || 'Failed to create set')
    } finally { setCreating(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to="/" className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Home</Link>
        <div className="font-medium">Study Dashboard</div>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/study#create" className="jarvis-btn jarvis-btn-primary">Create New Set</Link>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Flash Card Sets" value={String(totals.totalSets)} />
          <StatCard label="Total Flash Cards" value={String(totals.totalCards)} />
          <StatCard label="Study Guides" value={String(totals.totalGuides)} />
        </div>

        {/* Create new set inline */}
        <div id="create" className="mt-8 rounded-xl border border-white/10 bg-slate-900/60 p-5">
          <div className="text-lg font-semibold mb-2">Create Study Content</div>
          <div className="text-slate-400 text-sm mb-4">Generate guides, flashcards, tests, and matches together or individually.</div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Subject / Topic</label>
                <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="e.g., The American Revolution" className="w-full text-sm bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Info about the topic</label>
                <textarea value={info} onChange={e=>setInfo(e.target.value)} placeholder="Paste notes or describe what to study" className="w-full h-28 text-sm bg-slate-900/60 border border-slate-800 rounded px-3 py-2 outline-none focus:border-slate-700" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">Choose study tools</label>
                <div className="flex flex-wrap gap-2">
                  {(['guide','flashcards','test','match'] as const).map(t => (
                    <button key={t} onClick={()=>toggleTool(t)} className={`px-3 py-2 rounded-md border ${tools.includes(t) ? 'bg-emerald-600 border-emerald-500' : 'border-slate-700 hover:bg-slate-800'} text-sm capitalize`}>{t}</button>
                  ))}
                </div>
                <div className="text-xs text-slate-400 mt-1">Select one or multiple tools. We'll generate all selected.</div>
              </div>
              
              {/* Advanced Study Guide Options */}
              {tools.includes('guide') && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <button 
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300"
                    >
                      <span>{showAdvanced ? '▼' : '▶'}</span>
                      Study Guide Options
                    </button>
                    <div className="text-xs text-slate-400">
                      {studyDuration}min • {targetDifficulty}
                    </div>
                  </div>
                  
                  {/* Quick Presets */}
                  {!showAdvanced && (
                    <div className="grid grid-cols-3 gap-1 mb-2">
                      {STUDY_GUIDE_PRESETS.slice(0, 3).map(preset => (
                        <button
                          key={preset.name}
                          onClick={() => {
                            const config = applyPreset(preset)
                            setStudyDuration(config.studyDuration)
                            setTargetDifficulty(config.targetDifficulty)
                            setStudyStyle(config.studyStyle)
                            setIncludeExamples(config.includeExamples)
                            setIncludePracticeQuestions(config.includePracticeQuestions)
                            setIncludeKeyTerms(config.includeKeyTerms)
                            setIncludeSummary(config.includeSummary)
                          }}
                          className="p-1 bg-slate-900/60 hover:bg-slate-800 border border-slate-700 rounded text-xs text-center"
                          title={preset.description}
                        >
                          <div>{preset.icon}</div>
                          <div className="text-slate-300">{preset.name}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {showAdvanced && (
                    <div className="p-3 bg-slate-950/40 border border-slate-800 rounded space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-300 mb-1">Duration</label>
                          <div className="flex items-center gap-2">
                            <input 
                              type="range" 
                              min="10" 
                              max="120" 
                              step="5"
                              value={studyDuration} 
                              onChange={e => setStudyDuration(Number(e.target.value))}
                              className="flex-1"
                            />
                            <span className="text-xs text-slate-400 w-12">{studyDuration}m</span>
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-xs text-slate-300 mb-1">Difficulty</label>
                          <select 
                            value={targetDifficulty} 
                            onChange={e => setTargetDifficulty(e.target.value as any)}
                            className="w-full bg-slate-900/60 border border-slate-800 rounded px-2 py-1 text-xs"
                          >
                            <option value="beginner">🌱 Beginner</option>
                            <option value="intermediate">⚡ Intermediate</option>
                            <option value="advanced">🔥 Advanced</option>
                          </select>
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-xs text-slate-300 mb-2">Style</label>
                        <div className="grid grid-cols-2 gap-1">
                          {[
                            { value: 'comprehensive', label: '📖 Comprehensive' },
                            { value: 'outline', label: '📝 Outline' },
                            { value: 'visual', label: '🎨 Visual' },
                            { value: 'interactive', label: '🎯 Interactive' }
                          ].map(style => (
                            <button
                              key={style.value}
                              onClick={() => setStudyStyle(style.value as any)}
                              className={`px-2 py-1 rounded text-xs ${
                                studyStyle === style.value 
                                  ? 'bg-blue-600 text-white' 
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {style.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-xs text-slate-300 mb-2">Include</label>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {[
                            { label: '💡 Examples', state: includeExamples, setter: setIncludeExamples },
                            { label: '❓ Questions', state: includePracticeQuestions, setter: setIncludePracticeQuestions },
                            { label: '📚 Key Terms', state: includeKeyTerms, setter: setIncludeKeyTerms },
                            { label: '📋 Summary', state: includeSummary, setter: setIncludeSummary }
                          ].map((option, i) => (
                            <label key={i} className="flex items-center gap-1 text-slate-300">
                              <input 
                                type="checkbox" 
                                checked={option.state} 
                                onChange={e => option.setter(e.target.checked)}
                                className="rounded"
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Flashcard Options */}
              {tools.includes('flashcards') && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-blue-400">🃏 Flashcard Options</span>
                    <span className="text-xs text-slate-400">
                      {flashcardCount ? `${flashcardCount} cards` : 'AI decides'}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-950/40 border border-slate-800 rounded">
                    <div>
                      <label className="block text-xs text-slate-300 mb-1">Number of Cards</label>
                      <select 
                        value={flashcardCount || ''} 
                        onChange={e => setFlashcardCount(e.target.value ? Number(e.target.value) : null)}
                        className="w-full bg-slate-900/60 border border-slate-800 rounded px-2 py-1 text-xs"
                      >
                        <option value="">Let AI decide (12-30 cards)</option>
                        <option value="12">12 cards</option>
                        <option value="15">15 cards</option>
                        <option value="20">20 cards</option>
                        <option value="25">25 cards</option>
                        <option value="30">30 cards</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
              
              <div>
                <button onClick={createSetInline} disabled={!canCreate} className={`px-4 py-2 rounded-md ${canCreate ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}>{creating ? 'Generating…' : 'Generate'}</button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-slate-300">Link your notes</label>
                <Link to="/notes" className="text-xs text-slate-400 underline">Open Notes</Link>
              </div>
              <div className="max-h-48 overflow-auto pr-1 space-y-2">
                {notes.map(n => (
                  <label key={n.id} className="flex items-start gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={selectedNoteIds.includes(n.id)} onChange={e => setSelectedNoteIds(prev => e.target.checked ? [...prev, n.id] : prev.filter(x => x !== n.id))} />
                    <div>
                      <div className="font-medium truncate max-w-[16rem]" title={n.title || undefined}>{n.title || new Date(n.createdAt).toLocaleString()}</div>
                      <div className="text-xs text-slate-400 line-clamp-2">{n.transcript}</div>
                    </div>
                  </label>
                ))}
                {notes.length === 0 && <div className="text-xs text-slate-500">No notes yet.</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
            <div className="text-lg font-semibold mb-2">Flash Cards</div>
            <div className="text-slate-400 text-sm mb-4">Create and study with AI-generated flash cards</div>
            <div className="flex gap-2">
              <button onClick={() => {
                const flashcardsSection = document.getElementById('flashcards')
                if (flashcardsSection) {
                  flashcardsSection.scrollIntoView({ behavior: 'smooth' })
                }
              }} className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm">View Flash Cards</button>
              <Link to="/study/create/flashcards" className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm">Create New Set</Link>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
            <div className="text-lg font-semibold mb-2">Study Guides</div>
            <div className="text-slate-400 text-sm mb-4">Generate comprehensive study guides from your content</div>
            <div className="flex gap-2">
              <button onClick={() => {
                const guidesSection = document.getElementById('guides')
                if (guidesSection) {
                  guidesSection.scrollIntoView({ behavior: 'smooth' })
                }
              }} className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm">View Study Guides</button>
              <button onClick={() => {
                const createSection = document.getElementById('create')
                if (createSection) {
                  createSection.scrollIntoView({ behavior: 'smooth' })
                }
              }} className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm">Create New Guide</button>
            </div>
          </div>
        </div>

        {/* Lists */}
        <div id="flashcards" className="mt-10">
          <div className="text-slate-300 font-semibold mb-3">My Flash Card Sets</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flashcardSets.map(s => (
              <div key={s.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                <div className="font-medium mb-1 truncate" title={s.title}>{s.title}</div>
                <div className="text-xs text-slate-400 mb-2">{new Date(s.createdAt).toLocaleString()}</div>
                <div className="text-xs text-slate-400 mb-4">{s.content?.flashcards?.length || 0} cards</div>
                <div className="flex gap-2">
                  <Link to={`/study/sets/${s.id}/study`} className="px-3 py-2 rounded-md bg-pink-600 hover:bg-pink-500 text-white text-sm">Study</Link>
                  <Link to={`/study/sets/${s.id}/flashcards`} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">View Cards</Link>
                </div>
              </div>
            ))}
            {flashcardSets.length === 0 && (
              <div className="text-sm text-slate-500">No flash card sets yet. Create your first one.</div>
            )}
          </div>
        </div>

        <div id="guides" className="mt-10">
          <div className="text-slate-300 font-semibold mb-3">My Study Guides</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {guideSets.map(s => (
              <div key={s.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                <div className="font-medium mb-1 truncate" title={s.title}>{s.title}</div>
                <div className="text-xs text-slate-400 mb-2">{new Date(s.createdAt).toLocaleString()}</div>
                <div className="flex gap-2">
                  <Link to={`/study/sets/${s.id}`} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Open</Link>
                </div>
              </div>
            ))}
            {guideSets.length === 0 && (
              <div className="text-sm text-slate-500">No study guides yet.</div>
            )}
          </div>
        </div>

        <div id="tests" className="mt-10">
          <div className="text-slate-300 font-semibold mb-3">Practice Tests</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {testSets.map(s => (
              <div key={s.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                <div className="font-medium mb-1 truncate" title={s.title}>{s.title}</div>
                <div className="text-xs text-slate-400 mb-2">{new Date(s.createdAt).toLocaleString()}</div>
                <div className="flex gap-2">
                  <Link to={`/study/sets/${s.id}/test`} className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm">Take Test</Link>
                  <Link to={`/study/sets/${s.id}`} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Open</Link>
                </div>
              </div>
            ))}
            {testSets.length === 0 && (
              <div className="text-sm text-slate-500">No tests yet.</div>
            )}
          </div>
        </div>

        <div id="matches" className="mt-10">
          <div className="text-slate-300 font-semibold mb-3">Match Games</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {matchSets.map(s => (
              <div key={s.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                <div className="font-medium mb-1 truncate" title={s.title}>{s.title}</div>
                <div className="text-xs text-slate-400 mb-2">{new Date(s.createdAt).toLocaleString()}</div>
                <div className="flex gap-2">
                  <Link to={`/study/sets/${s.id}/match`} className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm">Play Match</Link>
                  <Link to={`/study/sets/${s.id}`} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Open</Link>
                </div>
              </div>
            ))}
            {matchSets.length === 0 && (
              <div className="text-sm text-slate-500">No match games yet.</div>
            )}
          </div>
        </div>

        <div className="mt-12">
          <div className="text-slate-300 font-semibold mb-2">Recent Activity</div>
          <div className="text-sm text-slate-500">No recent activity: Start creating flash cards or study guides!</div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
      <div className="text-slate-300 text-sm">{label}</div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
    </div>
  )
}
