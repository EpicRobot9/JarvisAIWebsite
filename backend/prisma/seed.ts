import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean)
  for (const email of adminEmails) {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (!existing) {
      await prisma.user.create({
        data: {
          email,
          passwordHash: '$2a$10$KIX6a7Tqv9VJX5Xo5m5mGe3oL4zvD1q7mYb3tI7aLqE5l1w5uM1mG', // "changeme" bcrypt
          role: 'admin',
          status: 'active',
        }
      })
    }
  }
}

main().finally(async () => prisma.$disconnect())
