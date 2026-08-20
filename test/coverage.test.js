'use strict';
/*
 * Coverage rules (Wave 4) — new RTL bug classes single-rule linters can't reach.
 * input-dir: an LTR-native input (tel/email/url/number) in an RTL page needs
 * dir="ltr" or its value + caret jump to the wrong side. The most end-user-visible
 * RTL bug, and one no CSS-only linter can see.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');
function scan(name, body) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-cov-'));
  const p = path.join(d, name);
  fs.writeFileSync(p, body);
  let out;
  try { out = execFileSync(process.execPath, [CLI, p, '--json'], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || '{}'; }
  fs.rmSync(d, { recursive: true, force: true });
  return JSON.parse(out).findings.filter(f => f.rule === 'input-dir').map(f => f.from);
}

test('input-dir flags tel / email / url / number inputs in JSX', () => {
  const hits = scan('a.jsx', 'export const F=()=>(<div><input type="tel"/><input type="email"/><input type="url"/><input type="number"/></div>);');
  assert.equal(hits.length, 4, 'all four LTR-native types flagged');
  assert.ok(hits.every(h => /input type=/.test(h)));
});

test('input-dir flags a number input in HTML', () => {
  const hits = scan('a.html', '<form><input type="number" name="q"></form>');
  assert.deepEqual(hits, ['<input type="number">']);
});

test('input-dir does NOT flag an input that already has dir', () => {
  assert.equal(scan('a.jsx', 'export const F=()=>(<input type="tel" dir="ltr"/>);').length, 0);
  assert.equal(scan('a.html', '<input type="email" dir="ltr">').length, 0);
});

test('input-dir does NOT flag non-LTR-native input types', () => {
  assert.equal(scan('a.jsx', 'export const F=()=>(<div><input type="text"/><input type="password"/><input type="checkbox"/></div>);').length, 0);
});

test('input-dir does NOT fire inside CSS', () => {
  assert.equal(scan('a.css', '.field { direction: rtl; } /* input type=tel */').length, 0);
});

test('input-dir does NOT fire on a data-dir / lookalike attribute', () => {
  // an input carrying data-dir (not dir) must still be flagged (missing real dir)…
  assert.equal(scan('a.jsx', 'export const F=()=>(<input type="tel" data-dir="x"/>);').length, 1);
});

// ── box-shadow / text-shadow horizontal offset (flippable-transform family) ──
function shadowHits(name, body) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-shadow-'));
  const p = path.join(d, name); fs.writeFileSync(p, body);
  let out; try { out = execFileSync(process.execPath, [CLI, p, '--json'], { encoding: 'utf8' }); } catch (e) { out = e.stdout || '{}'; }
  fs.rmSync(d, { recursive: true, force: true });
  return JSON.parse(out).findings.filter(f => f.rule === 'flippable-transform' && /shadow/.test(f.from) || (f.msg && /shadow/.test(f.msg))).length;
}

test('shadow: flags a non-zero horizontal box-shadow / text-shadow offset', () => {
  assert.equal(shadowHits('a.css', '.a { box-shadow: 4px 2px 8px rgba(0,0,0,.2); }'), 1);
  assert.equal(shadowHits('b.css', '.b { box-shadow: red 6px 0 0; }'), 1, 'color-first shadow still parsed');
  assert.equal(shadowHits('c.css', '.c { text-shadow: -2px 0 4px #000; }'), 1);
});

test('shadow: does NOT flag a vertical-only (X=0) shadow', () => {
  assert.equal(shadowHits('a.css', '.a { box-shadow: 0 2px 8px rgba(0,0,0,.2); }'), 0);
  assert.equal(shadowHits('b.css', '.b { box-shadow: 0 0 0 1px #eee; }'), 0, 'focus-ring style');
});

test('shadow: does NOT guess when the offset is a var()/calc()', () => {
  assert.equal(shadowHits('a.css', '.a { box-shadow: var(--sh); }'), 0);
});

test('shadow: catches JSX inline style and el.style assignment with a horizontal offset', () => {
  assert.equal(shadowHits('a.jsx', 'const C=()=> <div style={{ boxShadow: "6px 2px 8px #000" }}/>;'), 1);
  assert.equal(shadowHits('b.jsx', 'el.style.boxShadow = "8px 0 4px #000";'), 1);
});

// ── SFC <style>/<script> block scanning (Vue / Svelte / HTML), report-only ──
function scanAll(name, body) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-sfc-'));
  const p = path.join(d, name); fs.writeFileSync(p, body);
  let out; try { out = execFileSync(process.execPath, [CLI, p, '--json'], { encoding: 'utf8' }); } catch (e) { out = e.stdout || '{}'; }
  fs.rmSync(d, { recursive: true, force: true });
  return JSON.parse(out).findings;
}

test('vue: scans the <style> block CSS with correct line offset', () => {
  const vue = '<template>\n  <div/>\n</template>\n<style>\n.card { margin-left: 16px; }\n</style>\n';
  const f = scanAll('C.vue', vue).filter(x => x.rule === 'css-logical');
  assert.equal(f.length, 1, 'margin-left inside <style> is caught');
  assert.equal(f[0].line, 5, 'line offset points at the real line in the file');
});

test('vue: scans the <script> block (inline style) too', () => {
  const vue = '<template><div/></template>\n<script>\nel.style.marginLeft = "8px";\n</script>\n';
  const hits = scanAll('C.vue', vue).filter(x => x.rule === 'js-style-logical');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
});

test('svelte: scans the <style> block CSS', () => {
  const svelte = '<div class="x"/>\n<style>\n.x { padding-right: 8px; }\n</style>\n';
  const hits = scanAll('C.svelte', svelte).filter(x => x.rule === 'css-logical');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
});

test('sfc: template classes are still caught alongside the blocks', () => {
  const vue = '<template>\n  <div class="ml-4"><input type="tel"/></div>\n</template>\n<style>\n.y { margin-left: 4px; }\n</style>\n';
  const rules = scanAll('C.vue', vue).map(f => f.rule);
  assert.ok(rules.includes('tw-logical'), 'template class caught');
  assert.ok(rules.includes('input-dir'), 'template input caught');
  assert.ok(rules.includes('css-logical'), 'style block caught');
});

// ── React Native StyleSheet (rn-logical), gated on a react-native import ──
function rnHits(name, body) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-rn-'));
  const p = path.join(d, name); fs.writeFileSync(p, body);
  let out; try { out = execFileSync(process.execPath, [CLI, p, '--json'], { encoding: 'utf8' }); } catch (e) { out = e.stdout || '{}'; }
  fs.rmSync(d, { recursive: true, force: true });
  return JSON.parse(out).findings.filter(f => f.rule === 'rn-logical');
}

test('rn: flags physical props inside StyleSheet.create with RN targets', () => {
  const src = "import { StyleSheet } from 'react-native';\nexport const s = StyleSheet.create({ card: { marginLeft: 12, paddingRight: 8, borderTopLeftRadius: 6, left: 0 } });\n";
  const map = Object.fromEntries(rnHits('a.tsx', src).map(f => [f.from, f.to]));
  assert.equal(map.marginLeft, 'marginStart');
  assert.equal(map.paddingRight, 'paddingEnd');
  assert.equal(map.borderTopLeftRadius, 'borderTopStartRadius');
  assert.equal(map.left, 'start');
});

test('rn: flags textAlign left/right → auto, but NOT flexDirection row', () => {
  const src = "import 'react-native';\nexport const s = StyleSheet.create({ a: { textAlign: 'left', flexDirection: 'row' } });\n";
  const froms = rnHits('a.tsx', src).map(f => f.from);
  assert.ok(froms.some(f => /textAlign/.test(f)), 'textAlign flagged');
  assert.ok(!froms.some(f => /flexDirection/.test(f)), 'flexDirection row NOT flagged (RN auto-flips)');
});

test('rn: does NOT fire without a react-native import (avoids Aphrodite false-positive)', () => {
  const src = "import { StyleSheet } from 'aphrodite';\nexport const s = StyleSheet.create({ card: { marginLeft: 12 } });\n";
  assert.equal(rnHits('a.tsx', src).length, 0);
});

test('rn: is report-only (no auto-fix rewrites the RN style)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-rn-fix-'));
  const p = path.join(d, 'a.tsx');
  fs.writeFileSync(p, "import 'react-native';\nexport const s = StyleSheet.create({ card: { marginLeft: 12 } });\n");
  execFileSync(process.execPath, [CLI, p, '--fix'], { encoding: 'utf8' });
  const after = fs.readFileSync(p, 'utf8');
  fs.rmSync(d, { recursive: true, force: true });
  assert.ok(after.includes('marginLeft: 12'), 'RN style left intact — flag, not fix');
});

test('sfc: --fix rewrites physical CSS inside a <style> block byte-safely (B4 #14)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-sfc-fix-'));
  const p = path.join(d, 'C.vue');
  fs.writeFileSync(p, '<template>\n  <div class="ml-4"/>\n</template>\n<style>\n.z { margin-left: 16px; }\n</style>\n');
  execFileSync(process.execPath, [CLI, p, '--fix'], { encoding: 'utf8' });
  const after = fs.readFileSync(p, 'utf8');
  fs.rmSync(d, { recursive: true, force: true });
  assert.ok(after.includes('margin-inline-start: 16px'), 'style block CSS fixed byte-safely (B4)');
  assert.ok(after.includes('ms-4'), 'template class still auto-fixed');
});
