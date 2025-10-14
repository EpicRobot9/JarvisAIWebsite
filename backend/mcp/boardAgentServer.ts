/*
  MCP Server: Board Agent Tools over stdio
  Tools:
  - create_note
  - create_link
  - create_image
  - list_items
*/
import { PrismaClient } from '@prisma/client'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createBoardMcpServer } from './boardAgent.js'

async function main() {
  const prisma = new PrismaClient()
  const server = createBoardMcpServer(prisma)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(e => { console.error('[mcp] fatal', e); process.exit(1) })
