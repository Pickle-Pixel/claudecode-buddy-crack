#!/usr/bin/env node

// Claude Code Buddy Crack
// One command: paste the JSON from the web creator, it patches the binary
// and injects your custom companion. That's it.
//
// Usage:
//   node buddy-crack.js                Read JSON from clipboard (or paste interactively)
//   node buddy-crack.js companion.json Read JSON from file
//   node buddy-crack.js unpatch        Restore original binary
//   node buddy-crack.js status         Show current state

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const readline = require('readline')

// --- Platform detection ---
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

const CLAUDE_BIN = IS_WIN
  ? path.join(os.homedir(), '.local', 'bin', 'claude.exe')
  : IS_MAC
    ? path.join(os.homedir(), '.claude', 'local', 'claude')
    : path.join(os.homedir(), '.local', 'bin', 'claude')

const CLAUDE_BACKUP = CLAUDE_BIN + '.bak'

const VERSIONS_DIR = IS_WIN
  ? path.join(os.homedir(), '.local', 'share', 'claude', 'versions')
  : path.join(os.homedir(), '.claude', 'versions')

const CONFIG_PATH = path.join(os.homedir(), '.claude.json')

// --- Patch pattern (v2.1.89) ---
// getCompanion() minified: return{...H,...$} (bones win) → return{...$,...H} (stored win)
const ORIGINAL = Buffer.from('{bones:$}=Gh$(Th$());return{...H,...$}')
const PATCHED  = Buffer.from('{bones:$}=Gh$(Th$());return{...$,...H}')

// --- Valid options ---
const SPECIES = ['duck','goose','blob','cat','dragon','octopus','owl','penguin','turtle','snail','ghost','axolotl','capybara','cactus','robot','rabbit','mushroom','chonk']
const EYES = ['·','✦','×','◉','@','°']
const HATS = ['none','crown','tophat','propeller','halo','wizard','beanie','tinyduck']
const RARITIES = ['common','uncommon','rare','epic','legendary']
const STAT_NAMES = ['DEBUGGING','PATIENCE','CHAOS','WISDOM','SNARK']
const RARITY_STARS = {common:'★',uncommon:'★★',rare:'★★★',epic:'★★★★',legendary:'★★★★★'}

// --- Binary helpers ---
function findAll(buf, pattern) {
  const positions = []
  let pos = 0
  while (pos < buf.length) {
    const idx = buf.indexOf(pattern, pos)
    if (idx === -1) break
    positions.push(idx)
    pos = idx + 1
  }
  return positions
}

function patchStatus(binPath) {
  if (!fs.existsSync(binPath)) return 'missing'
  const data = fs.readFileSync(binPath)
  const orig = findAll(data, ORIGINAL).length
  const patched = findAll(data, PATCHED).length
  if (patched > 0 && orig === 0) return 'patched'
  if (orig > 0 && patched === 0) return 'original'
  if (orig > 0 && patched > 0) return 'partial'
  return 'unknown'
}

function applyPatch(binPath) {
  const data = fs.readFileSync(binPath)
  const positions = findAll(data, ORIGINAL)

  if (positions.length === 0) {
    if (findAll(data, PATCHED).length > 0) {
      console.log(`  ✓ Already patched`)
      return true
    }
    console.error(`  ✗ Pattern not found — unsupported version`)
    return false
  }

  for (const pos of positions) PATCHED.copy(data, pos)
  fs.writeFileSync(binPath, data)
  console.log(`  ✓ Patched (${positions.length} location${positions.length > 1 ? 's' : ''})`)
  return true
}

function removePatch(binPath) {
  const data = fs.readFileSync(binPath)
  const positions = findAll(data, PATCHED)

  if (positions.length === 0) {
    if (findAll(data, ORIGINAL).length > 0) {
      console.log(`  ✓ Already original`)
      return true
    }
    console.error(`  ✗ Pattern not found`)
    return false
  }

  for (const pos of positions) ORIGINAL.copy(data, pos)
  fs.writeFileSync(binPath, data)
  console.log(`  ✓ Restored (${positions.length} location${positions.length > 1 ? 's' : ''})`)
  return true
}

function getVersionBinaries() {
  if (!fs.existsSync(VERSIONS_DIR)) return []
  return fs.readdirSync(VERSIONS_DIR)
    .map(v => ({ name: v, path: path.join(VERSIONS_DIR, v) }))
    .filter(v => {
      try { return fs.statSync(v.path).isFile() && fs.statSync(v.path).size > 50_000_000 }
      catch { return false }
    })
}

// --- Config helpers ---
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    // Handle trailing commas and other minor JSON issues
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const cleaned = raw.replace(/,\s*([\]}])/g, '$1')
    try { return JSON.parse(cleaned) } catch { return {} }
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

// --- Validation ---
function validate(companion) {
  const errors = []
  if (!companion.name || typeof companion.name !== 'string')
    errors.push('Missing or invalid "name"')
  if (!companion.personality || typeof companion.personality !== 'string')
    errors.push('Missing or invalid "personality"')
  if (!RARITIES.includes(companion.rarity))
    errors.push(`Invalid rarity "${companion.rarity}" — must be: ${RARITIES.join(', ')}`)
  if (!SPECIES.includes(companion.species))
    errors.push(`Invalid species "${companion.species}" — must be: ${SPECIES.join(', ')}`)
  if (!EYES.includes(companion.eye))
    errors.push(`Invalid eye "${companion.eye}" — must be: ${EYES.join(' ')}`)
  if (!HATS.includes(companion.hat))
    errors.push(`Invalid hat "${companion.hat}" — must be: ${HATS.join(', ')}`)
  if (typeof companion.shiny !== 'boolean')
    errors.push('Missing or invalid "shiny" — must be true or false')
  if (!companion.stats || typeof companion.stats !== 'object')
    errors.push('Missing or invalid "stats"')
  else {
    for (const s of STAT_NAMES) {
      if (typeof companion.stats[s] !== 'number' || companion.stats[s] < 1 || companion.stats[s] > 100)
        errors.push(`Invalid stat ${s}: ${companion.stats[s]} — must be 1-100`)
    }
  }
  return errors
}

// --- Display ---
function display(companion) {
  const shiny = companion.shiny ? ' ✨ SHINY ✨' : ''
  const stars = RARITY_STARS[companion.rarity] || ''
  console.log(`\n  ${stars} ${companion.rarity.toUpperCase()} ${companion.species.toUpperCase()}${shiny}`)
  console.log(`  Name: ${companion.name}`)
  console.log(`  Eyes: ${companion.eye}  Hat: ${companion.hat}`)
  console.log(`  Personality: ${companion.personality}`)
  console.log()
  for (const [stat, val] of Object.entries(companion.stats)) {
    const bar = '█'.repeat(Math.floor(val / 5)) + '░'.repeat(20 - Math.floor(val / 5))
    console.log(`  ${stat.padEnd(10)} ${bar} ${val}`)
  }
}

// =======================================================
// JSON INPUT HELPERS
// =======================================================

function readClipboard() {
  try {
    if (IS_WIN) {
      // Force UTF-8 output from PowerShell to preserve Unicode characters like ✦ ◉ ω
      const cmd = 'powershell -command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard"'
      return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim()
    } else if (IS_MAC) {
      return execSync('pbpaste', { encoding: 'utf8', timeout: 5000 }).trim()
    } else {
      return execSync('xclip -selection clipboard -o', { encoding: 'utf8', timeout: 5000 }).trim()
    }
  } catch { return null }
}

// Windows clipboard sometimes mangles Unicode. Map known corrupted values back.
const EYE_REPAIR = { '?': '✦', '??': '✦', '\ufffd': '✦' }
function repairCompanion(obj) {
  if (obj && obj.eye && !EYES.includes(obj.eye)) {
    // If eye got corrupted, try to repair it from the original eye list
    // Most common corruption: ✦ → ? on Windows
    if (EYE_REPAIR[obj.eye]) {
      obj.eye = EYE_REPAIR[obj.eye]
    } else {
      // Default to star eyes since they're the most commonly selected
      obj.eye = '✦'
    }
    console.log(`  (Repaired corrupted eye character → ${obj.eye})`)
  }
  return obj
}

function tryParseJSON(str) {
  if (!str) return null
  try {
    const obj = JSON.parse(str)
    if (obj && typeof obj === 'object' && obj.species) return obj
  } catch {}
  return null
}

function askForPaste() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    console.log('\n  Paste your companion JSON from the web creator and press Enter:\n')
    rl.question('  > ', answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function getCompanionJSON(args) {
  // 1. If arg is a .json file path, read it
  if (args[0] && (args[0].endsWith('.json') || fs.existsSync(args[0]))) {
    const filePath = path.resolve(args[0])
    if (!fs.existsSync(filePath)) {
      console.error(`\n  ✗ File not found: ${filePath}\n`)
      process.exit(1)
    }
    console.log(`  Reading from ${filePath}`)
    return fs.readFileSync(filePath, 'utf8').trim()
  }

  // 2. If args look like JSON (starts with {), join and return
  const joined = args.join(' ')
  if (joined.startsWith('{')) return joined

  // 3. No args — try clipboard first
  if (args.length === 0) {
    console.log('\n  Checking clipboard...')
    const clip = readClipboard()
    const parsed = tryParseJSON(clip)
    if (parsed) {
      console.log('  ✓ Found companion JSON in clipboard')
      return clip
    }
    console.log('  No companion JSON found in clipboard.')

    // 4. Fall back to interactive paste
    return await askForPaste()
  }

  return joined
}

// =======================================================
// MAIN
// =======================================================
async function main() {
const args = process.argv.slice(2)
const mode = args[0] || ''

// --- UNPATCH ---
if (mode === 'unpatch') {
  console.log('\n  Restoring original binary...\n')

  if (fs.existsSync(CLAUDE_BACKUP)) {
    fs.copyFileSync(CLAUDE_BACKUP, CLAUDE_BIN)
    console.log(`  ✓ Restored from backup`)
  } else {
    console.log(`  ${CLAUDE_BIN}`)
    removePatch(CLAUDE_BIN)
  }

  for (const ver of getVersionBinaries()) {
    console.log(`  ${ver.name}`)
    removePatch(ver.path)
  }

  console.log('\n  Done. Restart Claude Code.\n')
  process.exit(0)
}

// --- STATUS ---
if (mode === 'status') {
  console.log('\n  === Status ===\n')

  const status = patchStatus(CLAUDE_BIN)
  console.log(`  Binary:  ${status.toUpperCase()} (${CLAUDE_BIN})`)
  console.log(`  Backup:  ${fs.existsSync(CLAUDE_BACKUP) ? 'yes' : 'no'}`)

  for (const ver of getVersionBinaries()) {
    console.log(`  ${ver.name.padEnd(10)} ${patchStatus(ver.path).toUpperCase()}`)
  }

  const config = readConfig()
  if (config.companion) {
    console.log(`\n  Companion: ${config.companion.name}`)
    console.log(`  Rarity:    ${config.companion.rarity || '(not stored)'}`)
    console.log(`  Species:   ${config.companion.species || '(not stored)'}`)
  } else {
    console.log('\n  No companion in config.')
  }

  console.log()
  process.exit(0)
}

// --- HELP ---
if (mode === '--help' || mode === '-h' || mode === 'help') {
  console.log(`
  Claude Code Buddy Crack
  =======================

  Usage:
    node buddy-crack.js              Auto-read from clipboard, or paste interactively
    node buddy-crack.js comp.json    Read companion JSON from a file
    node buddy-crack.js unpatch      Restore original binary
    node buddy-crack.js status       Show current state

  Steps:
    1. Design your buddy at https://pickle-pixel.com/buddy
    2. Click "Copy Config JSON"
    3. Run: node buddy-crack.js
    4. Restart Claude Code
`)
  process.exit(0)
}

// --- PATCH + INJECT ---
const inputArgs = (mode === 'unpatch' || mode === 'status' || mode === 'help') ? [] : args
const raw = await getCompanionJSON(inputArgs)

let companion
try {
  companion = JSON.parse(raw)
} catch (e) {
  console.error(`\n  ✗ Invalid JSON: ${e.message}`)
  console.error(`\n  Get your companion JSON at https://pickle-pixel.com/buddy`)
  console.error(`  Copy it there, then run: node buddy-crack.js\n`)
  process.exit(1)
}

// Add hatchedAt if missing
if (!companion.hatchedAt) companion.hatchedAt = Date.now()

// Repair Windows clipboard damage
repairCompanion(companion)

// Validate
const errors = validate(companion)
if (errors.length > 0) {
  console.error('\n  ✗ Invalid companion data:\n')
  for (const err of errors) console.error(`    - ${err}`)
  console.error()
  process.exit(1)
}

// Show what we're installing
console.log('\n  === Installing Companion ===')
display(companion)

// Step 1: Backup
console.log('\n  --- Patching Binary ---\n')

if (!fs.existsSync(CLAUDE_BIN)) {
  console.error(`  ✗ Claude Code not found at ${CLAUDE_BIN}`)
  console.error(`  Make sure Claude Code is installed.\n`)
  process.exit(1)
}

if (!fs.existsSync(CLAUDE_BACKUP)) {
  fs.copyFileSync(CLAUDE_BIN, CLAUDE_BACKUP)
  console.log(`  ✓ Backup created`)
}

// Step 2: Patch
console.log(`  ${CLAUDE_BIN}`)
const mainOk = applyPatch(CLAUDE_BIN)

for (const ver of getVersionBinaries()) {
  console.log(`  ${ver.name}`)
  applyPatch(ver.path)
}

if (!mainOk) {
  console.error('\n  ✗ Failed to patch main binary. Aborting.\n')
  process.exit(1)
}

// Step 3: Inject
console.log('\n  --- Writing Config ---\n')

const config = readConfig()
config.companion = companion
writeConfig(config)
console.log(`  ✓ Written to ${CONFIG_PATH}`)

// Done
console.log(`
  ✓ Done! Restart Claude Code to see your companion.

  To undo: node buddy-crack.js unpatch
`)
}

main().catch(console.error)
