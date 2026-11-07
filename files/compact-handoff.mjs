#!/usr/bin/env node
// The automated "handoff → clear → carry on". No hook can run /clear, but auto-compact
// already does clear-and-continue in place; this makes the summary a real handoff.
//   PreCompact  (auto|manual): stdout becomes the summary instructions (docs: hooks.md).
//   PostCompact: the summary is saved to ~/.claude/state/handoffs/<date>-<session>.md so a
//                fresh session (or a crashed one) can pick it up: "read the latest handoff".
// Never blocks: a failed write must not stop compaction.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.claude', 'state', 'handoffs');

export const INSTRUCTIONS = `Write this summary as a HANDOFF to a fresh session that must continue without asking the user anything. Sections, in order, terse:
1. Goal: the user's ask in their own words, plus every decision/constraint they stated (keep exact quotes for anything they corrected).
2. Done: what is finished and VERIFIED (name the check that proved it), with file paths, branches, commits.
3. In progress: the exact next step, the file and line it touches, and what was about to be run.
4. Open: unanswered questions to the user, known bugs, failed attempts and WHY they failed (so they are not retried).
5. Running: background jobs, subagents, watchers, builds, devices in use, and whether each should be stopped.
Drop: raw tool output, file dumps, screenshots and their descriptions, search results already acted on, and narration. Keep paths and identifiers exact.`;

export function handoffPath(sessionId, now = new Date()) {
  const d = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return path.join(DIR, `${d}-${String(sessionId || 'unknown').slice(0, 8)}.md`);
}

export function prune(keep = 50) {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(DIR, f), { force: true });
}

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// SessionStart(startup|clear): the newest handoff for THIS folder from the last 48h, if any.
// Only a pointer goes into context (one line), never the handoff itself.
export function latestHandoff(cwd, now = Date.now(), dir = DIR) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse(); } catch { return null; }
  for (const f of files) {
    const p = path.join(dir, f);
    if (now - fs.statSync(p).mtimeMs > 48 * 3600e3) return null; // sorted newest first
    const first = fs.readFileSync(p, 'utf8').split('\n', 1)[0];
    if (norm(first.replace(/^# Handoff — /, '')) === norm(cwd)) return p;
  }
  return null;
}

async function main() {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  const input = JSON.parse(raw || '{}');
  if (input.hook_event_name === 'SessionStart') {
    const p = latestHandoff(input.cwd);
    if (p) process.stdout.write(`A handoff from an earlier session in this folder exists: ${p} (${new Date(fs.statSync(p).mtimeMs).toISOString().slice(0, 16)}). Read it only if the user's task continues that work.`);
    return;
  }
  if (input.hook_event_name === 'PreCompact') {
    const extra = input.custom_instructions ? `\nUser's own focus for this compact: ${input.custom_instructions}` : '';
    process.stdout.write(INSTRUCTIONS + extra);
    return;
  }
  if (input.hook_event_name === 'PostCompact' && input.compact_summary) {
    fs.mkdirSync(DIR, { recursive: true });
    const header = `# Handoff — ${input.cwd || ''}\n\nsession ${input.session_id} · ${input.trigger || ''} · ${new Date().toISOString()}\n\n`;
    fs.writeFileSync(handoffPath(input.session_id), header + input.compact_summary);
    prune();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  main().catch(() => process.exit(0));
}
