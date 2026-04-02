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
// getCompanion() minified: return{...A,...B} (bones win) → return{...B,...A} (stored win)
// Function names and variable names differ across platform builds, so we find
// `let{bones:` as a landmark, read the actual variable char, then match/swap
// the return spread order in a window after it.
const LANDMARK = Buffer.from('let{bones:')
const SEARCH_WINDOW = 80

// --- Valid options ---
const SPECIES = ['duck','goose','blob','cat','dragon','octopus','owl','penguin','turtle','snail','ghost','axolotl','capybara','cactus','robot','rabbit','mushroom','chonk']
const EYES = ['·','✦','×','◉','@','°']
const HATS = ['none','crown','tophat','propeller','halo','wizard','beanie','tinyduck']
const RARITIES = ['common','uncommon','rare','epic','legendary']
const STAT_NAMES = ['DEBUGGING','PATIENCE','CHAOS','WISDOM','SNARK']
const RARITY_STARS = {common:'★',uncommon:'★★',rare:'★★★',epic:'★★★★',legendary:'★★★★★'}

// --- Code signing ---
// macOS arm64 kills modified binaries with invalid signatures.
// Re-sign with ad-hoc signature after patching so the binary can launch.
function resignBinary(binPath) {
  if (!IS_MAC) return
  try {
    execSync(`codesign --remove-signature "${binPath}"`, { stdio: 'ignore' })
    execSync(`codesign -s - "${binPath}"`, { stdio: 'ignore' })
    console.log(`  ✓ Re-signed`)
  } catch {
    console.error(`  ⚠ Could not re-sign binary — run: codesign -s - "${binPath}"`)
  }
}

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
    // Read the variable name right after "let{bones:"
    const varStart = lm + LANDMARK.length
    const varChar = data.slice(varStart, varStart + 1).toString('utf8')
    if (data[varStart + 1] !== 0x7D) continue // next char must be '}' — skip non-getCompanion matches
    const windowEnd = Math.min(data.length, lm + LANDMARK.length + SEARCH_WINDOW)
    const windowStr = data.slice(lm, windowEnd).toString('utf8')
    const spreadMatch = windowStr.match(/return\{\.\.\.([\w$]),\.\.\.([\w$])\}/)
    if (!spreadMatch) continue
    const [, first, second] = spreadMatch
    if (second === varChar) {
      const origReturn = Buffer.from(`return{...${first},...${second}}`)
      const patchReturn = Buffer.from(`return{...${second},...${first}}`)
      sites.push({ offset: lm + spreadMatch.index, state: 'original', origReturn, patchReturn })
    } else if (first === varChar) {
      const origReturn = Buffer.from(`return{...${second},...${first}}`)
      const patchReturn = Buffer.from(`return{...${first},...${second}}`)
      sites.push({ offset: lm + spreadMatch.index, state: 'patched', origReturn, patchReturn })
    }
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

  for (const site of origSites) site.patchReturn.copy(data, site.offset)
  try { fs.writeFileSync(binPath, data) } catch (e) {
    if (e.code === 'EBUSY') { console.error(`  ✗ File is locked — close Claude Code first`); return 'busy' }
    throw e
  }
  const writtenSize = fs.statSync(binPath).size
  if (writtenSize !== data.length) {
    console.error(`  ✗ Binary size mismatch after write — expected ${data.length}, got ${writtenSize}`)
    return false
  }
  resignBinary(binPath)
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

  for (const site of patchedSites) site.origReturn.copy(data, site.offset)
  try { fs.writeFileSync(binPath, data) } catch (e) {
    if (e.code === 'EBUSY') { console.error(`  ✗ File is locked — close Claude Code first`); return 'busy' }
    throw e
  }
  const writtenSize = fs.statSync(binPath).size
  if (writtenSize !== data.length) {
    console.error(`  ✗ Binary size mismatch after write — expected ${data.length}, got ${writtenSize}`)
    return false
  }
  resignBinary(binPath)
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

function removeCompanion() {
  if (!fs.existsSync(CONFIG_PATH)) return

  const backupPath = backupConfig()
  if (backupPath) console.log(`  ✓ Config backed up to ${backupPath}`)

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')

  let config
  try {
    config = JSON.parse(raw)
  } catch {
    const cleaned = raw.replace(/,\s*([\]}])/g, '$1')
    try { config = JSON.parse(cleaned) } catch { config = null }
  }

  if (config) {
    if (!config.companion) { console.log('  ✓ No companion in config'); return }
    delete config.companion
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
    console.log(`  ✓ Removed companion from ${CONFIG_PATH}`)
    return
  }

  // Could NOT parse — use raw string removal
  const key = '"companion"'
  const keyIdx = raw.indexOf(key)
  if (keyIdx === -1) { console.log('  ✓ No companion in config'); return }

  const afterKey = raw.indexOf('{', keyIdx + key.length)
  if (afterKey !== -1) {
    let depth = 0
    let end = afterKey
    for (let i = afterKey; i < raw.length; i++) {
      if (raw[i] === '{') depth++
      else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    // Remove the key, value, and any trailing comma/whitespace
    let removeEnd = end + 1
    const afterValue = raw.slice(removeEnd).match(/^\s*,?\s*/)
    if (afterValue) removeEnd += afterValue[0].length
    // Also consume a leading comma if this wasn't the first key
    let removeStart = keyIdx
    const beforeKey = raw.slice(0, keyIdx)
    const leadingComma = beforeKey.match(/,\s*$/)
    if (leadingComma) removeStart -= leadingComma[0].length
    fs.writeFileSync(CONFIG_PATH, raw.slice(0, removeStart) + raw.slice(removeEnd))
    console.log(`  ✓ Removed companion from ${CONFIG_PATH}`)
  }
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
      resignBinary(CLAUDE_BIN)
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

  // Remove companion from config so it doesn't show up as a dead ghost
  console.log('\n  --- Cleaning Config ---\n')
  removeCompanion()

  // Remove guard hook
  console.log('\n  --- Removing Guard Hook ---\n')
  const SETTINGS_PATH_U = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    if (fs.existsSync(SETTINGS_PATH_U)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH_U, 'utf8'))
      if (settings.hooks?.SessionStart) {
        settings.hooks.SessionStart = settings.hooks.SessionStart.filter(entry =>
          !entry.hooks?.some(h => h.command && h.command.includes('buddy-crack') && h.command.includes('guard'))
        )
        if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks
        fs.writeFileSync(SETTINGS_PATH_U, JSON.stringify(settings, null, 2) + '\n')
        console.log('  ✓ Guard hook removed')
      }
    }
  } catch {}

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

// --- GUARD (SessionStart hook) ---
if (mode === 'guard') {
  // Silence all console output — hook stdout/stderr pollutes the session.
  console.log = () => {}
  console.error = () => {}

  // Clean up stale .old files from previous rename-trick patches.
  try {
    const binDir = path.dirname(CLAUDE_BIN)
    const binBase = path.basename(CLAUDE_BIN)
    for (const f of fs.readdirSync(binDir)) {
      if (f.startsWith(binBase + '.old.')) {
        try { fs.unlinkSync(path.join(binDir, f)) } catch {}
      }
    }
  } catch {}

  // Check if companion exists in config — if not, nothing to guard.
  const config = readConfig()
  if (!config || !config.companion) process.exit(0)

  // Preemptively patch any unpatched versioned binaries so future
  // auto-update copies are already patched when Iv4 copies them.
  for (const ver of getVersionBinaries()) {
    if (patchStatus(ver.path) === 'original') applyPatch(ver.path)
  }

  const status = patchStatus(CLAUDE_BIN)
  if (status === 'patched') process.exit(0)
  if (status !== 'original' && status !== 'partial') process.exit(0)

  // Main binary needs patching. Try direct write first.
  const result = applyPatch(CLAUDE_BIN)
  if (result !== 'busy') process.exit(0)

  // Direct write failed (EBUSY — exe is locked by a running session).
  // Use the same rename trick the auto-updater uses: on Windows you can
  // rename a running .exe, freeing the original path for a new file.
  try {
    const data = fs.readFileSync(CLAUDE_BIN)
    const sites = findPatchSites(data)
    const origSites = sites.filter(s => s.state === 'original')
    if (origSites.length === 0) process.exit(0)

    for (const site of origSites) site.patchReturn.copy(data, site.offset)

    const oldPath = CLAUDE_BIN + '.old.' + Date.now()
    fs.renameSync(CLAUDE_BIN, oldPath)
    fs.writeFileSync(CLAUDE_BIN, data)
    const writtenSize = fs.statSync(CLAUDE_BIN).size
    if (writtenSize !== data.length) {
      try { fs.renameSync(oldPath, CLAUDE_BIN) } catch {}
      process.exit(1)
    }
    resignBinary(CLAUDE_BIN)
    try { fs.unlinkSync(oldPath) } catch {}
  } catch {}

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
    node buddy-crack.js guard        Auto-repatch (for SessionStart hook)

  Steps:
    1. Design your buddy at https://pickle-pixel.com/buddy
    2. Click "Copy Config JSON"
    3. Run: node buddy-crack.js
    4. Restart Claude Code
`)
  process.exit(0)
}

// --- PATCH + INJECT ---
const inputArgs = (mode === 'unpatch' || mode === 'status' || mode === 'help' || mode === 'guard') ? [] : args
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
      resignBinary(CLAUDE_BIN)
      console.log('  ✓ Restored original binary from backup')
    }
  } catch {}
  console.error('\n  ✗ Failed to patch. This version may not be supported.\n')
  process.exit(1)
}

// Step 3: Inject (safe — never overwrites unrelated config fields)
console.log('\n  --- Writing Config ---\n')

injectCompanion(companion)
console.log(`  ✓ Written to ${CONFIG_PATH}`)

// Step 4: Install guard hook (survives auto-updates)
console.log('\n  --- Installing Guard Hook ---\n')

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')
const guardCmd = `node ${__filename.replace(/\\/g, '/')} guard`

try {
  let settings = {}
  if (fs.existsSync(SETTINGS_PATH)) {
    try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) } catch {}
  } else {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  }

  const hooks = settings.hooks || {}
  const sessionHooks = hooks.SessionStart || []

  const alreadyInstalled = sessionHooks.some(entry =>
    entry.hooks?.some(h => h.command && h.command.includes('buddy-crack') && h.command.includes('guard'))
  )

  if (alreadyInstalled) {
    console.log('  ✓ Guard hook already installed')
  } else {
    sessionHooks.push({
      matcher: '',
      hooks: [{ type: 'command', command: guardCmd, timeout: 15 }]
    })
    hooks.SessionStart = sessionHooks
    settings.hooks = hooks
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
    console.log(`  ✓ Guard hook added to ${SETTINGS_PATH}`)
    console.log('  Auto-updates will never kill your companion again.')
  }
} catch (e) {
  console.log(`  ⚠ Could not install guard hook: ${e.message}`)
  console.log(`  Add it manually — see: https://github.com/Pickle-Pixel/claudecode-buddy-crack#surviving-auto-updates`)
}

// Done
console.log(`
  ✓ Done! Restart Claude Code to see your companion.

  To undo: node buddy-crack.js unpatch
`)
}

main().catch(console.error)
