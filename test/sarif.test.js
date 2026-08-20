'use strict';
/*
 * miraat --sarif regression suite. Asserts, through the real CLI, that the
 * SARIF 2.1.0 log is structurally valid, maps fix→note / flag→warning, uses
 * forward-slash URIs, and exits 0 (it's an upload artifact, not a gate).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');

function sarifFor(source, filename) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-sarif-'));
  try {
    const file = path.join(d, filename);
    fs.writeFileSync(file, source);
    const out = execFileSync(process.execPath, [CLI, file, '--sarif'], { encoding: 'utf8' });
    return JSON.parse(out);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

test('sarif: valid 2.1.0 envelope with tool driver + rules', () => {
  const s = sarifFor('.x { margin-left: 8px; }', 'a.css');
  assert.strictEqual(s.version, '2.1.0');
  assert.ok(Array.isArray(s.runs) && s.runs.length === 1);
  const driver = s.runs[0].tool.driver;
  assert.strictEqual(driver.name, 'miraat');
  assert.ok(driver.rules.length >= 8, 'expected the full rule catalog');
  assert.ok(driver.rules.every(r => r.id && r.shortDescription && r.shortDescription.text));
});

test('sarif: fix→note, flag→warning, with a startLine location', () => {
  const s = sarifFor('.x { margin-left: 8px; font-family: "Inter", sans-serif; }', 'a.css');
  const byRule = Object.fromEntries(s.runs[0].results.map(r => [r.ruleId, r]));
  assert.strictEqual(byRule['css-logical'].level, 'note');        // mechanically safe
  assert.strictEqual(byRule['latin-font-stack'].level, 'warning'); // needs a human
  const loc = byRule['css-logical'].locations[0].physicalLocation;
  assert.ok(loc.region.startLine >= 1);
  assert.ok(!loc.artifactLocation.uri.includes('\\'), 'uri must use forward slashes');
});

test('sarif: clean input yields zero results and exits 0', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-sarif-'));
  try {
    const file = path.join(d, 'clean.css');
    fs.writeFileSync(file, '.x { margin-inline-start: 8px; text-align: start; }');
    const out = execFileSync(process.execPath, [CLI, file, '--sarif'], { encoding: 'utf8' });
    const s = JSON.parse(out);
    assert.strictEqual(s.runs[0].results.length, 0);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
