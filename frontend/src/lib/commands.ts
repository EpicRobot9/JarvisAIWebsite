export type NotesCommand =
  | { type: 'notes_start' }
  | { type: 'notes_pause' }
  | { type: 'notes_resume' }
  | { type: 'notes_stop' }
  | { type: 'notes_show' }
  | { type: 'notes_hide' }

export type VoiceMacroCommand =
  | { type: 'bookmark'; label?: string }
  | { type: 'repeat' }

// Boards voice commands
export type BoardCommand =
  | { type: 'create_note'; text?: string }
  | { type: 'suggest_links' }
  | { type: 'cluster' }
  | { type: 'link_selected' }
  | { type: 'unlink_selected' }
  | { type: 'summarize_selection' }
  | { type: 'diagram_selection' }
  | { type: 'clear_selection' }
  | { type: 'select_all' }
  | { type: 'fit_view' }
  | { type: 'zoom_in' }
  | { type: 'zoom_out' }

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

/** Detects voice macros like "bookmark that" or "repeat last answer". */
export function parseVoiceMacro(input: string): VoiceMacroCommand | null {
  const t = norm(input)
  if (!t) return null

  // Repeat variants
  if (/(^|\b)(repeat( that)?|say it again|one more time|again please)(\b|$)/.test(t)) {
    return { type: 'repeat' }
  }

  // Bookmark with optional label
  // e.g., "bookmark that", "bookmark this as key concept", "save that"
  const bookmarkBare = /(\b)(bookmark that|bookmark this|save that|save this|remember that|remember this)(\b)/
  if (bookmarkBare.test(t)) return { type: 'bookmark' }
  const m = t.match(/\bbookmark (?:that|this)?(?: as)? ([a-z0-9\s]{3,50})$/)
  if (m && m[1]) {
    return { type: 'bookmark', label: m[1].trim() }
  }
  return null
}

/** Detects board commands like "new note", "cluster", "suggest links", etc. */
export function parseBoardCommand(input: string): BoardCommand | null {
  const t = norm(input)
  if (!t) return null

  // Create note with optional content
  // e.g., "create note", "new note", "make a note hello world"
  if (/^(create|make|add) (a )?note( .+)?$/.test(t) || /^(new|another) note( .+)?$/.test(t)) {
    const m = t.match(/^(?:create|make|add|new|another) (?:a )?note(?: (.*))?$/)
    const content = (m && m[1] && m[1].trim()) || undefined
    return { type: 'create_note', text: content }
  }

  // AI actions
  if (/(^|\b)(suggest links|auto link|link suggestions)(\b|$)/.test(t)) return { type: 'suggest_links' }
  if (/(^|\b)(cluster|auto layout|group similar)(\b|$)/.test(t)) return { type: 'cluster' }
  if (/(^|\b)(summarize selection|summary note)(\b|$)/.test(t)) return { type: 'summarize_selection' }
  if (/(^|\b)(diagram selection|make diagram|create diagram)(\b|$)/.test(t)) return { type: 'diagram_selection' }

  // Linking
  if (/(^|\b)(link selected|link selection)(\b|$)/.test(t)) return { type: 'link_selected' }
  if (/(^|\b)(unlink selected|remove link|unlink selection)(\b|$)/.test(t)) return { type: 'unlink_selected' }

  // Selection helpers
  if (/(^|\b)(clear selection|deselect all|clear all)(\b|$)/.test(t)) return { type: 'clear_selection' }
  if (/(^|\b)(select all|highlight all)(\b|$)/.test(t)) return { type: 'select_all' }

  // View helpers
  if (/(^|\b)(fit|fit view|zoom to fit)(\b|$)/.test(t)) return { type: 'fit_view' }
  if (/(^|\b)(zoom in|increase zoom)(\b|$)/.test(t)) return { type: 'zoom_in' }
  if (/(^|\b)(zoom out|decrease zoom)(\b|$)/.test(t)) return { type: 'zoom_out' }

  return null
}
