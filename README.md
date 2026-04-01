# Claude Code Buddy Crack

Customize your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) companion pet. Pick your species, rarity, hat, eyes, and shiny status — then patch the binary to make it stick.

Claude Code has a hidden gacha companion system (the Buddy system) that assigns you a deterministic pet based on your account UUID. Your rarity, species, and stats are locked to your identity. This tool lets you override that and choose your own.

## [Use the Web Creator](https://picklepixel.dev/claudecode-buddy-crack)

Design your companion visually with live ASCII preview:
- All 18 species with real sprite rendering
- 5 rarities, 6 eye styles, 8 hats, shiny toggle
- Generate a name and personality via AI prompt or write your own
- Exports config JSON + step-by-step install instructions

## How It Works

The Buddy system stores only the companion's name and personality in `~/.claude.json`. The visual traits (rarity, species, eyes, hat, stats) are **recomputed from your account hash on every read** — editing the config does nothing because the recomputed values always overwrite stored ones.

The patcher flips a single spread operation in the compiled binary:

```
// Original — bones (recomputed) win:
return { ...stored, ...bones }

// Patched — stored (your config) wins:
return { ...bones, ...stored }
```

Same length, same structure, zero offset shift. Clean binary swap with automatic backup.

## Quick Start

1. **Design your buddy** on the [web creator](https://picklepixel.dev/claudecode-buddy-crack) and copy the config JSON
2. **Close Claude Code**
3. **Download and run the patcher:**

```bash
node buddy-crack.js patch
```

4. **Paste your companion JSON into config:**

```bash
node buddy-crack.js inject '<your-copied-json>'
```

5. **Restart Claude Code** — your custom companion appears

## Patcher Commands

```bash
node buddy-crack.js patch              # Patch binary (creates backup)
node buddy-crack.js unpatch            # Restore original binary
node buddy-crack.js status             # Show patch state + companion info
node buddy-crack.js inject '<json>'    # Write companion JSON to config
```

## Companion Options

| Category | Options |
|----------|---------|
| **Rarity** | common, uncommon, rare, epic, legendary |
| **Species** | duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk |
| **Eyes** | `·` `✦` `×` `◉` `@` `°` |
| **Hats** | none, crown, tophat, propeller, halo, wizard, beanie, tinyduck |
| **Shiny** | 1% chance normally — or just toggle it on |
| **Stats** | DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK (scaled by rarity) |

## Reversibility

The patcher always creates a backup before modifying anything. To restore:

```bash
node buddy-crack.js unpatch
```

The patch is **entirely local** — no data is sent to Anthropic's servers. The buddy system has no server-side state; all rendering happens client-side.

## Version Compatibility

The binary patch targets specific minified variable names in Claude Code **v2.1.89**. Different versions may use different variable names, which would require re-deriving the patch pattern. The `status` command will tell you if the pattern is found.

## Requirements

- Node.js 18+
- Claude Code installed (`~/.local/bin/claude.exe` on Windows)
- The `BUDDY` feature flag must be active (available during April 2026 teaser window and after May 2026 launch)

## Technical Details

See [BUDDY_SYSTEM.md](BUDDY_SYSTEM.md) for the full reverse-engineering documentation of the gacha algorithm, PRNG implementation, hash functions, tamper protection, and attack surface analysis.
