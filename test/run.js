'use strict';
/*
 * rtlint regression suite (node --test).
 *
 * For every case under test/corpus/<case>/ it asserts, end-to-end through the
 * real CLI binary:
 *   1. `--json` scan findings (normalized) deep-equal  expected.findings.json
 *   2. `--fix` output byte-equals                       expected.fixed.<ext>
 *   3. re-running `--fix` is byte-stable (idempotent)
 *   4. fp-* cases: fixed output byte-equals the INPUT (nothing valid corrupted)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'rtlint.js');
const CORPUS = path.join(__dirname, 'corpus');

function runCli(args) {
  try { return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + ''; } // CLI exits 1 when flags remain
}

function scanFindings(file) {
  const out = JSON.parse(runCli([file, '--json']) || '{}');
  return (out.findings || [])
    .map(f => ({ rule: f.rule, sev: f.sev, line: f.line, from: f.from, to: f.to }))
    .sort((a, b) =>
      a.line - b.line || a.sev.localeCompare(b.sev) || a.rule.localeCompare(b.rule) ||
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function fixCopy(inputPath, ext) {
  const tmp = path.join(os.tmpdir(), `rtlint-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.copyFileSync(inputPath, tmp);
  runCli([tmp, '--fix']);
  const once = fs.readFileSync(tmp, 'utf8');
  runCli([tmp, '--fix']);
  const twice = fs.readFileSync(tmp, 'utf8');
  fs.unlinkSync(tmp);
  return { once, twice };
}

const cases = fs.readdirSync(CORPUS)
  .filter(c => fs.statSync(path.join(CORPUS, c)).isDirectory())
  .sort();

assert.ok(cases.length >= 12, `expected the seeded corpus, found ${cases.length} cases`);

for (const name of cases) {
  const dir = path.join(CORPUS, name);
  const input = fs.readdirSync(dir).find(f => f.startsWith('input.'));
  const ext = path.extname(input);
  const inputPath = path.join(dir, input);

  test(`${name}: scan findings match`, () => {
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.findings.json'), 'utf8'));
    assert.deepStrictEqual(scanFindings(inputPath), expected);
  });

  test(`${name}: --fix output byte-equals expected`, () => {
    const expectedFixed = fs.readFileSync(path.join(dir, `expected.fixed${ext}`), 'utf8');
    const { once } = fixCopy(inputPath, ext);
    assert.strictEqual(once, expectedFixed);
  });

  test(`${name}: --fix is idempotent (byte-stable)`, () => {
    const { once, twice } = fixCopy(inputPath, ext);
    assert.strictEqual(twice, once, 're-running --fix must be a byte-stable no-op');
  });

  // Any fixture whose expected output equals its input (all pure false-positive
  // and flag-only cases) must be left byte-for-byte untouched by --fix.
  const inputSrc = fs.readFileSync(inputPath, 'utf8');
  const expectedFixed = fs.readFileSync(path.join(dir, `expected.fixed${ext}`), 'utf8');
  if (expectedFixed === inputSrc) {
    test(`${name}: valid code is left byte-unchanged by --fix`, () => {
      const { once } = fixCopy(inputPath, ext);
      assert.strictEqual(once, inputSrc, 'this fixture must never be modified by --fix');
    });
  }
}
