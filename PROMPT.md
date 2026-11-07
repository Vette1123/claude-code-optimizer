# Paste-in prompt for the judgment work

`install.mjs` does the mechanical changes. Paste this into one Claude Code session afterwards for the parts that need reading:

```
Apply the usage optimisations that need judgment (install.mjs already did the mechanical ones):
1. Run `node ~/.claude/usage-report.mjs --days 7` and show me the top sessions and the context per turn.
2. For every ~/.claude/projects/*/memory/MEMORY.md over 1500 tokens (bytes/4): move cold lines verbatim to an ARCHIVE.md beside it, keep one terse line per hot entry, and add a pointer line to ARCHIVE.md. Delete nothing.
3. For every ~/.claude/rules/*.md that only matters for one kind of work, add `paths:` frontmatter so it loads only when matching files are touched, and add a one-line pointer to ~/.claude/CLAUDE.md.
4. Ask me which repos I work in. For each one, measure the always-loaded instruction text (CLAUDE.md plus @imports plus .claude/rules/*.md without paths:). If it is over 2k tokens, move feature-specific sections into .claude/rules/<topic>.md with paths: frontmatter, leave a one-line pointer list in CLAUDE.md, check that every non-blank old line still exists somewhere, then commit.
5. Run `node ~/.claude/mcp-toggle.mjs status` and move any MCP server I use less than weekly to on-demand with `mcp-toggle.mjs <name> off`.
6. Keep my default model as it is. Use at most 3 subagents, all on sonnet.
```
