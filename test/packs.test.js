'use strict';
/*
 * Rule-pack umbrella regression suite. `miraat` dispatches to sibling packs via
 * subcommands (see CONSOLIDATION-PLAN.md). These lock: help lists the packs,
 * each subcommand reaches the right pack, `all` runs every pack, and the bare
 * `miraat <path>` RTL scan is UNCHANGED by the dispatcher.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');
function run(args) {
  try { return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}
function tmpCss() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-packs-'));
  fs.writeFileSync(path.join(d, 'a.css'), '.x { margin-inline-start: 8px; text-align: start; }');
  return d;
}

test('help lists the rule-packs', () => {
  const o = run(['--help']);
  for (const p of ['type', 'i18n', 'a11y', 'all']) assert.match(o, new RegExp('miraat ' + p));
});

test('miraat type dispatches to kashida', () => {
  const d = tmpCss();
  const o = run(['type', d]);
  fs.rmSync(d, { recursive: true, force: true });
  assert.match(o, /kashida/i);
});

test('miraat all runs every pack', () => {
  const d = tmpCss();
  const o = run(['all', d]);
  fs.rmSync(d, { recursive: true, force: true });
  for (const s of ['rtl', 'type', 'i18n', 'a11y']) assert.match(o, new RegExp('── ' + s));
});

test('bare path still runs the RTL scan (dispatcher is additive)', () => {
  const d = tmpCss();
  const o = run([d]);
  fs.rmSync(d, { recursive: true, force: true });
  assert.match(o, /miraat v/);
  assert.doesNotMatch(o, /kashida/i);
});

test('--badge emits a valid SVG carrying the score', () => {
  const d = tmpCss();
  const o = run([d, '--badge']);
  fs.rmSync(d, { recursive: true, force: true });
  assert.match(o.trim(), /^<svg[\s\S]*<\/svg>$/);
  assert.match(o, /aria-label="Miraat RTL: 100 A"/);
});
