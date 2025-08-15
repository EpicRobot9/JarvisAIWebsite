import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean)
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme'
  const passwordHash = await bcrypt.hash(adminPassword, 10)
  for (const email of adminEmails) {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (!existing) {
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'admin',
          status: 'active',
        }
      })
    } else {
      // Ensure the listed admin(s) stay admins with a known password and are active
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, role: 'admin', status: 'active' }
      })
    }
  }
}

main().finally(async () => prisma.$disconnect())
