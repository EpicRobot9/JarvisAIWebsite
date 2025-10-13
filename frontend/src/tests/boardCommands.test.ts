import { describe, it, expect } from 'vitest'
import { parseBoardCommand } from '../lib/commands'

describe('parseBoardCommand', () => {
  it('parses create note with text', () => {
    expect(parseBoardCommand('create note project kickoff')).toEqual({ type: 'create_note', text: 'project kickoff' })
  })
  it('parses suggest links', () => {
    expect(parseBoardCommand('suggest links')).toEqual({ type: 'suggest_links' })
  })
  it('parses cluster', () => {
    expect(parseBoardCommand('cluster the items')).toEqual({ type: 'cluster' })
  })
  it('parses summarize selection', () => {
    expect(parseBoardCommand('summarize selection')).toEqual({ type: 'summarize_selection' })
  })
  it('returns null for unrelated text', () => {
    expect(parseBoardCommand('what time is it')).toBeNull()
  })
})
