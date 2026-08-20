'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { scanSource } = require('../lib/rtlint-core.js');

const rules = f => f.map(x => x.rule).sort();
const scan = (code, ext = '.tsx') => scanSource('snippet' + ext, code);

test('styled-components: static template flags physical CSS and fixes it byte-safely', () => {
  const code = "const Box = styled.div`\n  margin-left: 8px;\n  text-align: left;\n`;";
  const { findings, fixed } = scan(code);
  assert.ok(findings.some(f => f.rule === 'css-logical' && f.from === 'margin-left'), 'flags margin-left');
  assert.ok(findings.some(f => f.rule === 'css-logical' && /text-align/.test(f.from)), 'flags text-align: left');
  // static template → auto-fixed in place
  assert.match(fixed, /margin-inline-start: 8px/);
  assert.match(fixed, /text-align: start/);
  // byte-safe: nothing outside the mapped tokens changed
  assert.match(fixed, /const Box = styled\.div`/);
});

test('emotion css`` tag is detected', () => {
  const { findings } = scan("const s = css`padding-right: 4px;`;");
  assert.ok(findings.some(f => f.rule === 'css-logical' && f.from === 'padding-right'));
});

test('styled(Component)`` and .attrs()`` chains are detected', () => {
  const a = scan("const A = styled(Base)`border-left: 1px solid;`;");
  assert.ok(a.findings.some(f => f.from === 'border-left'), 'styled(Base)');
  const b = scan("const B = styled.button.attrs({})`margin-right: 2px;`;");
  assert.ok(b.findings.some(f => f.from === 'margin-right'), 'styled.button.attrs()');
});

test('createGlobalStyle / keyframes tags are scanned', () => {
  const g = scan("const G = createGlobalStyle`.x{ padding-left: 9px; }`;");
  assert.ok(g.findings.some(f => f.from === 'padding-left'));
});

test('interpolated template is FLAG-ONLY (never auto-fixed → no corruption)', () => {
  const code = "const B = styled.div`\n  margin-left: ${p => p.m}px;\n  color: red;\n`;";
  const { findings, fixed } = scan(code);
  const ml = findings.find(f => f.rule === 'css-logical' && f.from === 'margin-left');
  assert.ok(ml, 'still flags margin-left in an interpolated template');
  assert.equal(ml.sev, 'flag', 'downgraded to flag (not auto-fixable)');
  assert.equal(fixed, code, 'source is returned unchanged — the ${} template is never rewritten');
});

test('correct logical CSS-in-JS is clean', () => {
  const { findings } = scan("const Box = styled.div`\n  margin-inline-start: 8px;\n  text-align: start;\n`;");
  assert.deepEqual(rules(findings), []);
});

test('a plain (non-styled) tagged template is ignored', () => {
  const { findings } = scan("const q = gql`query { left right }`; const t = sql`select left from x`;");
  assert.deepEqual(rules(findings), []);
});

test('line numbers point inside the template, not at the tag', () => {
  const code = "const Box = styled.div`\n\n  margin-left: 8px;\n`;";
  const f = scan(code).findings.find(x => x.from === 'margin-left');
  assert.equal(f.line, 3, 'margin-left is on file line 3');
});

test('vanilla-extract style({...}) is scanned only when the package is imported', () => {
  const withImport = "import { style } from '@vanilla-extract/css';\nexport const box = style({ marginLeft: 8, textAlign: 'left' });";
  const wi = scan(withImport, '.ts');
  assert.ok(wi.findings.some(f => f.rule === 'js-style-logical' && f.from === 'marginLeft'), 'flags marginLeft');
  assert.ok(wi.findings.some(f => f.rule === 'js-style-logical' && f.from === 'left'), 'flags textAlign left value');
  // no import → `style` is just some function, not scanned (no false positive)
  const noImport = "export const box = style({ marginLeft: 8 });";
  assert.deepEqual(rules(scan(noImport, '.ts').findings), []);
});

test('vanilla-extract globalStyle("sel", {...}) is scanned', () => {
  const code = "import { globalStyle } from '@vanilla-extract/css';\nglobalStyle('.a', { paddingRight: 4 });";
  assert.ok(scan(code, '.ts').findings.some(f => f.rule === 'js-style-logical' && f.from === 'paddingRight'));
});
