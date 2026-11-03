// dsh-web-sub — install script
// Copies the built plugin into a DSH profile's node_modules, replacing whatever
// is there. Mirrors the published file list exactly, so the installed tree never
// grows nested copies of itself.

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const profileDir = process.env.DSH_PROFILE_DIR
  || 'C:\\Users\\ricar\\.dsh\\profiles\\desktop'
const target = join(profileDir, 'node_modules', 'dsh-web-sub')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))

/** Everything the package ships. */
const ENTRIES = ['package.json', 'cordis.patch.yml', 'README.md', 'lib', 'assets', 'bin', 'locale', 'docs']

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

if (!existsSync(join(profileDir, 'node_modules'))) {
  console.error(`profile not found: ${profileDir}`)
  process.exit(1)
}

// Keep exactly one previous copy around, so a bad install is one rename away.
if (existsSync(target)) {
  const backup = `${target}.bak-${stamp()}`
  renameSync(target, backup)
  console.log(`backed up previous install -> ${backup}`)
}

mkdirSync(target, { recursive: true })
for (const entry of ENTRIES) {
  const source = join(root, entry)
  if (!existsSync(source)) {
    console.log(`skip (missing): ${entry}`)
    continue
  }
  cpSync(source, join(target, entry), { recursive: true })
  console.log(`copied: ${entry}`)
}

console.log(`\ninstalled dsh-web-sub v${pkg.version} -> ${target}`)
