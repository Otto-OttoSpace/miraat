#!/usr/bin/env node
'use strict';
// Score AI-tool outputs for RTL correctness using rtlint. Lower issues = better.
// Usage: node benchmark/score.js <dir-of-tool-output-folders>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'rtlint.js');
const root = process.argv[2] || path.join(__dirname, 'outputs');

function scan(dir) {
  try { return JSON.parse(execFileSync(process.execPath, [CLI, dir, '--json'], { encoding: 'utf8' })); }
  catch (e) { try { return JSON.parse(e.stdout); } catch { return { fixable: 0, flags: 0 }; } }
}

const tools = fs.existsSync(root)
  ? fs.readdirSync(root).filter(f => { try { return fs.statSync(path.join(root, f)).isDirectory(); } catch { return false; } })
  : [];

if (!tools.length) {
  console.log(`No tool-output folders in ${root}.\nAdd outputs/<tool>/*.tsx (see benchmark/README.md), then re-run.`);
  process.exit(0);
}

const rows = tools.map(t => {
  const r = scan(path.join(root, t));
  const issues = (r.fixable || 0) + (r.flags || 0);
  return { tool: t, issues, score: Math.max(0, 100 - issues * 5) };
}).sort((a, b) => b.score - a.score);

console.log('RTL-for-AI benchmark — fewer RTL issues = better\n');
for (const r of rows) console.log(`${String(r.score).padStart(3)}  ${r.tool.padEnd(16)} ${r.issues} RTL issues`);
