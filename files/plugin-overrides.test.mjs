// node --test ~/.claude/plugin-overrides.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, invokeOnly } from './plugin-overrides.mjs';

function fakeInstall() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
  const inst = path.join(dir, 'cache', 'superpowers', '9.9.9');
  fs.mkdirSync(path.join(inst, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(inst, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{}], PreToolUse: [{}] } }));
  fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({ plugins: { 'superpowers@claude-plugins-official': [{ installPath: inst }] } }));
  return { dir, hooksFile: path.join(inst, 'hooks', 'hooks.json') };
}

test('check fails while the hook is present, apply drops only SessionStart, then check passes', () => {
  const { dir, hooksFile } = fakeInstall();
  const quiet = { log: () => {} };
  assert.equal(run(dir, { check: true, ...quiet }).length, 1);
  assert.deepEqual(run(dir, quiet), []);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks), ['PreToolUse']);
  assert.ok(fs.existsSync(hooksFile + '.orig'));
  assert.deepEqual(run(dir, { check: true, ...quiet }), []);
});

test('invoke-only: adds the flag once, keeps other frontmatter and CRLF, check catches a revert', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
  fs.mkdirSync(path.join(dir, 'skills', 'x'), { recursive: true });
  const f = path.join(dir, 'skills', 'x', 'SKILL.md');
  const orig = '---\r\nname: x\r\ndescription: does x\r\n---\r\n\r\n# X\r\n';
  fs.writeFileSync(f, orig);
  assert.equal(invokeOnly(dir, 'x', { check: true }), 'missing');
  assert.equal(invokeOnly(dir, 'x'), 'patched');
  assert.equal(invokeOnly(dir, 'x'), 'ok');
  assert.equal(fs.readFileSync(f, 'utf8'), '---\r\nname: x\r\ndescription: does x\r\ndisable-model-invocation: true\r\n---\r\n\r\n# X\r\n');
  fs.writeFileSync(f, orig); // an update brings the upstream file back
  assert.equal(invokeOnly(dir, 'x', { check: true }), 'missing');
  assert.equal(invokeOnly(dir, 'nope'), 'no-skill');
});

test('a plugin that is not installed is skipped, not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
  assert.deepEqual(run(dir, { log: () => {} }), []);
});
