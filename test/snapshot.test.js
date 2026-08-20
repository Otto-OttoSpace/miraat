'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const snap = require('../lib/snapshot');

// The FP-sensitive logic lives in the PURE diffLayouts() — test it directly, no
// browser needed. Each case builds a minimal {page,nodes} pair for LTR and RTL.

const VP = { width: 1280 };
function node(sid, o = {}) {
  return { sid, tag: 'div', text: o.text || '', x: o.x ?? 100, y: o.y ?? 0, w: o.w ?? 200, h: o.h ?? 40,
    scrollW: o.scrollW ?? (o.w ?? 200), clientW: o.clientW ?? (o.w ?? 200),
    overflowX: o.overflowX || 'visible', textOverflow: o.textOverflow || 'clip', whiteSpace: o.whiteSpace || 'normal' };
}
function page(scrollWidth, clientWidth = 1280) { return { scrollWidth, clientWidth }; }

test('clean layout that mirrors → no findings', () => {
  const ltr = { page: page(1280), nodes: [node('0'), node('1', { x: 900 })] };
  const rtl = { page: page(1280), nodes: [node('0', { x: 980 }), node('1', { x: 180 })] }; // mirrored, still inside
  assert.deepEqual(snap.diffLayouts(ltr, rtl, VP), []);
});

test('rtl-page-overflow: flip introduces horizontal scroll', () => {
  const ltr = { page: page(1280), nodes: [] };
  const rtl = { page: page(1460), nodes: [] };
  const f = snap.diffLayouts(ltr, rtl, VP);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'rtl-page-overflow');
  assert.equal(f[0].evidence.rtlOverflowPx, 180);
});

test('rtl-page-overflow does NOT fire when LTR already overflowed the same amount', () => {
  const ltr = { page: page(1460), nodes: [] };  // pre-existing overflow = author's bug, not RTL
  const rtl = { page: page(1460), nodes: [] };
  assert.deepEqual(snap.diffLayouts(ltr, rtl, VP), []);
});

test('rtl-clip: element clipped only under RTL', () => {
  const ltr = { page: page(1280), nodes: [node('0', { scrollW: 200, clientW: 200 })] };
  const rtl = { page: page(1280), nodes: [node('0', { text: 'مرحبا', scrollW: 320, clientW: 200, overflowX: 'hidden' })] };
  const f = snap.diffLayouts(ltr, rtl, VP);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'rtl-clip');
  assert.equal(f[0].text, 'مرحبا');
});

test('rtl-clip does NOT fire when the element was already clipped in LTR', () => {
  const ltr = { page: page(1280), nodes: [node('0', { scrollW: 320, clientW: 200, overflowX: 'hidden' })] };
  const rtl = { page: page(1280), nodes: [node('0', { scrollW: 320, clientW: 200, overflowX: 'hidden' })] };
  assert.deepEqual(snap.diffLayouts(ltr, rtl, VP), []);
});

test('hidden/collapsed box (clientW < MIN_BOX) never counts as a clip', () => {
  const ltr = { page: page(1280), nodes: [node('0', { scrollW: 60, clientW: 200 })] };
  const rtl = { page: page(1280), nodes: [node('0', { scrollW: 60, clientW: 8, w: 8, h: 8, overflowX: 'hidden' })] };
  assert.deepEqual(snap.diffLayouts(ltr, rtl, VP), []); // the #1 FP class stays guarded
});

test('rtl-offscreen: element pushed past the right edge only under RTL', () => {
  const ltr = { page: page(1280), nodes: [node('0', { x: 1000, w: 200 })] };      // right = 1200, inside
  const rtl = { page: page(1280), nodes: [node('0', { x: 1150, w: 200 })] };      // right = 1350, off-canvas
  const f = snap.diffLayouts(ltr, rtl, VP);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'rtl-offscreen');
  assert.equal(f[0].evidence.side, 'right');
});

test('rtl-offscreen does NOT fire when the element was already off-canvas in LTR', () => {
  const ltr = { page: page(1280), nodes: [node('0', { x: 1150, w: 200 })] };
  const rtl = { page: page(1280), nodes: [node('0', { x: 1150, w: 200 })] };
  assert.deepEqual(snap.diffLayouts(ltr, rtl, VP), []);
});

test('element that vanished under RTL is ignored (no crash, no finding)', () => {
  const ltr = { page: page(1280), nodes: [node('0'), node('1', { x: 900 })] };
  const rtl = { page: page(1280), nodes: [node('0', { x: 980 })] };  // sid '1' gone
  assert.deepEqual(snap.diffLayouts(ltr, rtl, VP), []);
});

test('isClipped guard: real overflow + hidden fires; visible overflow does not', () => {
  assert.equal(snap.isClipped({ scrollW: 300, clientW: 200, overflowX: 'hidden' }), true);
  assert.equal(snap.isClipped({ scrollW: 300, clientW: 200, overflowX: 'visible' }), false);
  assert.equal(snap.isClipped({ scrollW: 300, clientW: 8, overflowX: 'hidden' }), false); // sub-MIN_BOX
});

test('renderReport is self-contained HTML reflecting the verdict', () => {
  const clean = snap.renderReport({ url: 'x', viewport: { width: 1280, height: 900 }, compared: 10, findings: [] });
  assert.match(clean, /Miraat-verified/);
  const dirty = snap.renderReport({ url: 'x', viewport: { width: 1280, height: 900 }, compared: 10,
    findings: [{ rule: 'rtl-clip', selector: '[data-miraat-sid="3"]', text: 'a', fix: 'do y' }] });
  assert.match(dirty, /rtl-clip/);
  assert.match(dirty, /1 RTL layout regression/);
});

// Live browser smoke test — runs ONLY when Playwright + Chromium resolve. Proves
// the end-to-end pipeline (launch → two forced-dir passes → pure diff → result
// shape) on a network-free data: URL. Finding CORRECTNESS is covered exhaustively
// by the pure diffLayouts tests above; a 3-line fixture can't reliably reproduce a
// real RTL relayout (well-behaved CSS mirrors), so this asserts validity, not a hit.
test('live: end-to-end snapshot pipeline runs and returns a well-formed result (skipped if no browser)', async (t) => {
  if (!snap.loadPlaywright()) return t.skip('no Playwright/Chromium available');
  const html = `<!doctype html><meta charset=utf-8>
    <style>body{margin:0;font:16px system-ui}.row{display:flex;gap:8px;padding:12px}.box{width:200px;height:40px;background:#ccc}</style>
    <div class="row"><div class="box">one</div><div class="box">two</div></div>
    <p style="padding:12px">مرحبا بالعالم — hello world</p>`;
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  let res;
  try { res = await snap.runSnapshot(url, { width: 1280, wait: 'load', timeout: 15000 }); }
  catch (e) { return t.skip('browser launch failed: ' + e.message); }
  assert.ok(res && Array.isArray(res.findings), 'result has a findings array');
  assert.ok(res.compared > 0, 'both LTR and RTL passes captured elements (compared > 0)');
  assert.equal(typeof res.summary.total, 'number');
  assert.ok(res.findings.every(f => f.rule && f.selector && f.fix), 'every finding is well-formed');
});
