'use strict';
/*
 * Baseline / bulk-suppress — the decisive onboarding unlock.
 * A large existing codebase has thousands of pre-existing RTL hits, so `--check`
 * is unusable on day one. A baseline snapshots the current debt as a
 * file -> rule -> count map; afterward `--check` counts ONLY findings beyond the
 * baseline, turning miraat into a ratchet: no NEW RTL debt, old debt worked down
 * over time. Schema mirrors ESLint's 2025 bulk-suppressions design.
 */
const fs = require('fs');
const path = require('path');
const BASELINE_FILE = 'miraat-baseline.json';

function baselinePath(root) { return path.join(root, BASELINE_FILE); }

function load(root) {
  try { return JSON.parse(fs.readFileSync(baselinePath(root), 'utf8')); }
  catch { return null; }
}

// byFileRel: { [relFile]: finding[] } -> { [relFile]: { [rule]: count } } (sorted, deterministic).
function build(byFileRel) {
  const counts = {};
  for (const file of Object.keys(byFileRel).sort()) {
    const perRule = {};
    for (const f of byFileRel[file]) perRule[f.rule] = (perRule[f.rule] || 0) + 1;
    const sorted = {};
    for (const r of Object.keys(perRule).sort()) sorted[r] = perRule[r];
    counts[file] = sorted;
  }
  return counts;
}

function write(root, counts) {
  fs.writeFileSync(baselinePath(root), JSON.stringify({ version: 1, counts }, null, 2) + '\n');
}

// Drop up to `count` findings per file+rule. Returns { kept: {relFile:[]}, suppressed }.
function filter(byFileRel, baseline) {
  const counts = (baseline && baseline.counts) || {};
  const kept = {};
  let suppressed = 0;
  for (const [file, arr] of Object.entries(byFileRel)) {
    const budget = Object.assign({}, counts[file] || {});
    const keep = [];
    for (const f of arr) {
      if (budget[f.rule] > 0) { budget[f.rule]--; suppressed++; }
      else keep.push(f);
    }
    if (keep.length) kept[file] = keep;
  }
  return { kept, suppressed };
}

// Prune: rewrite counts to min(existing, current) so fixed debt drops out and
// the baseline can only ever shrink — never silently re-grows to hide new bugs.
function prune(existing, byFileRel) {
  const current = build(byFileRel);
  const oldCounts = (existing && existing.counts) || {};
  const out = {};
  for (const file of Object.keys(oldCounts)) {
    const merged = {};
    for (const rule of Object.keys(oldCounts[file])) {
      const capped = Math.min(oldCounts[file][rule], (current[file] && current[file][rule]) || 0);
      if (capped > 0) merged[rule] = capped;
    }
    if (Object.keys(merged).length) out[file] = merged;
  }
  return out;
}

module.exports = { load, build, write, filter, prune, baselinePath, BASELINE_FILE };
