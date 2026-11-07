// node --test ~/.claude/shrink-image-read.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shouldShrink, shrink, probe, chromeScreenshotInput } from './shrink-image-read.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrink-'));
const phone = path.join(dir, 'capture.png');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1080x2400', '-frames:v', '1', phone]);

test('a phone capture is shrunk to the long-edge cap, aspect kept', () => {
  const out = shrink(phone, 1200);
  assert.ok(out && fs.existsSync(out));
  const { w, h } = probe(out);
  assert.equal(h, 1200);
  assert.equal(w, 540);
});

test('the copy is a JPEG', () => {
  assert.match(shrink(phone, 1200), /\.jpg$/);
});

test('a small PNG under the cap is left alone', () => {
  assert.equal(shrink(phone, 4000), null);
});

test('a heavy PNG under the cap is still re-encoded: bytes, not pixels, fill the uplink', () => {
  const heavy = path.join(dir, 'heavy.png');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'gradients=s=800x1100,noise=alls=12:allf=t', '-frames:v', '1', heavy]);
  assert.ok(fs.statSync(heavy).size > 300e3);
  const out = shrink(heavy, 1200);
  assert.match(out, /\.jpg$/);
  assert.equal(probe(out).h, 1100);
  assert.ok(fs.statSync(out).size < fs.statSync(heavy).size / 2);
});

test('marketing/store art and opt-out stay full size; non-images ignored', () => {
  assert.equal(shouldShrink('C:/x/marketing/announce/card.png'), false);
  assert.equal(shouldShrink('C:/x/store/screens/a.png'), false);
  assert.equal(shouldShrink(phone, { CLAUDE_FULL_IMAGES: '1' }), false);
  assert.equal(shouldShrink('C:/x/src/app.tsx'), false);
  assert.equal(shouldShrink(phone, {}), true);
});

test('Chrome screenshots get a scale; zoom, explicit scale, other actions and opt-out do not', () => {
  const t = 'mcp__claude-in-chrome__computer';
  assert.deepEqual(chromeScreenshotInput(t, { action: 'screenshot', tabId: 1 }, {}), { action: 'screenshot', tabId: 1, scale: 0.6 });
  assert.equal(chromeScreenshotInput(t, { action: 'screenshot', tabId: 1, scale: 1 }, {}), null);
  assert.equal(chromeScreenshotInput(t, { action: 'zoom', tabId: 1 }, {}), null);
  assert.equal(chromeScreenshotInput(t, { action: 'left_click', tabId: 1 }, {}), null);
  assert.equal(chromeScreenshotInput(t, { action: 'screenshot' }, { CLAUDE_FULL_IMAGES: '1' }), null);
  assert.equal(chromeScreenshotInput('Read', { action: 'screenshot' }, {}), null);
});

test('the hook rewrites file_path end to end', () => {
  const hook = new URL('./shrink-image-read.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const stdout = execFileSync('node', [hook], { input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: phone } }), encoding: 'utf8' });
  const out = JSON.parse(stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.notEqual(out.updatedInput.file_path, phone);
  assert.equal(probe(out.updatedInput.file_path).h, 1200);
});
