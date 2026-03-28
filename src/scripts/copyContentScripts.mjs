import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Run from exempliphai/src
const fromDir = path.resolve(process.cwd(), 'public', 'contentScripts')
const toDir = path.resolve(process.cwd(), '..', 'dist', 'contentScripts')

if (!fs.existsSync(fromDir)) {
  console.error(`[copyContentScripts] Source folder not found: ${fromDir}`)
  process.exit(1)
}

fs.mkdirSync(toDir, { recursive: true })

// Node 16+ supports fs.cpSync
fs.cpSync(fromDir, toDir, { recursive: true })

const copied = fs.readdirSync(toDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'))
console.log(`[copyContentScripts] Copied ${copied.length} script(s) to ${toDir}`)
