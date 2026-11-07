// node --test ~/.claude/usage-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { report } from './usage-report.mjs';

test('sums context per day/model/session, skips synthetic and out-of-window rows', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  fs.mkdirSync(path.join(root, 'repo'));
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 5 * 86400e3).toISOString();
  const row = (ts, model, read) => JSON.stringify({ timestamp: ts, message: { model, usage: { input_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: 5 } } });
  fs.writeFileSync(path.join(root, 'repo', 's1.jsonl'), [row(now, 'opus', 1000), row(now, 'opus', 3000), row(now, '<synthetic>', 9e9), row(old, 'opus', 9e9), 'not json'].join('\n'));
  const r = await report(1, root);
  assert.equal(r.total.turns, 2);
  assert.equal(r.total.ctx, 4020);
  assert.equal(r.total.maxCtx, 3010);
  assert.equal(r.byModel.opus.turns, 2);
  assert.equal(Object.keys(r.bySession)[0], path.join('repo', 's1'));
});
