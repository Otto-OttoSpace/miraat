'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { scanSource } = require('../lib/rtlint-core.js');
const scan = (code, ext = '.html') => scanSource('snippet' + ext, code);
const has = (f, rule, from) => f.some(x => x.rule === rule && (from == null || x.from === from || x.from.includes(from)));

test('align="left"/"right" attribute is flagged in HTML (email/legacy)', () => {
  const { findings } = scan('<td align="left">x</td><table align="right"><tr></tr></table>');
  assert.ok(has(findings, 'physical-align', 'left'), 'align=left');
  assert.ok(has(findings, 'physical-align', 'right'), 'align=right');
});

test('align findings are flag-only (never auto-fixed)', () => {
  const code = '<td align="left">x</td>';
  const { findings, fixed } = scan(code);
  assert.equal(findings.find(f => f.rule === 'physical-align').sev, 'flag');
  assert.equal(fixed, code);
});

test('text-align= and valign= do NOT match (no false positive)', () => {
  const { findings } = scan('<td valign="left"></td><div text-align="left"></div>');
  assert.equal(findings.filter(f => f.rule === 'physical-align').length, 0);
});

test('align="center" is fine', () => {
  const { findings } = scan('<td align="center">x</td>');
  assert.equal(findings.filter(f => f.rule === 'physical-align').length, 0);
});

test('Angular [style.margin-left] / [style.left] bindings are flagged', () => {
  const { findings } = scan('<div [style.margin-left.px]="m" [style.left]="x">a</div>');
  assert.ok(has(findings, 'css-logical', '[style.margin-left]'), 'margin-left binding');
  assert.ok(has(findings, 'css-logical', '[style.left]'), 'left binding');
});

test('logical Angular binding [style.margin-inline-start] is clean', () => {
  const { findings } = scan('<div [style.margin-inline-start.px]="m">a</div>');
  assert.equal(findings.filter(f => f.rule === 'css-logical').length, 0);
});

test('CSS files do not get align/binding flags (gate respected)', () => {
  const { findings } = scanSource('x.css', '.a{ text-align:left; } /* align="left" in a comment */');
  assert.equal(findings.filter(f => f.rule === 'physical-align').length, 0);
});

test('JSX does not get align flags (avoids component-prop false positives)', () => {
  const { findings } = scanSource('x.tsx', 'const C = () => <Stack align="left">x</Stack>;');
  assert.equal(findings.filter(f => f.rule === 'physical-align').length, 0);
});
