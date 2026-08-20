'use strict';
/*
 * CI reporter formats (--format github | gitlab-codequality | junit). These are
 * the free "surface in the PR" layer: GitHub workflow-command annotations,
 * GitLab Code Quality JSON, and JUnit XML. Locks structure + severity mapping +
 * the exit contract (github gates the step; gitlab/junit are artifacts → exit 0).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');
function run(args) {
  try { return { out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }), code: 0 }; }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: typeof e.status === 'number' ? e.status : 1 }; }
}
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-fmt-'));
  fs.writeFileSync(path.join(d, 'a.css'), '.x { margin-left: 4px; }\n');                        // css-logical → warn
  fs.writeFileSync(path.join(d, 'b.tsx'), 'const C = () => <div dir="ltr">x</div>;\n');          // hardcoded-dir → error
  return d;
}
const rm = d => fs.rmSync(d, { recursive: true, force: true });

test('--format github emits workflow-command annotations, error gates the step', () => {
  const d = tmp();
  const r = run([d, '--format', 'github']);
  rm(d);
  assert.match(r.out, /^::warning file=.*a\.css,line=1,title=miraat\[css-logical\]::/m);
  assert.match(r.out, /^::error file=.*b\.tsx,line=1,title=miraat\[hardcoded-dir\]::/m);
  assert.equal(r.code, 1, 'an error-level finding fails the step');
});

test('--format github %-encodes the message (no raw newlines/percent)', () => {
  const d = tmp();
  const r = run([d, '--format', 'github']);
  rm(d);
  // every annotation is exactly one line (no bare newline inside a message)
  for (const line of r.out.trim().split('\n')) assert.match(line, /^::(error|warning) /);
});

test('--format gitlab-codequality is a valid Code Quality report', () => {
  const d = tmp();
  const r = run([d, '--format', 'gitlab-codequality']);
  rm(d);
  const report = JSON.parse(r.out);
  assert.ok(Array.isArray(report) && report.length >= 2);
  for (const e of report) {
    assert.ok(e.description && e.check_name.startsWith('miraat/'));
    assert.match(e.fingerprint, /^[a-f0-9]{40}$/, 'sha1 fingerprint');
    assert.ok(['major', 'minor'].includes(e.severity));
    assert.ok(e.location && e.location.path && e.location.lines.begin >= 1);
  }
  assert.ok(report.some(e => e.severity === 'major'), 'a flag maps to major');
  assert.equal(r.code, 0, 'gitlab report is an artifact → exit 0');
});

test('--format junit is well-formed and counts every finding', () => {
  const d = tmp();
  const r = run([d, '--format', 'junit']);
  rm(d);
  assert.match(r.out, /^<\?xml version="1\.0"/);
  assert.match(r.out.trim(), /<\/testsuites>$/);
  const n = Number(r.out.match(/<testsuites name="miraat" tests="(\d+)"/)[1]);
  assert.ok(n >= 2, 'counts findings as test cases');
  assert.equal((r.out.match(/<testcase /g) || []).length, n);
  assert.equal(r.code, 0, 'junit report is an artifact → exit 0');
});

test('unknown --format is a hard error (exit 2)', () => {
  const d = tmp();
  const r = run([d, '--format', 'bogus']);
  rm(d);
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown --format/);
});
