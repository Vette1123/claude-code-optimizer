// node --test ~/.claude/explore-nudge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, step } from './explore-nudge.mjs';

test('classifies reads, read-only shell, edits', () => {
  assert.equal(classify('Read'), 'explore');
  assert.equal(classify('Bash', { command: 'sed -n 1,40p foo.ts' }), 'explore');
  assert.equal(classify('Bash', { command: 'cd "C:/x" && grep -n foo bar' }), 'explore');
  assert.equal(classify('Bash', { command: 'pnpm test' }), 'other');
  assert.equal(classify('Edit'), 'reset');
});

test('nudges on every Nth consecutive read, resets on edit', () => {
  let s = {}; const hits = [];
  for (let i = 1; i <= 7; i++) { const r = step(s, 'a', 'explore', 3); s = r.state; if (r.nudge) hits.push(r.run); }
  assert.deepEqual(hits, [3, 6]);
  s = step(s, 'a', 'reset', 3).state;
  assert.equal(s.a, 0);
  assert.equal(step(s, 'a', 'explore', 3).nudge, false);
});

test('0 disables; other tools neither count nor reset', () => {
  assert.equal(step({ a: 2 }, 'a', 'explore', 0).nudge, false);
  assert.equal(step({ a: 2 }, 'a', 'other', 3).state.a, 2);
});
