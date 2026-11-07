// node --test ~/.claude/compact-handoff.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INSTRUCTIONS, latestHandoff } from './compact-handoff.mjs';

const hook = new URL('./compact-handoff.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const run = (input, env = {}) => execFileSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });

test('PreCompact prints the handoff instructions, under the 10k cap, with the user focus', () => {
  const out = run({ hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: 'keep the SQL' });
  assert.ok(out.startsWith('Write this summary as a HANDOFF'));
  assert.ok(out.includes('keep the SQL'));
  assert.ok(INSTRUCTIONS.length < 10000);
});

test('PostCompact saves the summary to a handoff file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  run({ hook_event_name: 'PostCompact', session_id: 'abcdef123456', cwd: 'C:/x', trigger: 'auto', compact_summary: 'Goal: ship it' }, { USERPROFILE: home, HOME: home });
  const dir = path.join(home, '.claude', 'state', 'handoffs');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /abcdef12\.md$/);
  assert.match(fs.readFileSync(path.join(dir, files[0]), 'utf8'), /Goal: ship it/);
});

test('SessionStart points at the newest handoff for the same folder only', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const env = { USERPROFILE: home, HOME: home };
  run({ hook_event_name: 'PostCompact', session_id: 'aaaa1111', cwd: 'C:\\Repo\\a', compact_summary: 'A' }, env);
  assert.match(run({ hook_event_name: 'SessionStart', source: 'startup', cwd: 'c:/repo/a/' }, env), /aaaa1111\.md.*continues that work/);
  assert.equal(run({ hook_event_name: 'SessionStart', source: 'startup', cwd: 'C:\\Repo\\b' }, env), '');
});

test('a handoff older than 48h is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-'));
  const p = path.join(dir, '2026-01-01-00-00-old.md');
  fs.writeFileSync(p, '# Handoff — C:/x\n');
  const old = (Date.now() - 49 * 3600e3) / 1000;
  fs.utimesSync(p, old, old);
  assert.equal(latestHandoff('C:/x', Date.now(), dir), null);
  assert.equal(latestHandoff('C:/x', Date.now() - 2 * 3600e3 - 47 * 3600e3, dir), p);
});

test('bad input never throws out of the hook', () => {
  assert.equal(execFileSync('node', [hook], { input: 'not json', encoding: 'utf8' }), '');
});
