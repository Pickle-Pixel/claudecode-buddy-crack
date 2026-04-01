# Claude Code Buddy Crack

Customize your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) companion pet. Pick your species, rarity, hat, eyes, and shiny status — then patch the binary to make it stick.

Claude Code has a hidden gacha companion system (the Buddy system) that assigns you a deterministic pet based on your account UUID. Your rarity, species, and stats are locked to your identity. This tool lets you override that and choose your own.

<video src="https://github.com/Pickle-Pixel/claudecode-buddy-crack/releases/download/v0.0.0-assets/0401.mp4" controls width="100%"></video>

## [Use the Web Creator](https://pickle-pixel.com/buddy)

Design your companion visually with live ASCII preview:
- All 18 species with real sprite rendering
- 5 rarities, 6 eye styles, 8 hats, shiny toggle
- Generate a name and personality via AI prompt or write your own
- Exports config JSON with step-by-step install instructions

## Quick Start

1. **Design your buddy** at [pickle-pixel.com/buddy](https://pickle-pixel.com/buddy) and click **Copy Config JSON**
2. **Close all Claude Code sessions** (the binary can't be patched while running)
3. **Download and run the patcher:**

```bash
curl -O https://raw.githubusercontent.com/Pickle-Pixel/claudecode-buddy-crack/main/buddy-crack.js
node buddy-crack.js
```

That's it. The patcher reads the JSON from your clipboard, patches the binary, injects your companion, and creates a backup. One command.

**Other ways to provide the JSON:**

```bash
node buddy-crack.js                    # Auto-read from clipboard (recommended)
node buddy-crack.js companion.json     # Read from a file
```

4. **Restart Claude Code** — your custom companion appears

## Commands

```bash
node buddy-crack.js                    # Patch + inject (clipboard or interactive paste)
node buddy-crack.js companion.json     # Patch + inject from file
node buddy-crack.js status             # Show patch state + companion info
node buddy-crack.js unpatch            # Restore original binary from backup
```

## How It Works

The Buddy system stores only the companion's name and personality in `~/.claude.json`. The visual traits (rarity, species, eyes, hat, stats) are **recomputed from your account hash on every read** — editing the config alone does nothing because the recomputed values always overwrite stored ones.

The patcher flips a single spread operation in the compiled binary:

```
// Original — bones (recomputed) win:
return { ...stored, ...bones }

// Patched — stored (your config) wins:
return { ...bones, ...stored }
```

Same length, same structure, zero offset shift. Clean binary swap with automatic backup and integrity verification.

## Companion Options

| Category | Options |
|----------|---------|
| **Rarity** | common, uncommon, rare, epic, legendary |
| **Species** | duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk |
| **Eyes** | `·` `✦` `×` `◉` `@` `°` |
| **Hats** | none, crown, tophat, propeller, halo, wizard, beanie, tinyduck |
| **Shiny** | 1% chance normally — or just toggle it on |
| **Stats** | DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK (scaled by rarity) |

## Safety

- **Automatic backup** — the original binary is backed up before any modification
- **Config backup** — `~/.claude.json` is backed up before injection
- **Integrity check** — binary size is verified after patching; mismatches trigger auto-restore
- **Safe config injection** — only the `companion` field is modified; all other config (OAuth, permissions, settings) is preserved even if the JSON has syntax issues
- **Fully local** — no data is sent anywhere. The buddy system has no server-side state
- **Fully reversible** — `node buddy-crack.js unpatch` restores the original binary

## Platform Support

| Platform | Binary Location | Clipboard | Status |
|----------|----------------|-----------|--------|
| **Windows** | `~/.local/bin/claude.exe` | PowerShell (UTF-8) | Tested |
| **macOS** | `~/.local/bin/claude` | pbpaste | Untested |
| **Linux** | `~/.local/bin/claude` | xclip | Untested |

All platforms follow the XDG Base Directory specification. Version binaries are stored in `~/.local/share/claude/versions/`.

## Version Compatibility

The binary patch targets specific minified variable names in Claude Code **v2.1.89**. Different versions will have different minified names, which means the patch pattern won't match. The tool detects this and tells you — it won't modify a binary it doesn't recognize. When Claude Code updates, you'll need an updated patch pattern.

## Requirements

- [Node.js](https://nodejs.org) 18+
- Claude Code installed (native installation)
- The `BUDDY` feature flag must be active (April 2026 teaser window onward)

## Technical Details

See [BUDDY_SYSTEM.md](BUDDY_SYSTEM.md) for the full reverse-engineering documentation of the gacha algorithm, PRNG implementation, hash functions, tamper protection, and attack surface analysis.
