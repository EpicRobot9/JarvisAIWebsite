import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Prefer ADMIN_USERNAMES; fallback to ADMIN_EMAILS for backward compatibility
  const adminUsernames = (process.env.ADMIN_USERNAMES || process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme'
  const passwordHash = await bcrypt.hash(adminPassword, 10)
  for (const username of adminUsernames) {
    const existing = await (prisma as any).user.findUnique({ where: { username } })
    if (!existing) {
      await (prisma as any).user.create({
        data: {
          username,
          email: `${username}@local.local`,
          passwordHash,
          role: 'admin',
          status: 'active',
        }
      })
    } else {
      // Ensure the listed admin(s) stay admins with a known password and are active
      const email = existing.email || `${username}@local.local`
      await (prisma as any).user.update({
        where: { id: existing.id },
        data: { passwordHash, role: 'admin', status: 'active', email }
      })
    }
  }
}

main().finally(async () => prisma.$disconnect())
