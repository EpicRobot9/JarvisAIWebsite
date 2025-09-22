export type NotesCommand =
  | { type: 'notes_start' }
  | { type: 'notes_pause' }
  | { type: 'notes_resume' }
  | { type: 'notes_stop' }
  | { type: 'notes_show' }
  | { type: 'notes_hide' }

// Normalize user text for matching
function norm(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Detects notes-related commands like "start notes", "pause notes", "stop notes", etc. */

export function parseNotesCommand(input: string): NotesCommand | null {
  const t = norm(input)
  if (!t) return null

  // Helper to check any phrase exists as a whole or close phrase, allowing optional prefix words
  const has = (phrases: string[]) => phrases.some(p => new RegExp(`(?:^|\b|[a-z]+,? )${p}(?:\b|$)`).test(t))

  // Variants for start
  if (has([
    'start notes', 'start taking notes', 'begin notes', 'begin taking notes', 'take notes', 'take some notes',
    'open notes', 'show notes', 'start note taking', 'start recording notes', 'start the notes', 'start my notes'
  ])) return { type: 'notes_start' }

  // Pause/resume
  if (has(['pause notes', 'pause the notes', 'hold notes', 'hold my notes'])) return { type: 'notes_pause' }
  if (has(['resume notes', 'continue notes', 'unpause notes', 'resume taking notes'])) return { type: 'notes_resume' }

  // Stop/close (treat "stop the recording" as stop notes when notes are active; actual decision made by caller)
  if (has([
    'stop notes', 'stop taking notes', 'end notes', 'finish notes', 'close notes', 'hide notes', 'stop the notes',
    'stop the recording', 'stop recording notes'
  ])) return { type: 'notes_stop' }

  // Explicit show/hide
  if (has(['show transcript', 'show the transcript', 'show notes'])) return { type: 'notes_show' }
  if (has(['hide transcript', 'close transcript', 'close the transcript', 'hide notes'])) return { type: 'notes_hide' }

  return null
}
