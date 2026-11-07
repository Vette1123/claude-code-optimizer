#!/usr/bin/env node
// PreToolUse hook: every NUDGE_AT read-only calls in a row (Read, Grep, Glob, read-only
// shell) in the MAIN session, remind Claude to hand the rest of the search to a Sonnet
// subagent. Every result read on Opus is re-read on every later turn; a subagent returns
// only its finding. An Edit/Write/Agent call resets the run. Never blocks anything.
// Knob: CLAUDE_EXPLORE_NUDGE_AT (default 12; 0 disables).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NUDGE_AT = Number(process.env.CLAUDE_EXPLORE_NUDGE_AT ?? 12);
const STATE = path.join(os.homedir(), '.claude', 'state', 'explore-nudge.json');
const READ_ONLY_SHELL = /^\s*(cd\s+\S+\s*(&&|;)\s*)?(cat|head|tail|sed -n|grep|rg|find|ls|wc|git (log|show|diff|grep|blame)|Get-Content|Select-String)\b/;
const RESETS = new Set(['Edit', 'Write', 'NotebookEdit', 'Agent']);

export function classify(toolName, toolInput = {}) {
  if (RESETS.has(toolName)) return 'reset';
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') return 'explore';
  if ((toolName === 'Bash' || toolName === 'PowerShell') && READ_ONLY_SHELL.test(toolInput.command || '')) return 'explore';
  return 'other';
}

export function step(state, sessionId, kind, nudgeAt = NUDGE_AT) {
  const run = kind === 'reset' ? 0 : (state[sessionId] || 0) + (kind === 'explore' ? 1 : 0);
  const next = { ...state, [sessionId]: run };
  const nudge = nudgeAt > 0 && kind === 'explore' && run % nudgeAt === 0;
  return { state: next, nudge, run };
}

async function main() {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  const input = JSON.parse(raw);
  if (input.agent_id) return; // a subagent exploring is exactly what we want
  const kind = classify(input.tool_name, input.tool_input);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* first run */ }
  const r = step(state, input.session_id || 'unknown', kind);
  const keys = Object.keys(r.state);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete r.state[k];
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(r.state));
  if (!r.nudge) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `${r.run} read-only calls in a row with no edit. If the search continues, hand it to ONE Agent (model: "sonnet", told not to spawn others) and keep only its finding; each result read here is re-read on every later Opus turn.`,
    },
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  main().catch(() => process.exit(0));
}
