import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'

async function main() {
  const base = process.env.TEST_BASE || 'http://localhost:3000'
  const testFilePath = process.argv[2]
  if (!testFilePath) {
    console.error('Usage: tsx scripts/test-import-endpoint.ts <file> [--ocr] [--no-analyze]')
    process.exit(1)
  }
  const doOcr = process.argv.includes('--ocr')
  const noAnalyze = process.argv.includes('--no-analyze')
  const stat = fs.statSync(testFilePath)
  if (stat.size > 25 * 1024 * 1024) {
    console.error('File larger than 25MB upload limit')
    process.exit(1)
  }
  const buff = fs.readFileSync(testFilePath)
  const fileName = path.basename(testFilePath)
  const form = new FormData()
  form.append('file', new Blob([buff]), fileName)
  if (doOcr) form.append('ocr', 'true')
  if (noAnalyze) form.append('analyze', 'false')
  const r = await fetch(base + '/api/import/file', { method: 'POST', body: form, headers: { 'cookie': process.env.TEST_COOKIE || '' } })
  console.log('Status', r.status)
  const json = await r.json()
  console.log(JSON.stringify(json, null, 2).slice(0, 5000))
}

main().catch(e=>{ console.error(e); process.exit(1) })
