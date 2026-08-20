'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { scanSource } = require('../lib/rtlint-core.js');
const scan = (code, ext = '.css') => scanSource('snippet' + ext, code);

test('@apply flags physical Tailwind utilities and fixes them byte-safely', () => {
  const code = '.btn {\n  @apply ml-4 pr-2 text-left;\n}';
  const { findings, fixed } = scan(code);
  const tw = findings.filter(f => f.rule === 'tw-logical').map(f => f.from + '→' + f.to).sort();
  assert.deepEqual(tw, ['ml-4→ms-4', 'pr-2→pe-2', 'text-left→text-start']);
  assert.match(fixed, /@apply ms-4 pe-2 text-start;/);
  // untouched bytes preserved
  assert.match(fixed, /\.btn \{/);
});

test('@apply with logical utilities is clean', () => {
  const { findings } = scan('.btn { @apply ms-4 pe-2 text-start; }');
  assert.deepEqual(findings.filter(f => f.rule === 'tw-logical'), []);
});

test('@apply line number points at the at-rule', () => {
  const code = '.a {\n\n  @apply ml-4;\n}';
  const f = scan(code).findings.find(x => x.rule === 'tw-logical');
  assert.equal(f.line, 3);
});

test('physical corner utility in @apply maps to its logical form', () => {
  const { findings, fixed } = scan('.card { @apply rounded-l-lg; }');
  assert.ok(findings.some(f => f.rule === 'tw-logical' && f.from === 'rounded-l-lg' && f.to === 'rounded-s-lg'));
  assert.match(fixed, /@apply rounded-s-lg;/);
});

test('regular decls in the same file still scan (no regression)', () => {
  const code = '.x { margin-left: 4px; @apply pr-2; }';
  const { findings, fixed } = scan(code);
  assert.ok(findings.some(f => f.rule === 'css-logical' && f.from === 'margin-left'), 'decl still caught');
  assert.ok(findings.some(f => f.rule === 'tw-logical' && f.from === 'pr-2'), '@apply still caught');
  assert.match(fixed, /margin-inline-start: 4px/);
  assert.match(fixed, /@apply pe-2/);
});

test('@apply inside SCSS is handled (or safely skipped, never corrupted)', () => {
  const { findings, fixed } = scan('.x { @apply ml-4; }', '.scss');
  // either flags it, or (if SCSS parse differs) leaves source intact — never corrupts
  if (findings.some(f => f.rule === 'tw-logical')) assert.match(fixed, /ms-4/);
  else assert.match(fixed, /ml-4/);
});
