import { summarizeTranscript, type NotesPrefs } from './api'

// Heuristic chunker: split on paragraphs and keep chunks under ~2.5k chars by default
export async function summarizeChunked(
  text: string,
  prefs?: Partial<NotesPrefs>,
  opts: { maxChunkChars?: number; overlapChars?: number; mergePrompt?: string; onProgress?: (e: { phase: 'chunk' | 'merge' | 'done'; index?: number; total?: number }) => void } = {}
): Promise<string> {
  const maxChunkChars = opts.maxChunkChars ?? 2500
  const overlapChars = opts.overlapChars ?? 200
  const paragraphs = (text || '').split(/\n{2,}/g).map(s => s.trim()).filter(Boolean)
  const chunks: string[] = []
  let buf = ''
  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length > maxChunkChars) {
      if (buf) chunks.push(buf)
      buf = p
    } else {
      buf = buf ? (buf + '\n\n' + p) : p
    }
  }
  if (buf) chunks.push(buf)
  if (chunks.length === 0) chunks.push(text)

  const results: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    opts.onProgress?.({ phase: 'chunk', index: i + 1, total: chunks.length })
    // Add small overlap context for continuity
    const prevTail = i > 0 ? chunks[i-1].slice(-overlapChars) : ''
    const nextHead = i < chunks.length-1 ? chunks[i+1].slice(0, overlapChars) : ''
    const withContext = [prevTail, chunks[i], nextHead].filter(Boolean).join('\n\n')
    const { notes } = await summarizeTranscript(withContext, prefs)
    results.push(notes || '')
  }

  // Merge step: combine chunk summaries into a final cohesive outline
  const mergePrompt = opts.mergePrompt ?? 'Merge these chunked summaries into a single cohesive, categorized study outline with clear sections, concise bullets, and no duplication. Preserve key terms.'
  opts.onProgress?.({ phase: 'merge' })
  const combined = results.filter(Boolean).join('\n\n')
  const { notes: merged } = await summarizeTranscript(combined, { ...prefs, categories: true, collapsible: true, instructions: mergePrompt })
  const out = merged || combined
  opts.onProgress?.({ phase: 'done' })
  return out
}
