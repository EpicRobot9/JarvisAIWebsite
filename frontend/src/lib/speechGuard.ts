/** Simple de-dup guard to prevent speaking the same text twice in quick succession. */
function normalize(text: string): string {
  try {
    let t = (text || '').toString().toLowerCase()
    // Strip common markdown and code artifacts
    t = t
      .replace(/```[\s\S]*?```/g, ' ') // fenced code
      .replace(/`[^`]*`/g, ' ') // inline code
      .replace(/[*_~#>\[\]()]/g, ' ') // md punctuation noise
    // Remove most punctuation except sentence spacing
    t = t.replace(/[^a-z0-9\s]/g, ' ')
    // Collapse whitespace
    t = t.replace(/\s+/g, ' ').trim()
    // Cap length to keep key small
    if (t.length > 600) t = t.slice(0, 600)
    return t
  } catch {
    return text || ''
  }
}

const recent = new Map<string, number>()
let lastPrune = 0
let suppressUntil = 0

function prune(now: number, windowMs: number) {
  if (now - lastPrune < windowMs) return
  for (const [k, t] of recent) {
    if (now - t > windowMs) recent.delete(k)
  }
  lastPrune = now
}

/**
 * Returns true if speaking should proceed; false if it should be suppressed as a recent duplicate.
 * Records the text as "spoken" when returning true.
 */
export function shouldSpeak(text: string, opts?: { windowMs?: number }): boolean {
  const windowMs = Math.max(500, Math.min(10000, opts?.windowMs ?? 5000))
  const now = Date.now()
  if (now < suppressUntil) return false
  const key = normalize(text)
  if (!key) return true
  prune(now, windowMs)
  const last = recent.get(key) || 0
  if (now - last < windowMs) return false
  recent.set(key, now)
  return true
}

/** Temporarily suppress speaking of any text for a short window (e.g., to avoid event echo). */
export function suppressSpeakingFor(ms: number) {
  const now = Date.now()
  suppressUntil = Math.max(suppressUntil, now + Math.max(100, Math.min(10000, ms)))
}

/** True if speaking should be suppressed right now (time-based). */
export function isSpeakSuppressed(): boolean { return Date.now() < suppressUntil }

