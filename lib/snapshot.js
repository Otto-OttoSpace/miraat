'use strict';
/*
 * snapshot.js — `miraat snapshot <url>`: RTL visual-regression.
 *
 * Renders the page twice on ONE load — forced dir=ltr, then forced dir=rtl —
 * and reports only the regressions the flip INTRODUCES. Diffing (not absolute
 * scoring) is what keeps this low-false-positive: a box that already overflowed
 * in LTR is the author's pre-existing bug, not an RTL defect, so it never counts.
 * Three high-confidence signals only (we deliberately skip the FP-prone
 * "did it mirror?" heuristic in v1 — see NOTE at the bottom):
 *   1. rtl-page-overflow  — the document gains horizontal scroll under RTL
 *   2. rtl-clip           — an element is clipped/ellipsed only under RTL
 *   3. rtl-offscreen      — an element is pushed past the viewport edge only under RTL
 *
 * The geometry diff (`diffLayouts`) is a PURE function, unit-tested without a
 * browser. The browser capture is exercised only when Playwright + a Chromium
 * build are present (resolved via the kashida pack); otherwise the CLI prints a
 * one-line install hint and exits 2. Nothing here touches the RTL lint engine.
 */
const path = require('path');

// ── tolerances (px). Kept generous so sub-pixel layout jitter never fires. ──
const EDGE_TOL = 2;        // viewport-edge slack
const OVERFLOW_TOL = 4;    // scrollWidth-clientWidth slack (matches kashida's clipped guard)
const MIN_BOX = 12;        // boxes narrower/shorter than this are hidden/collapsed, not visible text

// ── Playwright resolver: direct dep, else the kashida pack's copy, else null. ──
function loadPlaywright() {
  try { return require('playwright'); } catch {}
  try { return require('playwright-core'); } catch {}
  try {
    const meta = require.resolve('kashida/package.json');
    return require(path.join(path.dirname(meta), 'node_modules', 'playwright'));
  } catch {}
  // dev checkout layout: ../../kashida/node_modules/playwright
  try { return require(path.join(__dirname, '..', '..', 'kashida', 'node_modules', 'playwright')); } catch {}
  return null;
}

// ── in-page collector. Tags each visible candidate with data-miraat-sid so the
//    SAME element is matched across the two passes (same load, no reload). ──
function COLLECTOR_SRC() {
  return `(pass, cap) => {
    const de = document.documentElement;
    const page = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
    const out = [];
    let i = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el = walker.currentNode;
    while (el && out.length < cap) {
      if (pass === 'ltr') { el.setAttribute('data-miraat-sid', String(i)); }
      const sid = el.getAttribute('data-miraat-sid');
      if (sid != null) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const text = (el.childElementCount === 0 ? (el.textContent || '') : '').trim().slice(0, 80);
        // only keep visible, non-trivial boxes
        if (r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && cs.display !== 'none') {
          out.push({
            sid, tag: el.tagName.toLowerCase(), text,
            x: r.x, y: r.y, w: r.width, h: r.height,
            scrollW: el.scrollWidth, clientW: el.clientWidth,
            overflowX: cs.overflowX, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace,
          });
        }
      }
      i++;
      el = walker.nextNode();
    }
    return { page, nodes: out };
  }`;
}

// ── PURE geometry diff. ltr/rtl = { page:{scrollWidth,clientWidth}, nodes:[…] }.
//    viewport = { width }. Returns miraat-schema findings. No I/O, no browser. ──
function diffLayouts(ltr, rtl, viewport) {
  const findings = [];
  const vw = num(viewport && viewport.width) || num(ltr.page && ltr.page.clientWidth);

  // 1) page-level horizontal overflow introduced by the flip
  const ltrPageOv = num(ltr.page.scrollWidth) - num(ltr.page.clientWidth);
  const rtlPageOv = num(rtl.page.scrollWidth) - num(rtl.page.clientWidth);
  if (rtlPageOv > OVERFLOW_TOL && rtlPageOv - Math.max(0, ltrPageOv) > OVERFLOW_TOL) {
    findings.push({
      rule: 'rtl-page-overflow', sev: 'render', selector: 'html', text: '',
      evidence: { ltrOverflowPx: round(ltrPageOv), rtlOverflowPx: round(rtlPageOv) },
      fix: `Flipping to dir=rtl adds ${round(rtlPageOv)}px of horizontal scroll the LTR layout didn't have — almost always a hardcoded left/right offset, a fixed width, or a non-mirrored transform. Use logical properties (margin-inline, inset-inline) so the layout mirrors instead of spilling.`,
    });
  }

  // index rtl nodes by sid
  const rmap = new Map();
  for (const n of rtl.nodes) rmap.set(n.sid, n);

  for (const a of ltr.nodes) {
    const b = rmap.get(a.sid);
    if (!b) continue;                       // element vanished under RTL — out of scope for v1
    if (b.w < MIN_BOX || b.h < MIN_BOX) continue;   // collapsed/hidden in RTL

    // 2) clipped/ellipsed only under RTL (regression, not pre-existing)
    if (!isClipped(a) && isClipped(b)) {
      findings.push({
        rule: 'rtl-clip', sev: 'render', selector: sidSel(b.sid), text: b.text,
        evidence: { scrollW: round(b.scrollW), clientW: round(b.clientW), overflowX: b.overflowX, textOverflow: b.textOverflow },
        fix: `"${b.text || b.tag}" fits in LTR but is clipped in RTL (${round(b.scrollW)}px into a ${round(b.clientW)}px box). Give the control room to grow inline (min-inline-size / wrap) — Arabic runs longer and RTL reflow exposes fixed widths.`,
      });
      continue;
    }

    // 3) pushed past a viewport edge only under RTL
    const aRight = a.x + a.w, bRight = b.x + b.w;
    const ltrInside = a.x >= -EDGE_TOL && aRight <= vw + EDGE_TOL;
    const rtlOff = b.x < -EDGE_TOL || bRight > vw + EDGE_TOL;
    if (ltrInside && rtlOff) {
      const side = b.x < -EDGE_TOL ? 'left' : 'right';
      findings.push({
        rule: 'rtl-offscreen', sev: 'render', selector: sidSel(b.sid), text: b.text,
        evidence: { ltrX: round(a.x), rtlX: round(b.x), rtlRight: round(bRight), viewport: round(vw), side },
        fix: `"${b.text || b.tag}" sits inside the viewport in LTR but is pushed off the ${side} edge in RTL (x ${round(a.x)}→${round(b.x)}). A hardcoded ${side === 'left' ? 'right' : 'left'}/absolute offset isn't mirroring — switch to inset-inline / logical alignment.`,
      });
    }
  }
  return findings;
}

// kashida's clipped test, inlined (same guard: real visible box + meaningful overflow)
function isClipped(n) {
  const scrollW = num(n.scrollW), clientW = num(n.clientW);
  if (clientW < MIN_BOX) return false;
  const ox = String(n.overflowX || ''), to = String(n.textOverflow || ''), ws = String(n.whiteSpace || '');
  const overflows = scrollW - clientW > OVERFLOW_TOL;
  const hidden = ox === 'hidden' || ox === 'clip';
  const ellipsis = to === 'ellipsis';
  const nowrap = ws === 'nowrap' || ws === 'pre';
  return overflows && (hidden || ellipsis || nowrap);
}

function sidSel(sid) { return `[data-miraat-sid="${sid}"]`; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function round(v) { return Math.round(num(v)); }

// ── browser capture: one load, two forced directions. ──
async function captureBoth(url, opts = {}) {
  const pw = loadPlaywright();
  if (!pw) { const e = new Error('no-playwright'); e.code = 'NO_PW'; throw e; }
  const cap = opts.cap || 1500;
  const viewport = { width: opts.width || 1280, height: opts.height || 900 };
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ viewport })).newPage();
    await page.goto(url, { waitUntil: opts.wait || 'load', timeout: opts.timeout || 30000 });
    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
    const collector = COLLECTOR_SRC();
    await page.evaluate((d) => { document.documentElement.setAttribute('dir', d); document.body && document.body.setAttribute('dir', d); }, 'ltr');
    const ltr = await page.evaluate(`(${collector})('ltr', ${cap})`);
    await page.evaluate((d) => { document.documentElement.setAttribute('dir', d); document.body && document.body.setAttribute('dir', d); }, 'rtl');
    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
    const rtl = await page.evaluate(`(${collector})('rtl', ${cap})`);
    return { ltr, rtl, viewport };
  } finally { await browser.close().catch(() => {}); }
}

async function runSnapshot(url, opts = {}) {
  const { ltr, rtl, viewport } = await captureBoth(url, opts);
  const findings = diffLayouts(ltr, rtl, viewport);
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  return { url, viewport, compared: Math.min(ltr.nodes.length, rtl.nodes.length), findings, summary: { total: findings.length, byRule } };
}

// ── tiny self-contained HTML report (kept legal-safe, matches --report tone) ──
function renderReport(res) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = res.findings.map(f => `<tr><td class="r">${esc(f.rule)}</td><td>${esc(f.selector)}</td><td>${esc(f.text || '')}</td><td>${esc(f.fix)}</td></tr>`).join('');
  const verdict = res.findings.length === 0 ? 'No RTL layout regressions found' : `${res.findings.length} RTL layout regression(s)`;
  return `<!doctype html><meta charset="utf-8"><title>Miraat RTL Snapshot — ${esc(res.url)}</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#111}
h1{font-size:1.3rem}.v{font-weight:700;color:${res.findings.length ? '#b00' : '#0a0'}}
table{border-collapse:collapse;width:100%;margin-top:1rem}td,th{border:1px solid #ddd;padding:.5rem;text-align:start;vertical-align:top;font-size:13px}
th{background:#f6f6f6}.r{font-family:ui-monospace,monospace;white-space:nowrap;color:#7a3}</style>
<h1>Miraat — RTL Snapshot</h1>
<p><a href="${esc(res.url)}">${esc(res.url)}</a> · viewport ${res.viewport.width}×${res.viewport.height} · ${res.compared} elements compared</p>
<p class="v">${esc(verdict)}</p>
${res.findings.length ? `<table><tr><th>rule</th><th>element</th><th>text</th><th>fix</th></tr>${rows}</table>` : '<p>Layout mirrors cleanly between LTR and RTL. Miraat-verified.</p>'}`;
}

// ── CLI: `miraat snapshot <url> [--json] [--report [file]] [--width N]` ──
async function cli(argv) {
  const has = f => argv.includes(f);
  const valOf = f => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : null; };
  if (has('--help') || has('-h')) { console.log(SNAPSHOT_HELP); return 0; }
  const url = argv.find(a => !a.startsWith('-') && !isFlagVal(argv, a));
  if (!url) { console.error('miraat snapshot: need a <url>\n' + SNAPSHOT_HELP); return 2; }
  const opts = { width: +valOf('--width') || 1280, height: +valOf('--height') || 900, wait: valOf('--wait') || 'load', timeout: +valOf('--timeout') || 30000 };

  let res;
  try { res = await runSnapshot(url, opts); }
  catch (e) {
    if (e.code === 'NO_PW') {
      console.error('miraat snapshot needs a browser engine (Playwright + Chromium).\n  install:  npm i -D playwright && npx playwright install chromium\n  (or install the kashida pack, which ships it)');
      return 2;
    }
    console.error(`miraat snapshot: ${e.message}`);
    return 2;
  }

  if (has('--json')) { console.log(JSON.stringify(res, null, 2)); return res.findings.length ? 1 : 0; }

  const reportFile = has('--report') ? (valOf('--report') && !valOf('--report').startsWith('-') ? valOf('--report') : 'miraat-snapshot.html') : null;
  if (reportFile) { require('fs').writeFileSync(reportFile, renderReport(res)); console.log(`\x1b[2mreport → ${reportFile}\x1b[0m`); }

  // human summary
  const c = (n, code) => `\x1b[${code}m${n}\x1b[0m`;
  console.log(`\n\x1b[1mmiraat snapshot\x1b[0m  ${res.url}`);
  console.log(`\x1b[2m${res.compared} elements compared · viewport ${res.viewport.width}×${res.viewport.height}\x1b[0m`);
  if (res.findings.length === 0) { console.log(`\n${c('✓ no RTL layout regressions', 32)} — the layout mirrors cleanly.\n`); return 0; }
  console.log('');
  for (const f of res.findings) {
    console.log(`  ${c(f.rule, 33)}  ${f.selector}${f.text ? `  \x1b[2m"${f.text}"\x1b[0m` : ''}`);
    console.log(`    ${f.fix}`);
  }
  const parts = Object.entries(res.summary.byRule).map(([k, v]) => `${v} ${k}`).join(' · ');
  console.log(`\n${c('✗ ' + res.findings.length + ' RTL layout regression(s)', 31)}  (${parts})\n`);
  return 1;
}

function isFlagVal(argv, a) {
  for (const f of ['--width', '--height', '--wait', '--timeout', '--report']) {
    const i = argv.indexOf(f);
    if (i !== -1 && argv[i + 1] === a && !(f === '--report' && a.startsWith('-'))) return true;
  }
  return false;
}

const SNAPSHOT_HELP = `
miraat snapshot <url>            RTL visual-regression: render LTR vs forced dir=rtl,
                                 report only the layout defects the flip introduces.

  --report [file]                write an HTML report (default miraat-snapshot.html)
  --json                         machine-readable findings
  --width N   --height N         viewport (default 1280×900)
  --wait <load|networkidle>      navigation wait (default load)
  --timeout N                    navigation timeout ms (default 30000)

Exit: 0 = clean · 1 = regressions found (CI-gating) · 2 = usage / no browser.
Signals: rtl-page-overflow · rtl-clip · rtl-offscreen (diff-based → low false-positive).`;

module.exports = {
  cli, runSnapshot, captureBoth, diffLayouts, renderReport, isClipped,
  COLLECTOR_SRC, loadPlaywright, EDGE_TOL, OVERFLOW_TOL, MIN_BOX,
  // NOTE (v2): a "did each off-center element mirror to W-x?" check would add
  // coverage but is FP-prone on centered/symmetric layouts — deferred on purpose.
};
