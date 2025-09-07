import { PrismaClient } from '@prisma/client'

async function main() {
  const prisma = new PrismaClient()
  try {
    // 1) Verify admin seed didn't change createdAt on rerun
    const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } })
    if (!admin) {
      console.log('[verify] No admin user found')
    } else {
      const firstCreatedAt = admin.createdAt
      console.log(`[verify] Admin '${admin.username}' createdAt=${firstCreatedAt.toISOString()}`)
    }

    // 2) Create a throwaway user and ensure it can be listed
    const unique = `verify_${Math.random().toString(36).slice(2, 8)}`
    const u = await prisma.user.create({
      data: {
        username: unique,
        email: `${unique}@local.local`,
        passwordHash: 'x', // not used for login in this script
        status: 'active',
      }
    })
    console.log(`[verify] Created user ${u.username} (${u.id}) at ${u.createdAt.toISOString()}`)

    const list = await prisma.user.findMany({ select: { id: true, username: true }, where: { id: u.id } })
    if (!list.find(x => x.id === u.id)) {
      console.error('[verify] Newly created user missing from list query!')
      process.exitCode = 1
    } else {
      console.log('[verify] Newly created user is present in list query')
    }

    // Cleanup: delete the throwaway user
    await prisma.session.deleteMany({ where: { userId: u.id } }).catch(()=>{})
    await prisma.approval.deleteMany({ where: { userId: u.id } }).catch(()=>{})
    await prisma.user.delete({ where: { id: u.id } }).catch(()=>{})
  } finally {
    await (prisma as any).$disconnect()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
