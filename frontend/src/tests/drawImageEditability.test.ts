import { describe, it, expect } from 'vitest'
import { isDrawableImageContent } from '../pages/BoardView'

describe('isDrawableImageContent', () => {
  it('returns true when vectorStrokes array exists and non-empty', () => {
    expect(isDrawableImageContent({ vectorStrokes: [{ points: [], color: '#000', size: 2, tool: 'pen' }] })).toBe(true)
  })
  it('returns false for missing or empty vectorStrokes', () => {
    expect(isDrawableImageContent({})).toBe(false)
    expect(isDrawableImageContent({ vectorStrokes: [] })).toBe(false)
  })
})
