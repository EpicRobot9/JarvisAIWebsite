import { describe, it, expect, vi } from 'vitest'
import { drawStrokePath } from '../pages/BoardView'

describe('drawStrokePath', () => {
  function makeCtx() {
    const calls: any[] = []
    const ctx: any = {
      lineCap: 'butt',
      lineJoin: 'miter',
      lineWidth: 1,
      strokeStyle: '#000',
      globalCompositeOperation: 'source-over',
      beginPath: () => { calls.push(['beginPath']) },
      moveTo: (x:number, y:number) => { calls.push(['moveTo', x, y]) },
      lineTo: (x:number, y:number) => { calls.push(['lineTo', x, y]) },
      stroke: () => { calls.push(['stroke']) },
      clearRect: vi.fn(),
    }
    return { ctx: ctx as CanvasRenderingContext2D, calls }
  }

  it('does nothing for empty points', () => {
    const { ctx, calls } = makeCtx()
    drawStrokePath(ctx, { points: [], color: '#f00', size: 4, tool: 'pen' })
    expect(calls.length).toBe(0)
  })

  it('draws a continuous path with pen', () => {
    const { ctx, calls } = makeCtx()
    drawStrokePath(ctx, { points: [{x:1,y:2},{x:2,y:3},{x:5,y:8}], color: '#0f0', size: 3, tool: 'pen' })
    expect(calls[0][0]).toBe('beginPath')
    expect(calls[1]).toEqual(['moveTo', 1, 2])
    expect(calls[2]).toEqual(['lineTo', 2, 3])
    expect(calls[3]).toEqual(['lineTo', 5, 8])
    expect(calls[calls.length-1][0]).toBe('stroke')
  })

  it('uses destination-out for eraser', () => {
    const { ctx } = makeCtx()
    drawStrokePath(ctx, { points: [{x:0,y:0},{x:1,y:1}], color: '#000', size: 2, tool: 'eraser' })
    expect((ctx as any).globalCompositeOperation).toBe('source-over')
  })
})
