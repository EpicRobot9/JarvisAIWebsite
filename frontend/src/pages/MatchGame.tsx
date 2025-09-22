import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getStudySet, type MatchPair, type StudySet } from '../lib/api'

type Tile = { id: string; text: string; side: 'left' | 'right'; pairKey: string }

export default function MatchGame() {
  const { id } = useParams()
  const [setData, setSetData] = useState<StudySet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tiles, setTiles] = useState<Tile[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set())
  const [moves, setMoves] = useState(0)
  const [pairsCount, setPairsCount] = useState(0)

  // Check if this match game was created from a study guide
  const linkedStudyGuideId = useMemo(() => {
    try {
      const links = JSON.parse(localStorage.getItem('match-study-links') || '{}')
      return links[id] || null
    } catch {
      return null
    }
  }, [id])

  useEffect(() => {
    let mounted = true
    if (!id) return
    getStudySet(id).then(s => {
      if (!mounted) return
      setSetData(s)
      const pairs: MatchPair[] = s.content?.match || []
      // build tiles: duplicate entries with side flag and same pairKey
      const raw: Tile[] = pairs.flatMap((p, idx) => {
        const key = `p${idx}`
        return [
          { id: `${key}-L`, text: p.left, side: 'left' as const, pairKey: key },
          { id: `${key}-R`, text: p.right, side: 'right' as const, pairKey: key }
        ]
      })
      // simple shuffle
      for (let i = raw.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[raw[i], raw[j]] = [raw[j], raw[i]]
      }
      setTiles(raw)
      setPairsCount(pairs.length)
      setSelectedIds([])
      setMatchedIds(new Set())
      setMoves(0)
    }).catch(e => setError(e?.message || 'Failed to load'))
    return () => { mounted = false }
  }, [id])

  const allMatched = useMemo(() => tiles.length > 0 && matchedIds.size === tiles.length, [tiles, matchedIds])

  function onTileClick(t: Tile) {
    if (matchedIds.has(t.id)) return // already matched
    if (selectedIds.includes(t.id)) return // already selected
    if (selectedIds.length === 0) {
      setSelectedIds([t.id])
      return
    }
    if (selectedIds.length === 1) {
      const firstId = selectedIds[0]
      const first = tiles.find(x => x.id === firstId)
      if (!first) { setSelectedIds([t.id]); return }
      setMoves(m => m + 1)
      // can't match two from same side
      if (first.side === t.side) {
        setSelectedIds([t.id])
        return
      }
      // match if pairKey equal
      if (first.pairKey === t.pairKey) {
        const next = new Set(matchedIds)
        next.add(first.id)
        next.add(t.id)
        setMatchedIds(next)
        setSelectedIds([])
      } else {
        // wrong pair: flash briefly
        setSelectedIds([first.id, t.id])
        setTimeout(() => setSelectedIds([]), 600)
      }
      return
    }
    // more than 1 selected: reset to current
    setSelectedIds([t.id])
  }

  function shuffleTiles() {
    const raw = [...tiles]
    for (let i = raw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[raw[i], raw[j]] = [raw[j], raw[i]]
    }
    setTiles(raw)
    setSelectedIds([])
  }

  function resetGame() {
    const keyToPair: Record<string, { left: string; right: string }> = {}
    tiles.forEach(t => {
      if (!keyToPair[t.pairKey]) keyToPair[t.pairKey] = { left: '', right: '' }
      keyToPair[t.pairKey][t.side] = t.text
    })
    const pairs: MatchPair[] = Object.entries(keyToPair).map(([_, v]) => ({ left: v.left, right: v.right }))
    const raw: Tile[] = pairs.flatMap((p, idx) => {
      const key = `p${idx}`
      return [
        { id: `${key}-L`, text: p.left, side: 'left' as const, pairKey: key },
        { id: `${key}-R`, text: p.right, side: 'right' as const, pairKey: key }
      ]
    })
    // shuffle
    for (let i = raw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[raw[i], raw[j]] = [raw[j], raw[i]]
    }
    setTiles(raw)
    setSelectedIds([])
    setMatchedIds(new Set())
    setMoves(0)
  }

  if (!id) return null

  const pairsFound = Math.floor(matchedIds.size / 2)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <Link to={`/study/sets/${id}`} className="px-3 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Back</Link>
        <div className="font-medium">Match Game</div>
        {linkedStudyGuideId && (
          <Link 
            to={`/study/sets/${linkedStudyGuideId}`} 
            className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm"
            title="View source study guide"
          >
            📚 Study Guide
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2 text-slate-300 text-sm">
          <div>Pairs: <span className="font-semibold">{pairsFound}</span>/<span>{pairsCount}</span></div>
          <div className="ml-3">Moves: <span className="font-semibold">{moves}</span></div>
          <button onClick={shuffleTiles} className="ml-3 px-2 py-1.5 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300">Shuffle</button>
          <button onClick={resetGame} className="px-2 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white">Reset</button>
        </div>
      </div>

      {error && <div className="m-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{error}</div>}

      {tiles.length === 0 ? (
        <div className="p-8 text-slate-400 text-lg">No matching pairs in this set.</div>
      ) : (
        <div className="p-6 max-w-6xl mx-auto">
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {tiles.map(t => {
              const selected = selectedIds.includes(t.id)
              const matched = matchedIds.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => onTileClick(t)}
                  aria-pressed={selected}
                  aria-disabled={matched}
                  disabled={matched}
                  className={[
                    'rounded-2xl border transition shadow-sm',
                    'min-h-[120px] sm:min-h-[140px] lg:min-h-[150px] p-4',
                    'flex items-center justify-center text-center text-base sm:text-lg font-medium',
                    matched ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' :
                    selected ? 'bg-white/95 text-slate-900 border-slate-300' :
                    'bg-slate-900/60 border-slate-800 text-slate-100 hover:bg-slate-800'
                  ].join(' ')}
                >
                  <span className="px-2">{t.text}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {allMatched && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white text-slate-900 p-6 shadow-2xl">
            <div className="text-xl font-semibold mb-2">You matched all pairs!</div>
            <div className="text-sm mb-4">Completed in <b>{moves}</b> moves.</div>
            <div className="mt-2 flex gap-2">
              <button onClick={resetGame} className="px-4 py-2.5 rounded-md bg-slate-900 text-white">Play Again</button>
              <Link to={`/study/sets/${id}`} className="px-4 py-2.5 rounded-md border border-slate-300">Back to Set</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
