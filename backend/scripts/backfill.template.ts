/**
 * Backfill template for safe, incremental data migrations.
 *
 * Usage:
 *   - Copy to backend/scripts/backfill-<your-change>.ts
 *   - Implement the backfill logic (batching, retries, idempotency)
 *   - Run with: npx tsx backend/scripts/backfill-<your-change>.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('[backfill] starting')

  // Example: backfill AIProfile for users missing one
  const BATCH = 250
  let offset = 0
  while (true) {
    const users = await prisma.user.findMany({
      skip: offset,
      take: BATCH,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    if (users.length === 0) break

    for (const u of users) {
      // Idempotent upsert: only create if missing
      await prisma.aIProfile.upsert({
        where: { userId: u.id },
        update: {},
        create: { userId: u.id, name: 'Default' },
      })
    }

    offset += users.length
    console.log(`[backfill] processed ${offset} users`)
  }

  console.log('[backfill] done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
