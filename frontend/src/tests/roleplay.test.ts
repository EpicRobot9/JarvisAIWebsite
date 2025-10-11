import { describe, it, expect, vi } from 'vitest'
import { listRoleplayScenarios, roleplayNext } from '../lib/api'

// Minimal tests to ensure API helper shapes & error handling work

describe('roleplay api helpers', () => {
  it('listRoleplayScenarios handles network offline', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async () => { throw new DOMException('offline', 'NetworkError') }) as any
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true })
    await expect(listRoleplayScenarios()).rejects.toMatchObject({ kind: 'network_offline' })
    globalThis.fetch = original as any
  })

  it('roleplayNext builds request and parses json', async () => {
    const originalFetch = globalThis.fetch
    const originalLS = (globalThis as any).localStorage
    const originalOnline = (globalThis.navigator as any).onLine
    ;(globalThis as any).localStorage = {
      getItem: () => '', setItem: () => {}, removeItem: () => {}
    }
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ reply: 'ok' }), { status: 200 })) as any
    const res = await roleplayNext({ scenarioId: 'x', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.reply).toBe('ok')
    globalThis.fetch = originalFetch as any
    ;(globalThis as any).localStorage = originalLS
    Object.defineProperty(globalThis.navigator, 'onLine', { value: originalOnline, configurable: true })
  })
})
