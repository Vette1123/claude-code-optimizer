#!/usr/bin/env node
// PreToolUse(Read) hook: when Claude reads a big screenshot, hand it a copy whose long edge
// is MAX_EDGE px. A phone capture (1080x2400) costs ~1.5k tokens and is re-read on every
// later turn until compaction; at 1200px it costs ~0.85k. Marketing/store art is left
// full size because those checks are about sharpness. Any failure → Read runs untouched.
//
// Opt out for one session: CLAUDE_FULL_IMAGES=1. Knob: CLAUDE_IMAGE_MAX_EDGE (default 1200).
// ponytail: cache in ~/.claude/cache/shrunk grows unbounded; files older than 3 days are
// pruned on each run, which is enough at ~100 KB a capture.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_EDGE = Number(process.env.CLAUDE_IMAGE_MAX_EDGE) || 1200;
const FULL_SIZE_PATHS = /[\\/](marketing|store|announce|showcase|press|brand)[\\/]/i;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const CACHE = path.join(os.homedir(), '.claude', 'cache', 'shrunk');

export function shouldShrink(file, env = process.env) {
  if (!file || env.CLAUDE_FULL_IMAGES === '1') return false;
  if (!IMAGE_EXT.test(file)) return false;
  return !FULL_SIZE_PATHS.test(file);
}

// Claude in Chrome screenshots: the tool takes `scale` (0.1–1; 0.5 ≈ a quarter of the tokens)
// and keeps click coordinates in the full-size frame, so scaling costs no accuracy. Only a
// plain `screenshot` with no scale of its own; `zoom` is the deliberate close look, left alone.
export const CHROME_SCALE = Number(process.env.CLAUDE_CHROME_SCALE) || 0.6;
export function chromeScreenshotInput(toolName, toolInput, env = process.env) {
  if (toolName !== 'mcp__claude-in-chrome__computer' || env.CLAUDE_FULL_IMAGES === '1') return null;
  if (toolInput?.action !== 'screenshot' || toolInput.scale != null) return null;
  return { ...toolInput, scale: CHROME_SCALE };
}

export function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], { encoding: 'utf8' });
  const [w, h] = out.trim().split('x').map(Number);
  return { w, h };
}

// Every turn re-uploads the whole conversation, images included, and images were 85% of
// transcript bytes (2026-11-07). On a 2 Mbps uplink that is what saturated the line, so the
// copy is a JPEG (a 1200px phone capture: PNG 749 KB → JPEG q3 84 KB) and an under-cap PNG
// heavier than HEAVY_BYTES is re-encoded too. Knob: CLAUDE_IMAGE_HEAVY_KB.
const HEAVY_BYTES = (Number(process.env.CLAUDE_IMAGE_HEAVY_KB) || 300) * 1e3;

export function shrink(file, maxEdge = MAX_EDGE) {
  const { w, h } = probe(file);
  const st = fs.statSync(file);
  const tooBig = Math.max(w, h) > maxEdge;
  const heavy = /\.png$/i.test(file) && st.size > HEAVY_BYTES;
  if (!tooBig && !heavy) return null;
  const key = createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtimeMs}|${maxEdge}`).digest('hex').slice(0, 16);
  fs.mkdirSync(CACHE, { recursive: true });
  const out = path.join(CACHE, `${path.basename(file, path.extname(file))}-${key}.jpg`);
  if (!fs.existsSync(out)) {
    const args = ['-v', 'error', '-y', '-i', file];
    if (tooBig) args.push('-vf', `scale=${w >= h ? `${maxEdge}:-2` : `-2:${maxEdge}`}:flags=lanczos`);
    execFileSync('ffmpeg', [...args, '-q:v', '3', out]);
  }
  return out;
}

function prune() {
  const cutoff = Date.now() - 3 * 86400e3;
  for (const f of fs.readdirSync(CACHE, { withFileTypes: true })) {
    const p = path.join(CACHE, f.name);
    if (f.isFile() && fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
  }
}

async function main() {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  const input = JSON.parse(raw);
  const scaled = chromeScreenshotInput(input.tool_name, input.tool_input);
  if (scaled) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: scaled,
      additionalContext: `Screenshot scaled to ${CHROME_SCALE} for viewing only. If it will be uploaded or shared (upload_image, a PR, Slack, a ticket), retake it with scale: 1.` } }));
    return;
  }
  const file = input.tool_input?.file_path;
  if (input.tool_name !== 'Read' || !shouldShrink(file)) return;
  const out = shrink(file);
  try { prune(); } catch { /* cache hygiene only */ }
  if (!out) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...input.tool_input, file_path: out },
      additionalContext: `Image re-encoded as JPEG, long edge capped at ${MAX_EDGE}px, to save context and upload (original: ${file}). This copy is for viewing only: anything uploaded or shared (a PR, Slack, a ticket, a store listing) uses the original path at full quality. Set CLAUDE_FULL_IMAGES=1 for full size.`,
    },
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  main().catch(() => process.exit(0));
}
