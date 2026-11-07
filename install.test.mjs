// node --test install.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, mergeSettings, HOOKS, SCRIPTS } from './install.mjs';

const files = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'files');
const quiet = { log: () => {} };

test('merge keeps the owner settings (model, existing overrides) and is idempotent', () => {
  const s = { model: 'opus', skillOverrides: { simplify: 'off' }, env: { FOO: '1' } };
  assert.ok(mergeSettings(s, '/Users/x/.claude').length > 0);
  assert.equal(s.model, 'opus');
  assert.equal(s.skillOverrides.simplify, 'off');
  assert.equal(s.env.FOO, '1');
  assert.equal(s.env.API_TIMEOUT_MS, '1200000');
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.match(s.hooks.PreToolUse[0].hooks[0].command, /^node "\/Users\/x\/\.claude\/shrink-image-read\.mjs"$/);
  assert.deepEqual(mergeSettings(s, '/Users/x/.claude'), []);
});

test('plugin patches are opt-in: no plugin hook unless asked', () => {
  const plain = {};
  mergeSettings(plain, '/h/.claude');
  assert.ok(!JSON.stringify(plain.hooks).includes('plugin-overrides'));
  const opted = {};
  mergeSettings(opted, '/h/.claude', { pluginOverrides: true });
  assert.match(opted.hooks.SessionStart[0].hooks[0].command, /plugin-overrides\.mjs" --hook$/);
});

test('fresh home: everything installs, second run is a no-op, existing CLAUDE.md is appended, not replaced', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# My rules\n');
  const first = install({ home, files, ...quiet });
  assert.ok(first.length >= SCRIPTS.length + HOOKS.length);
  for (const f of SCRIPTS) assert.ok(fs.existsSync(path.join(home, '.claude', f)), f);
  const md = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.match(md, /^# My rules\n\n/);
  assert.match(md, /mcp-toggle\.mjs/);
  assert.deepEqual(install({ home, files, ...quiet }), []);
});
