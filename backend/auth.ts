import type { Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Generic settings helpers for secrets and other values (cached)
const kvCache = new Map<string, string>()

export async function getSettingValue(key: string): Promise<string | undefined> {
  if (kvCache.has(key)) return kvCache.get(key)
  try {
    const s = await prisma.setting.findUnique({ where: { key } })
    if (s?.value != null) kvCache.set(key, s.value)
    return s?.value ?? undefined
  } catch {
    return undefined
  }
}

export async function setSettingValue(key: string, value: string | null | undefined): Promise<void> {
  // null/undefined clears the key
  if (value == null || value === '') {
    try { await prisma.setting.delete({ where: { key } }) } catch {}
    kvCache.delete(key)
    return
  }
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  kvCache.set(key, value)
}

// Auth middleware
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user) return res.status(401).json({ error: 'unauthorized' })
  if ((req as any).user.status !== 'active') return res.status(403).json({ error: 'not_active' })
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user || (req as any).user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  next()
}
