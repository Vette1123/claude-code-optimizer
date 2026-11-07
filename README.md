# claude-code-optimizer

Make your Claude Code usage limit last longer and stop Claude Code from saturating a slow internet upload. It's one idempotent installer for macOS, Linux and Windows, made of hooks and settings with no dependencies. Your model choice is never touched.

```
git clone https://github.com/Vette1123/claude-code-optimizer.git
cd claude-code-optimizer
node install.mjs --dry-run
node install.mjs
```

Restart Claude Code afterwards. A second run reports `0 change(s)`.

## Why your Claude Code limit runs out

Every API call re-sends the whole conversation, so cost is roughly context size × number of turns. I measured my own transcripts over one day: about 172k tokens of context were re-read per turn across 18,829 turns, and a single background session used 1 billion tokens. The model mattered less than how big each turn's context had grown.

Images are the second problem. Every turn re-uploads them as part of the conversation. In my transcripts they were 85% of the bytes, and one busy session sent about 1.2 MB per call. Two of those were enough to fill a 2 Mbps uplink, and every other app on the machine then lost DNS and dropped connections.

## What it installs

| Piece | What it does |
|---|---|
| `shrink-image-read.mjs` (PreToolUse) | Re-encodes screenshots Claude reads as JPEG with a 1200px long edge. A phone capture goes from 749 KB to 84 KB. It also sets `scale: 0.6` on Claude in Chrome screenshots. Paths under `marketing/`, `store/` or `brand/` stay full size. |
| `compact-handoff.mjs` (PreCompact, PostCompact, SessionStart) | Makes auto-compaction write a real handoff (goal, done, next step, what's running), saves it to `~/.claude/state/handoffs/`, and points a new session in the same folder at the newest one. |
| `explore-nudge.mjs` (PreToolUse) | After 12 read-only tool calls in a row, it reminds the main session to hand the search to one cheaper subagent and keep only the finding. |
| `usage-report.mjs` | Shows where the limit went: tokens per day, per model and per session, plus context per turn. `node ~/.claude/usage-report.mjs --days 7` |
| `mcp-toggle.mjs` | Every connected MCP server costs its tool names on every turn. This moves one you rarely use out of your config and back: `node ~/.claude/mcp-toggle.mjs <name> off` / `on`. |
| `plugin-overrides.mjs` (opt-in) | `--plugin-overrides` removes the superpowers plugin's always-on SessionStart injection and makes rarely used superpowers/ponytail skills invoke-only. It re-applies itself after plugin updates. |

Settings changes, merged into `~/.claude/settings.json` (a backup is saved as `settings.json.kit-bak`):

| Setting | Value | Why |
|---|---|---|
| `autoCompactWindow` | 250000 | Current models default to a 1M window, so without this a turn can re-send up to 1M tokens |
| `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` | 100000 | Compacts idle sessions that are already large |
| `BASH_MAX_OUTPUT_LENGTH` | 10000 | Long command output stays in context forever |
| `API_TIMEOUT_MS` | 1200000 | On a slow uplink, a turn waits instead of failing |
| `CLAUDE_CODE_MAX_RETRIES` | 15 | Network blips retry instead of ending the turn |
| `cleanupPeriodDays` | 14 | Old transcripts stop piling up |
| `skillOverrides` | `name-only` for rarely used skills | Their descriptions leave the every-turn skill list. Anything you already set is kept. |

## Slow internet: cap Claude's upload (Windows)

If your upload is around 2-5 Mbps, cap Claude Code so the rest of the machine keeps some headroom. Run this in an **admin** PowerShell, with the number set to about 70% of your measured upload:

```
New-NetQosPolicy -Name "ClaudeUpload" -AppPathNameMatchCondition "claude.exe" -ThrottleRateActionBitsPerSecond 3MB -PolicyStore ActiveStore
```

Undo it with:

```
Remove-NetQosPolicy -Name ClaudeUpload -PolicyStore ActiveStore -Confirm:$false
```

To measure your upload with the line idle:

```
curl -s -o /dev/null -w "%{speed_upload} B/s\n" -X POST --data-binary @somefile https://speed.cloudflare.com/__up
```

## The parts a script can't do

Trimming `MEMORY.md` files and moving project rules behind `paths:` frontmatter means reading them first. [PROMPT.md](PROMPT.md) is a prompt you paste into one Claude Code session to do that work.

## Requirements and tests

- Node 20+ and Claude Code.
- `ffmpeg` and `ffprobe` on PATH for the image hook. On macOS the installer runs `brew install ffmpeg`. Without them, images pass through unchanged.
- `npm test` runs the installer and hook tests.

## License

MIT
