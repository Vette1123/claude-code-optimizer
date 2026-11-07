#!/usr/bin/env node
// claude-code-optimizer: cuts Claude Code token use and upload bandwidth in ~/.claude
// (macOS, Linux, Windows). Idempotent: a second run reports 0 changes. Never touches the model.
//
//   node install.mjs                      apply, print every change
//   node install.mjs --dry-run            print what would change, write nothing
//   node install.mjs --plugin-overrides   also patch superpowers/ponytail skills to invoke-only
//   node install.mjs --pack               (maintainer) refresh ./files from ~/.claude
//
// Limits: judgment work (trimming MEMORY.md, path-scoping each repo's rules) is not
// scriptable; PROMPT.md is the paste-in for a Claude Code session.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KIT = path.dirname(path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const FILES = path.join(KIT, 'files');

export const SCRIPTS = ['shrink-image-read', 'explore-nudge', 'compact-handoff', 'plugin-overrides', 'mcp-toggle', 'usage-report']
  .flatMap((n) => [`${n}.mjs`, `${n}.test.mjs`]).filter((f) => f !== 'mcp-toggle.test.mjs');

export const ENV = {
  BASH_MAX_OUTPUT_LENGTH: '10000',
  CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '100000',
  API_TIMEOUT_MS: '1200000', // slow uplink: a 20-min header wait instead of a failed turn
  CLAUDE_CODE_MAX_RETRIES: '15',
};
export const TOP = { autoCompactWindow: 250000, cleanupPeriodDays: 14 };
// Skills that rarely fire on their own: the name stays listed, the description leaves the
// every-turn catalog. A name you don't have installed is harmless.
export const NAME_ONLY = ['ask-sonner', 'animation-vocabulary', 'mobile-native', 'pick-ui-library', 'prototype',
  'write-swift', 'improve-animations', 'review-animations', 'find-animation-opportunities', 'icm-architect',
  'anthropic-skills:built-in-browser', 'anthropic-skills:computer-use', 'anthropic-skills:deep-research',
  'anthropic-skills:google-workspace', 'anthropic-skills:setup-writing-style', 'simplify', 'plugin-authoring'];
// Re-applies the plugin patches after an update lands in a new version directory.
export const PLUGIN_HOOK = { event: 'SessionStart', matcher: 'startup|resume|clear|compact', script: 'plugin-overrides.mjs', args: ' --hook', timeout: 10 };
export const HOOKS = [
  { event: 'SessionStart', matcher: 'startup|clear', script: 'compact-handoff.mjs', timeout: 10 },
  { event: 'PreToolUse', matcher: 'Read|mcp__claude-in-chrome__computer', script: 'shrink-image-read.mjs', timeout: 15 },
  { event: 'PreToolUse', matcher: 'Read|Grep|Glob|Bash|PowerShell|Edit|Write|NotebookEdit|Agent', script: 'explore-nudge.mjs', timeout: 15 },
  { event: 'PreCompact', matcher: 'auto|manual', script: 'compact-handoff.mjs', timeout: 15 },
  { event: 'PostCompact', matcher: 'auto|manual', script: 'compact-handoff.mjs', timeout: 15 },
];
// Appended to ~/.claude/CLAUDE.md only when the marker is absent; the file is never replaced.
export const CLAUDE_MD_BLOCKS = [
  { marker: 'mcp-toggle.mjs', text: '**Heavy MCP servers are on demand** (each connected server costs its tool names on every turn).\nNeed one → `node ~/.claude/mcp-toggle.mjs <name> on`, ask me to `/exit` + `claude -c`, `<name> off` after.' },
];

// Pure: returns the change list and mutates `s` in place.
export function mergeSettings(s, claudeDir, { pluginOverrides = false } = {}) {
  const changes = [];
  s.env ??= {};
  for (const [k, v] of Object.entries(ENV)) {
    if (s.env[k] !== v) { changes.push(`env.${k} ${s.env[k] ?? '(unset)'} → ${v}`); s.env[k] = v; }
  }
  for (const [k, v] of Object.entries(TOP)) {
    if (s[k] !== v) { changes.push(`${k} ${s[k] ?? '(unset)'} → ${v}`); s[k] = v; }
  }
  s.skillOverrides ??= {};
  for (const k of NAME_ONLY) {
    if (!(k in s.skillOverrides)) { changes.push(`skillOverrides.${k} → name-only`); s.skillOverrides[k] = 'name-only'; }
  }
  s.hooks ??= {};
  const dir = claudeDir.replace(/\\/g, '/');
  for (const h of pluginOverrides ? [PLUGIN_HOOK, ...HOOKS] : HOOKS) {
    const groups = (s.hooks[h.event] ??= []);
    const has = groups.some((g) => g.matcher === h.matcher && (g.hooks || []).some((x) => x.command?.includes(h.script)));
    if (has) continue;
    const entry = { type: 'command', command: `node "${dir}/${h.script}"${h.args || ''}`, timeout: h.timeout };
    const group = groups.find((g) => g.matcher === h.matcher);
    if (group) group.hooks.push(entry);
    else groups.push({ matcher: h.matcher, hooks: [entry] });
    changes.push(`hook ${h.event}(${h.matcher}) → ${h.script}`);
  }
  return changes;
}

function writeIfDifferent(dest, content, dry, changes, why) {
  if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === content) return;
  changes.push(`${why}: ${dest}`);
  if (dry) return;
  if (fs.existsSync(dest) && !fs.existsSync(dest + '.kit-bak')) fs.copyFileSync(dest, dest + '.kit-bak');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

export function install({ home = os.homedir(), files = FILES, dry = false, pluginOverrides = false, log = console.log } = {}) {
  const cd = path.join(home, '.claude');
  const changes = [];
  for (const f of SCRIPTS) writeIfDifferent(path.join(cd, f), fs.readFileSync(path.join(files, f), 'utf8'), dry, changes, 'script');

  const md = path.join(cd, 'CLAUDE.md');
  const text = fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '';
  const missing = CLAUDE_MD_BLOCKS.filter((b) => !text.includes(b.marker));
  const lead = text ? text.replace(/\s*$/, '\n\n') : '';
  if (missing.length) writeIfDifferent(md, lead + missing.map((b) => b.text).join('\n\n') + '\n', dry, changes, 'CLAUDE.md lines');

  const sf = path.join(cd, 'settings.json');
  const s = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : {};
  const sc = mergeSettings(s, cd, { pluginOverrides });
  if (sc.length) {
    changes.push(...sc.map((c) => `settings: ${c}`));
    if (!dry) {
      if (fs.existsSync(sf) && !fs.existsSync(sf + '.kit-bak')) fs.copyFileSync(sf, sf + '.kit-bak');
      fs.writeFileSync(sf, JSON.stringify(s, null, 2) + '\n');
      JSON.parse(fs.readFileSync(sf, 'utf8')); // assert the write is valid JSON
    }
  }

  if (pluginOverrides && !dry) {
    const out = execFileSync('node', [path.join(cd, 'plugin-overrides.mjs')], { encoding: 'utf8' });
    if (/patched/.test(out)) changes.push(`plugin overrides applied:\n${out.trimEnd()}`);
  }
  for (const c of changes) log(`  ${dry ? 'would ' : ''}${c}`);
  return changes;
}

function has(bin) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function pack() {
  const cd = path.join(os.homedir(), '.claude');
  fs.mkdirSync(FILES, { recursive: true });
  for (const f of SCRIPTS) fs.copyFileSync(path.join(cd, f), path.join(FILES, f));
  console.log(`packed ${SCRIPTS.length} files into ${FILES}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(KIT, 'install.mjs')) {
  if (process.argv.includes('--pack')) { pack(); process.exit(0); }
  const dry = process.argv.includes('--dry-run');
  if (!has('ffmpeg') || !has('ffprobe')) {
    if (process.platform === 'darwin' && !dry && has('brew')) {
      console.log('ffmpeg missing → brew install ffmpeg (the image shrink hook needs it)');
      execFileSync('brew', ['install', 'ffmpeg'], { stdio: 'inherit' });
    } else console.log('WARNING: ffmpeg/ffprobe not on PATH; the image shrink hook passes images through untouched until it is installed.');
  }
  const changes = install({ dry, pluginOverrides: process.argv.includes('--plugin-overrides') });
  console.log(`${changes.length} change(s)${dry ? ' (dry run, nothing written)' : ''}. Backups: *.kit-bak beside each changed file.`);
  if (!dry) {
    const cd = path.join(os.homedir(), '.claude');
    try {
      execFileSync('node', ['--test', ...SCRIPTS.filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(cd, f))], { stdio: 'ignore', cwd: cd });
      console.log('hook tests: pass');
    } catch { console.error('hook tests: FAILED, run: node --test ~/.claude/*.test.mjs'); process.exitCode = 1; }
    console.log('Next: restart Claude Code, then paste PROMPT.md into one session for the trims that need judgment.');
  }
}
