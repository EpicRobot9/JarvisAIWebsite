import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

export default function QuizSummaryPage() {
  const { roomId } = useParams()
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(()=>{
    let mounted = true
    ;(async()=>{
      try{
        setLoading(true)
        const r = await fetch(`/api/quiz/summary/${encodeURIComponent(roomId||'')}`, { credentials:'include' })
        if (!r.ok) throw new Error('Summary not found')
        const j = await r.json()
        if (!mounted) return
        setSummary(j.summary)
      }catch(e:any){
        if (mounted) setError(e?.message||'Error')
      }finally{ if (mounted) setLoading(false) }
    })()
    return ()=>{ mounted = false }
  }, [roomId])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">Quiz Summary</h1>
          <Link to="/shared" className="jarvis-btn">Back</Link>
        </div>
        {loading && <div>Loading…</div>}
        {error && <div className="text-red-300">{error}</div>}
        {!loading && !error && summary && (
          <div className="rounded-lg bg-slate-900/60 ring-1 ring-white/10 p-3">
            <div className="text-sm text-slate-300 mb-2">Mode: <b className="text-cyan-300">{summary.mode}</b> • Question time: {summary.options?.questionTime}s</div>
            {summary.mode === 'gold' && <div className="text-xs text-amber-300 mb-2">Steal chance: {Math.round((summary.options?.goldStealChance||0)*100)}%</div>}
            {summary.mode === 'royale' && <div className="text-xs text-red-300 mb-2">Lives: {summary.options?.royaleLives}</div>}
            <div className="mb-3">
              <div className="font-semibold mb-1">Final Leaderboard</div>
              <ol className="ml-4 list-decimal text-sm">
                {summary.finalLeaderboard?.map((p:any)=> (
                  <li key={p.id}>
                    {p.name}: <b>{p.score}</b>
                    {summary.mode==='gold' && <span className="text-xs text-amber-300"> • gold: {p.gold}</span>}
                    {summary.mode==='royale' && <span className="text-xs text-red-300"> • lives: {p.lives ?? 0}{p.eliminated? ' (out)':''}</span>}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="font-semibold mb-1">Per-Round Stats</div>
              <div className="space-y-3">
                {summary.rounds?.map((r:any)=> (
                  <div key={r.index} className="rounded bg-slate-800/40 p-2">
                    <div className="text-sm">Q{r.index+1}: {r.question}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1 text-xs">
                      {r.choices?.map((ch:string, i:number)=> (
                        <div key={i} className={`rounded p-2 ${i===r.correctIndex? 'bg-emerald-900/30 text-emerald-300' : 'bg-slate-900/40'}`}>
                          {String.fromCharCode(65+i)}. {ch}
                          <div className="text-[10px] text-slate-400">Votes: {r.counts?.[i] || 0}</div>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(r.steals) && r.steals.length>0 && (
                      <div className="mt-1 text-[11px] text-amber-300">Steals: {r.steals.map((s:any,i:number)=> (<span key={i}>{s.to} +{s.amount} from {s.from}{i<r.steals.length-1?', ':''}</span>))}</div>
                    )}
                    {Array.isArray(r.eliminated) && r.eliminated.length>0 && (
                      <div className="mt-1 text-[11px] text-red-300">Eliminated: {r.eliminated.join(', ')}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
