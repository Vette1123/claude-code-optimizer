#!/usr/bin/env node
// Plugin hooks we keep the plugin for, minus its always-on injection. Claude Code has no
// per-plugin hook switch (docs: hooks.md, "no way to disable an individual hook"), so the
// installed copy's hooks/hooks.json is patched. An update lands in a new version directory,
// so this runs from update-tools.mjs AND from SessionStart (heals the next session).
//
// superpowers: its SessionStart hook injects using-superpowers (~1.5k tokens, every turn)
// and pushes skill loads. The skills stay; invoke them by name (superpowers:brainstorming).
//
//   node ~/.claude/plugin-overrides.mjs           apply, print what changed
//   node ~/.claude/plugin-overrides.mjs --check   exit 1 if any override is missing
//   node ~/.claude/plugin-overrides.mjs --hook    apply silently (SessionStart)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// invokeOnlySkills: `disable-model-invocation: true` takes the description out of the
// every-turn skill catalog (docs: skills.md) and keeps /<plugin>:<skill> working. Only skills
// with zero model-initiated use in 30 days (usage-report, 2026-11-07); settings-level
// skillOverrides does not reach plugin skills, so this is the only switch.
export const OVERRIDES = {
  'superpowers@claude-plugins-official': {
    dropHookEvents: ['SessionStart'],
    invokeOnlySkills: ['using-superpowers', 'dispatching-parallel-agents', 'finishing-a-development-branch',
      'requesting-code-review', 'subagent-driven-development', 'using-git-worktrees',
      'verification-before-completion', 'diagnosing-superpowers', 'writing-skills'],
  },
  'ponytail@ponytail': {
    dropHookEvents: [],
    invokeOnlySkills: ['ponytail', 'ponytail-audit', 'ponytail-debt', 'ponytail-review', 'ponytail-gain', 'ponytail-help'],
  },
};

const INVOKE_ONLY = 'disable-model-invocation: true';

// Returns 'patched' | 'ok' | 'missing' | 'no-skill'.
export function invokeOnly(installPath, skill, { check = false } = {}) {
  const f = path.join(installPath, 'skills', skill, 'SKILL.md');
  if (!fs.existsSync(f)) return 'no-skill';
  const text = fs.readFileSync(f, 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm && /^disable-model-invocation:\s*true\s*$/m.test(fm[1])) return 'ok';
  if (check) return 'missing';
  if (!fm) throw new Error(`${f}: no frontmatter`);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const body = fm[1].replace(/^disable-model-invocation:.*$/m, '').replace(/(\r?\n)+$/, '');
  fs.writeFileSync(f, text.replace(fm[0], `---${nl}${body}${nl}${INVOKE_ONLY}${nl}---`));
  return 'patched';
}

export function installPaths(pluginsDir, id) {
  const file = path.join(pluginsDir, 'installed_plugins.json');
  if (!fs.existsSync(file)) return [];
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (j.plugins?.[id] || []).map((e) => e.installPath).filter((p) => p && fs.existsSync(p));
}

// Returns 'patched' | 'ok' | 'no-hooks'.
export function applyOne(installPath, events, { check = false } = {}) {
  const hooksFile = path.join(installPath, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksFile)) return 'no-hooks';
  const j = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  const present = events.filter((e) => j.hooks?.[e]);
  if (!present.length) return 'ok';
  if (check) return 'missing';
  const orig = hooksFile + '.orig';
  if (!fs.existsSync(orig)) fs.copyFileSync(hooksFile, orig);
  for (const e of present) delete j.hooks[e];
  fs.writeFileSync(hooksFile, JSON.stringify(j, null, 2) + '\n');
  return 'patched';
}

export function run(pluginsDir, { check = false, log = console.log } = {}) {
  const bad = [];
  for (const [id, o] of Object.entries(OVERRIDES)) {
    const paths = installPaths(pluginsDir, id);
    if (!paths.length) { log(`  ${id}: not installed, skipped`); continue; }
    for (const p of paths) {
      if (o.dropHookEvents.length) {
        const r = applyOne(p, o.dropHookEvents, { check });
        if (r === 'missing') bad.push(`${id}: ${o.dropHookEvents.join(',')} hook is back in ${p}`);
        log(`  ${id} (${path.basename(p)}) hooks: ${r}`);
      }
      const counts = {};
      for (const s of o.invokeOnlySkills || []) {
        const r = invokeOnly(p, s, { check });
        counts[r] = (counts[r] || 0) + 1;
        if (r === 'missing') bad.push(`${id}: ${s} is model-invocable again in ${p}`);
      }
      if (o.invokeOnlySkills?.length) log(`  ${id} (${path.basename(p)}) invoke-only skills: ${JSON.stringify(counts)}`);
    }
  }
  return bad;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const dir = path.join(os.homedir(), '.claude', 'plugins');
  const hook = process.argv.includes('--hook');
  try {
    const bad = run(dir, { check: process.argv.includes('--check'), log: hook ? () => {} : console.log });
    if (bad.length) { console.error(`FAILED:\n- ${bad.join('\n- ')}`); process.exit(1); }
  } catch (e) {
    if (!hook) { console.error(e.message); process.exit(1); }
  }
}
