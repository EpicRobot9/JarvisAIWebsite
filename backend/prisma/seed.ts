import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Prefer ADMIN_USERNAMES; fallback to ADMIN_EMAILS for backward compatibility
  const rawList = (process.env.ADMIN_USERNAMES || process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  // Always ensure at least a default admin username if none provided
  const adminUsernames = rawList.length ? rawList : ['admin']
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme'
  const seedMode = (process.env.ADMIN_SEED_MODE || 'ensure').toLowerCase() // 'ensure' | 'reset'
  const reset = seedMode === 'reset'
  const passwordHash = await bcrypt.hash(adminPassword, 10)

  for (const username of adminUsernames) {
    const existing = await (prisma as any).user.findUnique({ where: { username } }).catch(()=>null)
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
      console.log(`[seed] Created admin '${username}' (default password applied)`) // eslint-disable-line no-console
    } else {
      // Ensure the listed admin(s) stay admins and are active; backfill email if missing
      const email = existing.email || `${username}@local.local`
      const data: any = { role: 'admin', status: 'active', email }
      if (reset) data.passwordHash = passwordHash
      await (prisma as any).user.update({ where: { id: existing.id }, data })
      console.log(`[seed] Ensured admin '${username}' (${reset ? 'password reset' : 'password kept'})`) // eslint-disable-line no-console
    }
  }
}

main().finally(async () => prisma.$disconnect())
