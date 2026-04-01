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

// All platforms follow XDG: ~/.local/bin/claude(.exe)
// Versions stored in: ~/.local/share/claude/versions/
const CLAUDE_BIN = path.join(os.homedir(), '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude')
const CLAUDE_BACKUP = CLAUDE_BIN + '.bak'
const VERSIONS_DIR = path.join(os.homedir(), '.local', 'share', 'claude', 'versions')

const CONFIG_PATH = path.join(os.homedir(), '.claude.json')

// --- Patch pattern ---
// getCompanion() minified: return{...H,...$} (bones win) → return{...$,...H} (stored win)
// The function names between bones destructuring and return vary across platforms
// (e.g. Gh$/Th$ on Windows, ZE8/vE8 on macOS) so we match by landmark instead.
const LANDMARK    = Buffer.from('let{bones:$}=')
const ORIG_RETURN = Buffer.from('return{...H,...$}')
const PATCH_RETURN = Buffer.from('return{...$,...H}')
const SEARCH_WINDOW = 60

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

function findPatchSites(data) {
  const sites = []
  const landmarks = findAll(data, LANDMARK)
  for (const lm of landmarks) {
    const windowEnd = Math.min(data.length, lm + LANDMARK.length + SEARCH_WINDOW)
    const window = data.slice(lm, windowEnd)
    const origOff = window.indexOf(ORIG_RETURN)
    const patchOff = window.indexOf(PATCH_RETURN)
    if (origOff !== -1) sites.push({ offset: lm + origOff, state: 'original' })
    else if (patchOff !== -1) sites.push({ offset: lm + patchOff, state: 'patched' })
  }
  return sites
}

function patchStatus(binPath) {
  if (!fs.existsSync(binPath)) return 'missing'
  const data = fs.readFileSync(binPath)
  const sites = findPatchSites(data)
  if (sites.length === 0) return 'unknown'
  const orig = sites.filter(s => s.state === 'original').length
  const patched = sites.filter(s => s.state === 'patched').length
  if (patched > 0 && orig === 0) return 'patched'
  if (orig > 0 && patched === 0) return 'original'
  if (orig > 0 && patched > 0) return 'partial'
  return 'unknown'
}

function applyPatch(binPath) {
  let data
  try { data = fs.readFileSync(binPath) } catch (e) {
    if (e.code === 'EBUSY') { console.error(`  ✗ File is locked — close Claude Code first`); return 'busy' }
    throw e
  }
  const sites = findPatchSites(data)

  if (sites.length === 0) {
    console.error(`  ✗ Pattern not found — unsupported version`)
    return false
  }

  const origSites = sites.filter(s => s.state === 'original')
  if (origSites.length === 0) {
    console.log(`  ✓ Already patched`)
    return true
  }

  for (const site of origSites) PATCH_RETURN.copy(data, site.offset)
  try { fs.writeFileSync(binPath, data) } catch (e) {
    if (e.code === 'EBUSY') { console.error(`  ✗ File is locked — close Claude Code first`); return 'busy' }
    throw e
  }
  console.log(`  ✓ Patched (${origSites.length} location${origSites.length > 1 ? 's' : ''})`)
  return true
}

function removePatch(binPath) {
  let data
  try { data = fs.readFileSync(binPath) } catch (e) {
    if (e.code === 'EBUSY') { console.error(`  ✗ File is locked — close Claude Code first`); return 'busy' }
    throw e
  }
  const sites = findPatchSites(data)

  if (sites.length === 0) {
    console.error(`  ✗ Pattern not found`)
    return false
  }

  const patchedSites = sites.filter(s => s.state === 'patched')
  if (patchedSites.length === 0) {
    console.log(`  ✓ Already original`)
    return true
  }

  for (const site of patchedSites) ORIG_RETURN.copy(data, site.offset)
  try { fs.writeFileSync(binPath, data) } catch (e) {
    if (e.code === 'EBUSY') { console.error(`  ✗ File is locked — close Claude Code first`); return 'busy' }
    throw e
  }
  console.log(`  ✓ Restored (${patchedSites.length} location${patchedSites.length > 1 ? 's' : ''})`)
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
// CRITICAL: Never overwrite the entire config. Claude Code's config can be 50KB+
// with permissions, tool approvals, OAuth tokens, etc. If we can't parse it,
// we do a raw string injection instead of risking a full overwrite.

function backupConfig() {
  const backupPath = CONFIG_PATH + '.bak'
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, backupPath)
    return backupPath
  }
  return null
}

function injectCompanion(companion) {
  const companionJSON = JSON.stringify(companion, null, 2)
  const indented = companionJSON.split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n')

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ companion }, null, 2) + '\n')
    return
  }

  // Always backup config before modifying
  const backupPath = backupConfig()
  if (backupPath) console.log(`  ✓ Config backed up to ${backupPath}`)

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')

  // Try proper JSON parse first
  let config
  try {
    config = JSON.parse(raw)
  } catch {
    const cleaned = raw.replace(/,\s*([\]}])/g, '$1')
    try { config = JSON.parse(cleaned) } catch { config = null }
  }

  if (config) {
    config.companion = companion
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
    return
  }

  // Could NOT parse the config. Do a raw string replacement to avoid nuking it.
  console.log('  (Config has syntax issues — using safe string injection)')

  // Find the "companion" key and its full value using brace-depth counting
  const key = '"companion"'
  const keyIdx = raw.indexOf(key)
  if (keyIdx !== -1) {
    // Find the opening brace after the key
    const afterKey = raw.indexOf('{', keyIdx + key.length)
    if (afterKey !== -1) {
      // Walk forward counting braces to find the matching close
      let depth = 0
      let end = afterKey
      for (let i = afterKey; i < raw.length; i++) {
        if (raw[i] === '{') depth++
        else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break } }
      }
      const before = raw.slice(0, keyIdx)
      const after = raw.slice(end + 1)
      fs.writeFileSync(CONFIG_PATH, before + `"companion": ${indented}` + after)
      return
    }
  }

  // No existing companion field — inject after the opening brace
  const insertPos = raw.indexOf('{')
  if (insertPos !== -1) {
    const result = raw.slice(0, insertPos + 1) +
      `\n  "companion": ${indented},` +
      raw.slice(insertPos + 1)
    fs.writeFileSync(CONFIG_PATH, result)
    return
  }

  // Last resort
  console.error('  ✗ Could not safely modify config. Save this JSON and add it manually:')
  console.log(companionJSON)
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const cleaned = raw.replace(/,\s*([\]}])/g, '$1')
    try { return JSON.parse(cleaned) } catch { return null }
  }
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
    if (EYE_REPAIR[obj.eye]) {
      obj.eye = EYE_REPAIR[obj.eye]
      console.log(`  (Repaired corrupted eye character → ${obj.eye})`)
    } else {
      console.log(`  Warning: unrecognized eye "${obj.eye}" — may be from a newer version.`)
      console.log(`  Known eyes: ${EYES.join(' ')}`)
    }
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
  let hasBusy = false

  if (fs.existsSync(CLAUDE_BACKUP)) {
    try {
      fs.copyFileSync(CLAUDE_BACKUP, CLAUDE_BIN)
      console.log(`  ✓ Restored from backup`)
    } catch (e) {
      if (e.code === 'EBUSY') {
        console.error(`  ✗ ${CLAUDE_BIN} is locked — close Claude Code first`)
        hasBusy = true
      } else throw e
    }
  } else {
    console.log(`  ${CLAUDE_BIN}`)
    const r = removePatch(CLAUDE_BIN)
    if (r === 'busy') hasBusy = true
  }

  for (const ver of getVersionBinaries()) {
    console.log(`  ${ver.name}`)
    removePatch(ver.path)
  }

  if (hasBusy) {
    console.log('\n  ⚠ Main binary is locked. Close all Claude Code sessions and run again.\n')
  } else {
    console.log('\n  Done. Restart Claude Code.\n')
  }
  process.exit(hasBusy ? 1 : 0)
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

try {
  if (!fs.existsSync(CLAUDE_BACKUP)) {
    fs.copyFileSync(CLAUDE_BIN, CLAUDE_BACKUP)
    console.log(`  ✓ Backup created`)
  }
} catch (e) {
  if (e.code === 'EBUSY') {
    console.error(`  ✗ Binary is locked — close all Claude Code sessions and try again.\n`)
    process.exit(1)
  }
  throw e
}

// Step 2: Patch
console.log(`  ${CLAUDE_BIN}`)
const mainOk = applyPatch(CLAUDE_BIN)

for (const ver of getVersionBinaries()) {
  console.log(`  ${ver.name}`)
  applyPatch(ver.path)
}

if (mainOk === 'busy') {
  console.error('\n  ✗ Binary is locked — close all Claude Code sessions and try again.\n')
  process.exit(1)
}

if (!mainOk) {
  try {
    if (fs.existsSync(CLAUDE_BACKUP)) {
      fs.copyFileSync(CLAUDE_BACKUP, CLAUDE_BIN)
      console.log('  ✓ Restored original binary from backup')
    }
  } catch {}
  console.error('\n  ✗ Failed to patch. This version may not be supported.\n')
  process.exit(1)
}

// Verify patched binary size matches backup (catch truncated writes)
if (fs.existsSync(CLAUDE_BACKUP)) {
  const origSize = fs.statSync(CLAUDE_BACKUP).size
  const patchedSize = fs.statSync(CLAUDE_BIN).size
  if (origSize !== patchedSize) {
    try { fs.copyFileSync(CLAUDE_BACKUP, CLAUDE_BIN) } catch {}
    console.error('  ✗ Binary size mismatch after patch — restored from backup.')
    console.error(`    Expected: ${origSize} bytes, got: ${patchedSize} bytes\n`)
    process.exit(1)
  }
}

// Step 3: Inject (safe — never overwrites unrelated config fields)
console.log('\n  --- Writing Config ---\n')

injectCompanion(companion)
console.log(`  ✓ Written to ${CONFIG_PATH}`)

// Done
console.log(`
  ✓ Done! Restart Claude Code to see your companion.

  To undo: node buddy-crack.js unpatch
`)
}

main().catch(console.error)
