'use strict';
/*
 * Governance suite — the "v1.0 adoptable" layer that lets a real repo turn
 * miraat on: config + per-rule severity + presets, inline-disable directives,
 * .gitignore/.miraatignore, and baseline (suppress-all / prune-suppressions).
 * These lock behaviour AND exit codes (the CI contract).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');

// Run the CLI, capturing stdout AND the exit status (execFileSync throws on ≠0).
function run(args) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    return { out, code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: typeof e.status === 'number' ? e.status : 1 };
  }
}
function json(args) { return JSON.parse(run(args.concat(['--json'])).out); }

function tmp(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-gov-'));
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(d, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return d;
}
const rm = d => fs.rmSync(d, { recursive: true, force: true });
const DIRTY = '.x { margin-left: 4px; }\n.y { text-align: left; }\n';   // 2 css-logical findings

// ---- config: per-rule severity ------------------------------------------------

test('rule set to "off" silences the finding (and passes --check)', () => {
  const d = tmp({ 'a.css': DIRTY, 'miraat.config.json': '{ "rules": { "css-logical": "off" } }' });
  const r = run([d, '--check']);
  rm(d);
  assert.equal(r.code, 0);
  assert.match(r.out, /clean/);
});

test('extends miraat:strict upgrades fixes to error → plain scan fails', () => {
  const d = tmp({ 'a.css': DIRTY, 'miraat.config.json': '{ "extends": "miraat:strict" }' });
  const r = run([d]);          // plain scan (no --check)
  rm(d);
  assert.equal(r.code, 1, 'strict makes mechanical fixes error-level, so a plain scan fails');
  assert.match(r.out, /ERR/);
});

test('default (no config): a plain scan of fixable-only issues exits 0', () => {
  const d = tmp({ 'a.css': DIRTY });
  const r = run([d]);
  const j = json([d]);
  rm(d);
  assert.equal(r.code, 0, 'fixable issues are warn-level by default; plain scan does not fail');
  assert.equal(j.errors, 0);
  assert.equal(j.warnings, 2);
});

test('invalid severity is a hard config error (exit 2)', () => {
  const d = tmp({ 'a.css': DIRTY, 'miraat.config.json': '{ "rules": { "css-logical": "loud" } }' });
  const r = run([d]);
  rm(d);
  assert.equal(r.code, 2);
  assert.match(r.out, /invalid severity/);
});

test('--no-config ignores an on-disk config', () => {
  const d = tmp({ 'a.css': DIRTY, 'miraat.config.json': '{ "rules": { "css-logical": "off" } }' });
  const j = json([d, '--no-config']);
  rm(d);
  assert.equal(j.findings.length, 2, 'config bypassed → findings reappear');
});

// ---- inline-disable directives ------------------------------------------------

test('miraat-disable-next-line suppresses the next line only', () => {
  const d = tmp({ 'a.css': '/* miraat-disable-next-line css-logical */\n.x { margin-left: 4px; }\n.y { text-align: left; }\n' });
  const j = json([d]);
  rm(d);
  assert.equal(j.findings.length, 1, 'line 2 disabled, line 3 still reported');
  assert.equal(j.inlineDisabled, 1);
});

test('block miraat-disable / miraat-enable brackets a region', () => {
  const d = tmp({ 'a.css': '/* miraat-disable */\n.x { margin-left: 4px; }\n/* miraat-enable */\n.y { text-align: left; }\n' });
  const j = json([d]);
  rm(d);
  assert.equal(j.findings.length, 1);
  assert.equal(j.inlineDisabled, 1);
});

test('--report-unused-disable-directives flags a directive that matched nothing', () => {
  const d = tmp({ 'a.css': '/* miraat-disable-next-line css-logical */\n.x { color: red; }\n' });
  const r = run([d, '--report-unused-disable-directives']);
  rm(d);
  assert.match(r.out, /unused miraat-disable/i);
});

// ---- ignore files -------------------------------------------------------------

test('.miraatignore excludes a matching file', () => {
  const d = tmp({ 'a.css': DIRTY, 'vendor.css': DIRTY, '.miraatignore': 'vendor.css\n' });
  const j = json([d]);
  rm(d);
  assert.ok(j.findings.every(f => !f.file.endsWith('vendor.css')), 'vendor.css ignored');
  assert.equal(j.findings.length, 2, 'a.css still scanned');
});

test('.gitignore directory pattern prunes the subtree', () => {
  const d = tmp({ 'src/a.css': DIRTY, 'legacy/b.css': DIRTY, '.gitignore': 'legacy/\n' });
  const j = json([d]);
  rm(d);
  assert.ok(j.findings.every(f => !f.file.includes('legacy')), 'legacy/ pruned');
});

// ---- baseline -----------------------------------------------------------------

test('--suppress-all then --check passes; a NEW finding then fails', () => {
  const d = tmp({ 'a.css': DIRTY });
  assert.equal(run([d, '--suppress-all']).code, 0);
  assert.ok(fs.existsSync(path.join(d, 'miraat-baseline.json')));
  assert.equal(run([d, '--check']).code, 0, 'existing debt is baselined → check passes');

  // introduce a new violation in a new file
  fs.writeFileSync(path.join(d, 'b.css'), '.z { padding-left: 8px; }\n');
  const r = run([d, '--check']);
  rm(d);
  assert.equal(r.code, 1, 'NEW debt beyond the baseline fails --check');
});

test('--prune-suppressions shrinks the baseline after debt is fixed', () => {
  const d = tmp({ 'a.css': DIRTY });
  run([d, '--suppress-all']);
  fs.writeFileSync(path.join(d, 'a.css'), '.x { margin-inline-start: 4px; }\n.y { text-align: start; }\n'); // fixed
  const r = run([d, '--prune-suppressions']);
  const base = JSON.parse(fs.readFileSync(path.join(d, 'miraat-baseline.json'), 'utf8'));
  rm(d);
  assert.equal(r.code, 0);
  assert.deepEqual(base.counts, {}, 'all debt resolved → baseline empties');
});

// ---- cache --------------------------------------------------------------------

test('--cache writes .miraatcache and returns identical findings warm', () => {
  const d = tmp({ 'a.css': DIRTY });
  const cold = json([d, '--cache']);
  assert.ok(fs.existsSync(path.join(d, '.miraatcache')));
  const warm = json([d, '--cache']);
  rm(d);
  assert.equal(cold.findings.length, 2);
  assert.deepEqual(warm.findings.map(f => f.rule), cold.findings.map(f => f.rule), 'cached run matches cold run');
});

test('--cache invalidates a file when its content changes', () => {
  const d = tmp({ 'a.css': DIRTY });
  json([d, '--cache']);                                   // warm the cache (2 findings)
  fs.writeFileSync(path.join(d, 'a.css'), '.x { margin-inline-start: 4px; }\n.y { text-align: left; }\n'); // fix one
  const after = json([d, '--cache']);
  rm(d);
  assert.equal(after.findings.length, 1, 'edited file is re-parsed, not served stale');
});

test('.miraatcache is never itself scanned', () => {
  const d = tmp({ 'a.css': DIRTY });
  const j = json([d, '--cache']);
  rm(d);
  assert.ok(j.findings.every(f => !f.file.includes('.miraatcache')));
});

test('baseline suppresses only up to the recorded count (regression re-appears)', () => {
  const d = tmp({ 'a.css': DIRTY });          // 2 findings baselined
  run([d, '--suppress-all']);
  // add a THIRD finding of the same rule in the same file
  fs.writeFileSync(path.join(d, 'a.css'), DIRTY + '.z { border-left: 1px; }\n');
  const j = json([d]);
  rm(d);
  assert.equal(j.findings.length, 1, 'only the count beyond the baseline (1) is reported');
  assert.equal(j.baselineSuppressed, 2);
});
