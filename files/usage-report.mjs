#!/usr/bin/env node
// Where the Claude limit went: tokens per day, per model, per session, and context per turn.
// Reads ~/.claude/projects/**/*.jsonl line by line (transcripts reach 600 MB; never slurp).
//
//   node ~/.claude/usage-report.mjs            last 24h
//   node ~/.claude/usage-report.mjs --days 7   last 7 days, one row per day
//   node ~/.claude/usage-report.mjs --json
//
// "context/turn" is input + cache read + cache write per API call: what every turn re-sends.
// Limits: counts what transcripts record. claude.ai chat and other machines are not here,
// and a transcript deleted by cleanupPeriodDays is gone from the history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = path.join(os.homedir(), '.claude', 'projects');

export function addUsage(acc, u) {
  const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  acc.turns += 1;
  acc.ctx += ctx;
  acc.out += u.output_tokens || 0;
  acc.maxCtx = Math.max(acc.maxCtx, ctx);
  return acc;
}
const blank = () => ({ turns: 0, ctx: 0, out: 0, maxCtx: 0 });
const M = (n) => `${(n / 1e6).toFixed(1)}M`;
const K = (n) => `${Math.round(n / 1e3)}k`;

function files(dir, since) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.jsonl') && fs.statSync(p).mtimeMs > since) out.push(p);
    }
  })(dir);
  return out;
}

export async function report(days, root = ROOT) {
  const since = Date.now() - days * 86400e3;
  const byDay = {}, byModel = {}, bySession = {};
  const total = blank();
  for (const f of files(root, since)) {
    const rel = path.relative(root, f);
    const key = rel.includes('subagents') ? `${path.dirname(path.dirname(rel))} (subagents)` : rel.replace(/\.jsonl$/, '');
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const t = Date.parse(j.timestamp);
      const u = j.message?.usage;
      if (!(t > since) || !u || j.message.model === '<synthetic>') continue;
      const day = new Date(t).toISOString().slice(0, 10);
      addUsage(total, u);
      addUsage((byDay[day] ??= blank()), u);
      addUsage((byModel[j.message.model] ??= blank()), u);
      addUsage((bySession[key] ??= blank()), u);
    }
  }
  return { days, total, byDay, byModel, bySession };
}

function print(r) {
  const avg = (a) => (a.turns ? K(a.ctx / a.turns) : '-');
  console.log(`Last ${r.days} day(s): ${M(r.total.ctx)} context tokens over ${r.total.turns} turns, ${avg(r.total)}/turn, ${M(r.total.out)} output`);
  console.log('\nBy day:');
  for (const [d, a] of Object.entries(r.byDay).sort()) console.log(`  ${d}  ${M(a.ctx).padStart(8)}  ${String(a.turns).padStart(6)} turns  ${avg(a)}/turn`);
  console.log('\nBy model:');
  for (const [m, a] of Object.entries(r.byModel).sort((x, y) => y[1].ctx - x[1].ctx)) console.log(`  ${m.padEnd(22)} ${M(a.ctx).padStart(8)}  ${Math.round((100 * a.ctx) / r.total.ctx)}%`);
  console.log('\nTop sessions:');
  for (const [s, a] of Object.entries(r.bySession).sort((x, y) => y[1].ctx - x[1].ctx).slice(0, 8)) {
    console.log(`  ${M(a.ctx).padStart(8)}  ${String(a.turns).padStart(5)} turns  ${avg(a)}/turn  max ${K(a.maxCtx)}  ${s.slice(0, 90)}`);
  }
  const big = Object.entries(r.bySession).filter(([, a]) => a.turns > 1000);
  console.log(big.length ? `\nWHAT TO DO: ${big.length} session(s) past 1000 turns; end them with a handoff and start fresh.` : '\nNo session past 1000 turns.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const i = process.argv.indexOf('--days');
  const days = i > 0 ? Number(process.argv[i + 1]) : 1;
  if (!(days > 0)) { console.error('--days needs a positive number'); process.exit(1); }
  const r = await report(days);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else print(r);
}
