import { describe, it, expect } from 'vitest'
import { parseNotesCommand } from '../lib/commands'

describe('parseNotesCommand', () => {
  it('detects start variants', () => {
    expect(parseNotesCommand('start notes')).toEqual({ type: 'notes_start' })
    expect(parseNotesCommand('please start taking notes')).toEqual({ type: 'notes_start' })
    expect(parseNotesCommand('Jarvis, take some notes')).toEqual({ type: 'notes_start' })
  })
  it('detects pause/resume', () => {
    expect(parseNotesCommand('pause the notes')).toEqual({ type: 'notes_pause' })
    expect(parseNotesCommand('resume notes')).toEqual({ type: 'notes_resume' })
  })
  it('detects stop', () => {
    expect(parseNotesCommand('stop taking notes')).toEqual({ type: 'notes_stop' })
    expect(parseNotesCommand('stop the recording')).toEqual({ type: 'notes_stop' })
  })
  it('returns null for normal phrases', () => {
    expect(parseNotesCommand('what is the weather')).toBeNull()
  })
})
