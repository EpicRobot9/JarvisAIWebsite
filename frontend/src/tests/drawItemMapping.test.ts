import { describe, it, expect } from 'vitest'
import { toBoardStrokes, toLocalStrokes } from '../pages/BoardView'

describe('draw strokes mapping helpers', () => {
  it('maps local -> board and back', () => {
    const local = [{ color: '#000', width: 3, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]
    const origin = { x: 100, y: 50 }
    const board = toBoardStrokes(local as any, origin)
    expect(board[0].points[0]).toEqual({ x: 100, y: 50 })
    expect(board[0].points[1]).toEqual({ x: 110, y: 60 })
    const back = toLocalStrokes(board as any, origin)
    expect(back[0].points[0]).toEqual({ x: 0, y: 0 })
    expect(back[0].points[1]).toEqual({ x: 10, y: 10 })
  })
})
