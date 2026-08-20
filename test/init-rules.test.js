'use strict';
/*
 * miraat --init-rules (the AI-codegen "immune system") regression suite.
 * Asserts, through the real CLI: all agent config files are written, the key
 * rules are present, existing user content is never clobbered, and re-running
 * is idempotent (one marked block, always).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');
const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.windsurfrules', '.clinerules', '.github/copilot-instructions.md', 'RTL-RULES.md', '.cursor/rules/rtl.mdc'];

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-rules-'));
const run = dir => execFileSync(process.execPath, [CLI, dir, '--init-rules'], { encoding: 'utf8' });

test('init-rules: writes every AI-agent config file', () => {
  const d = tmp();
  try { run(d); for (const f of AGENT_FILES) assert.ok(fs.existsSync(path.join(d, f)), `missing ${f}`); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('init-rules: injects the key rules (bidi, shaping, frameworks, self-check loop)', () => {
  const d = tmp();
  try {
    run(d);
    const c = fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8');
    for (const needle of ['<bdi>', 'letter-spacing', 'React Native', 'Flutter', 'SwiftUI', 'npx miraat --check', 'miraat-mcp'])
      assert.ok(c.includes(needle), `rules missing "${needle}"`);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('init-rules: preserves existing user content (never clobbers)', () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# My project\nkeep this line\n');
    run(d);
    const c = fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8');
    assert.ok(c.includes('keep this line'), 'user content clobbered');
    assert.ok(c.includes('miraat:rtl-rules'), 'rule block not appended');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('init-rules: idempotent — re-run keeps exactly one block', () => {
  const d = tmp();
  try {
    run(d); run(d); run(d);
    const c = fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8');
    const count = (c.match(/miraat:rtl-rules —/g) || []).length;
    assert.strictEqual(count, 1, `expected 1 block, got ${count}`);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('init-rules: cursor .mdc carries valid frontmatter', () => {
  const d = tmp();
  try {
    run(d);
    const m = fs.readFileSync(path.join(d, '.cursor/rules/rtl.mdc'), 'utf8');
    assert.ok(m.startsWith('---'), 'cursor mdc missing frontmatter');
    assert.ok(m.includes('alwaysApply: true'), 'cursor mdc missing alwaysApply');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
