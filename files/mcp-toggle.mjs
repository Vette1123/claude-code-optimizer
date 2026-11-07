#!/usr/bin/env node
// On-demand MCP servers. A connected server lists every tool NAME in each session's context
// (rea: 207 names, ~1.7k tokens on every turn) even when deferred; Claude Code has no global
// "off by default" switch (docs: mcp.md, disabledMcpServers is per project). So a heavy,
// rarely used server lives here instead of in ~/.claude.json, and is added only when needed.
//
//   node ~/.claude/mcp-toggle.mjs status
//   node ~/.claude/mcp-toggle.mjs rea on     → add to user scope; then /exit and `claude -c`
//   node ~/.claude/mcp-toggle.mjs rea off    → remove from user scope (config kept here)
//
// Uses the official `claude mcp add-json/remove -s user` CLI, never a hand edit of
// ~/.claude.json, which running sessions rewrite.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STORE = path.join(os.homedir(), '.claude', 'mcp', 'on-demand.json');
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

const readStore = () => (fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : {});
const liveServers = () => JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')).mcpServers || {};
const claude = (args) => execFileSync(process.platform === 'win32' ? 'claude.exe' : 'claude', args, { encoding: 'utf8' });

function off(name) {
  const live = liveServers()[name];
  const store = readStore();
  if (live) {
    store[name] = live;
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');
    claude(['mcp', 'remove', '-s', 'user', name]);
  }
  if (!store[name]) throw new Error(`${name}: not live and not stored; nothing to turn off`);
  if (liveServers()[name]) throw new Error(`${name}: still in ~/.claude.json after remove`);
  console.log(`${name}: OFF (config kept in ${STORE})`);
}

function on(name) {
  const cfg = readStore()[name];
  if (!cfg) throw new Error(`${name}: no stored config in ${STORE}`);
  if (!liveServers()[name]) {
    const json = JSON.stringify(cfg);
    claude(['mcp', 'add-json', '-s', 'user', name, json]);
  }
  if (!liveServers()[name]) throw new Error(`${name}: add-json ran but it is not in ~/.claude.json`);
  console.log(`${name}: ON. Load it: /exit, then \`claude -c\` (same conversation). Turn off after: node ~/.claude/mcp-toggle.mjs ${name} off`);
}

const [a, b] = process.argv.slice(2);
try {
  if (!a || a === 'status') {
    const live = liveServers();
    for (const n of new Set([...Object.keys(readStore()), ...Object.keys(live)])) console.log(`${n}: ${live[n] ? 'ON' : 'off (on demand)'}`);
  } else if (b === 'on') on(a);
  else if (b === 'off') off(a);
  else throw new Error('usage: mcp-toggle.mjs status | <name> on | <name> off');
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
