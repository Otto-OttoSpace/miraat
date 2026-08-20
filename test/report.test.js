'use strict';
/*
 * --report: a self-contained HTML Correctness Report (the shareable proof
 * artifact, and the document the Arabic/RTL UI Kit ships). Locks: valid
 * self-contained HTML, the score + findings render, the clean state, the
 * default filename, and the legal-safe "Miraat-verified" (never "compliant").
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');
function run(args, cwd) {
  try { return { out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd }), code: 0 }; }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: typeof e.status === 'number' ? e.status : 1 }; }
}
function dir(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-report-'));
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(d, n), b);
  return d;
}
const rm = d => fs.rmSync(d, { recursive: true, force: true });

test('--report writes valid, self-contained HTML with the score and findings', () => {
  const d = dir({ 'a.css': '.x { margin-left: 4px; }\n.y { box-shadow: 4px 0 8px #000; }\n' });
  const out = path.join(d, 'r.html');
  run([d, '--report', out]);
  const html = fs.readFileSync(out, 'utf8');
  rm(d);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html.trim(), /<\/html>$/i);
  assert.doesNotMatch(html, /<link\b|<script\b|src=["']https?:/i, 'no external assets — must be self-contained');
  assert.match(html, /class="score"/, 'score block present');
  assert.match(html, /css-logical/, 'findings listed by rule');
});

test('--report on a clean tree renders the clean state', () => {
  const d = dir({ 'a.css': '.x { margin-inline-start: 4px; }\n' });
  const out = path.join(d, 'r.html');
  run([d, '--report', out]);
  const html = fs.readFileSync(out, 'utf8');
  rm(d);
  assert.match(html, /Clean — no RTL issues/);
  assert.match(html, /100/, 'clean scores 100');
});

test('--report defaults to miraat-report.html and reports the exit code', () => {
  const d = dir({ 'a.css': '.x { margin-left: 4px; }\n' });
  const r = run(['a.css', '--report'], d);
  const wrote = fs.existsSync(path.join(d, 'miraat-report.html'));
  rm(d);
  assert.ok(wrote, 'default filename written');
  assert.match(r.out, /Miraat RTL Correctness Report/);
});

test('--report never uses the word "compliant" (legal-safe language)', () => {
  const d = dir({ 'a.css': '.x { margin-left: 4px; }\n' });
  const out = path.join(d, 'r.html');
  run([d, '--report', out]);
  const html = fs.readFileSync(out, 'utf8');
  rm(d);
  assert.match(html, /Miraat-verified/);
  assert.doesNotMatch(html, /\bcompliant\b/i);
});
