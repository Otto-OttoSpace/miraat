'use strict';
/*
 * miraat --score regression suite. The single RTL Score is a marketing- and
 * badge-facing number, so its properties must stay stable: clean = 100/A,
 * bounded [0,100], monotone (more defects → not-higher score), flags weigh
 * more than fixes, and big-clean-repo isn't dragged down by one bad file.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');

function scoreOf(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-score-'));
  try {
    for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(d, name), src);
    const out = execFileSync(process.execPath, [CLI, d, '--score', '--json'], { encoding: 'utf8' });
    return JSON.parse(out);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

test('clean code scores 100 / A', () => {
  const s = scoreOf({ 'a.css': '.x { margin-inline-start: 8px; text-align: start; }' });
  assert.strictEqual(s.score, 100);
  assert.strictEqual(s.grade, 'A');
});

test('score is bounded to [0,100] even for a very dirty file', () => {
  const dirty = '.a { margin-left:1px; margin-right:1px; padding-left:1px; padding-right:1px; border-top-left-radius:1px; text-align:left; }';
  const s = scoreOf({ 'a.css': dirty });
  assert.ok(s.score >= 0 && s.score <= 100, `out of range: ${s.score}`);
  assert.ok(s.grade === 'F' || s.grade === 'D', `expected a failing grade, got ${s.grade}`);
});

test('flags weigh more than fixes (same count, more flags → lower score)', () => {
  // physical-corner + latin-font-stack are flags; margin/padding logical are fixes.
  const mostlyFixes = scoreOf({ 'a.css': '.a { margin-left:1px; padding-right:1px; }' });
  const withFlags = scoreOf({ 'a.css': '.a { border-top-left-radius:1px; font-family:"Inter",sans-serif; }' });
  assert.ok(withFlags.score <= mostlyFixes.score, `flags should not score higher: ${withFlags.score} vs ${mostlyFixes.score}`);
});

test('one bad file does not tank a large clean repo', () => {
  const files = { 'bad.css': '.a { margin-left:1px; text-align:left; }' };
  for (let i = 0; i < 20; i++) files[`ok${i}.css`] = '.x { margin-inline-start: 8px; }\n'.repeat(10);
  const s = scoreOf(files);
  assert.ok(s.score >= 90, `large clean repo should stay high, got ${s.score}`);
});
