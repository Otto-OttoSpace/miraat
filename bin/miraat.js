#!/usr/bin/env node
'use strict';
/*
 * miraat (مرآة, "mirror"; formerly rtlint) — find & fix the RTL mistakes AI
 * code tools keep making, across every right-to-left script: Arabic, Hebrew,
 * Syriac, Thaana, N'Ko and Adlam.
 *
 * Detection is AST-verified (Babel for JS/TS/JSX/TSX, PostCSS for CSS): only
 * high-confidence, mechanically-safe edits are auto-applied on --fix; every
 * judgment call (icons, dir, Western digits in native-numeral scripts, fonts)
 * is report-only. Invokable as `miraat` or the legacy `rtlint` alias.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scanSource } = require('../lib/rtlint-core');
const { loadConfig, severityFor } = require('../lib/config');
const { loadIgnore } = require('../lib/ignore');
const { applyDirectives } = require('../lib/directives');
const baseline = require('../lib/baseline');

const VERSION = require('../package.json').version;

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.vue', '.svelte', '.astro']);
const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const IGNORE_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', 'vendor', '.svelte-kit']);
// Safe-on-untrusted-repos guards: skip pathologically large files, cap the tree
// depth/count, and never follow symlinks (no loops, no traversal outside the target).
const MAX_FILE_BYTES = 2_000_000, MAX_FILES = 20000, MAX_WALK_DEPTH = 40;

// SARIF rule metadata — one entry per rule id the scanner can emit.
const REPO = 'https://github.com/Otto-OttoSpace/miraat';
const SARIF_RULES = {
  'css-logical':          'Physical CSS property should be logical (margin-inline-start, etc.)',
  'tw-logical':           'Physical Tailwind utility should be logical (ms-*, pe-*, text-start)',
  'js-style-logical':     'Physical inline-style property should be logical',
  'physical-corner':      'Physical border-radius corner should be logical (border-start-start-radius)',
  'flippable-transform':  "Transform/position won't auto-mirror for RTL",
  'latin-font-stack':     'Font stack has no Arabic family',
  'arabic-western-digits':'Western digits in a script with its own numerals',
  'bidi-isolation':       'Mixed-direction text needs bidi isolation',
  'icon-directional':     'Directional icon should mirror for RTL',
  'hardcoded-dir':        'Hard-coded direction should be dynamic',
  'input-dir':            'LTR-native input (tel/email/url/number) needs dir="ltr"',
  'rn-logical':           'React Native physical style should be logical (marginStart/paddingEnd/start/end…)',
};

// The single Miraat RTL Score — one shareable 0–100 number for a file or repo.
// 100 = clean. Judgment-call flags weigh double the mechanical fixes. Penalties
// are normalized by "surface" (files, and ~1 unit per 200 lines) so a large,
// mostly-correct codebase isn't dragged to zero by one bad file, and the curve
// saturates so the score stays bounded and monotone. Grades: A≥90 B≥75 C≥60 D≥40 F.
function computeScore({ fixCount, flagCount, files, lines }) {
  const weighted = fixCount * 1 + flagCount * 2;
  const surface = Math.max(files || 0, Math.ceil((lines || 0) / 200), 1);
  const raw = weighted / surface;               // weighted defects per surface unit
  const score = Math.max(0, Math.round(100 - 100 * (raw / (raw + 3)))); // saturating
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, grade, files: files || 0, lines: lines || 0, fixable: fixCount, flags: flagCount };
}

// Shields-style SVG badge from a score — a distributed billboard for the metric.
// `npx miraat . --badge > rtl-score.svg`  →  ![RTL Score](rtl-score.svg)
function badgeSvg({ score, grade }) {
  const color = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626', F: '#991b1b' }[grade] || '#6b7280';
  const label = 'Miraat RTL', value = `${score} ${grade}`;
  const lw = 74, vw = 20 + value.length * 7, h = 20, w = lw + vw, esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(value)}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="${h}" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${lw}" height="${h}" fill="#2b2b2b"/>
<rect x="${lw}" width="${vw}" height="${h}" fill="${color}"/>
<rect width="${w}" height="${h}" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text>
<text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(value)}</text>
<text x="${lw + vw / 2}" y="14">${esc(value)}</text>
</g>
</svg>`;
}

// A self-contained HTML Correctness Report — the shareable proof artifact.
// `npx miraat . --report report.html`. No external assets; opens anywhere and
// prints clean. Doubles as the "Miraat Correctness Report" shipped with the kit.
function buildHtmlReport({ score, byFile, rel, generatedAt }) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const gradeColor = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626', F: '#991b1b' }[score.grade] || '#6b7280';
  const files = Object.keys(byFile);
  // per-rule tally
  const byRule = {};
  for (const arr of Object.values(byFile)) for (const f of arr) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const ruleRows = Object.entries(byRule).sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `<tr><td><code>${esc(r)}</code> <span class="d">${esc(SARIF_RULES[r] || '')}</span></td><td class="num">${n}</td></tr>`).join('');
  const fileBlocks = files.map(file => {
    const rows = byFile[file].map(f => {
      const tag = f.sev === 'fix' ? '<span class="pill fix">fix</span>' : '<span class="pill flag">review</span>';
      const change = f.to ? `<code>${esc(f.from)}</code> → <code>${esc(f.to)}</code>` : `<code>${esc(f.from)}</code>`;
      return `<tr><td class="ln">${f.line}</td><td>${tag}</td><td>${change}<div class="d">${esc(f.msg)}</div></td></tr>`;
    }).join('');
    return `<section class="file"><h3>${esc(rel(file))}</h3><table class="findings">${rows}</table></section>`;
  }).join('');
  const clean = files.length === 0;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Miraat RTL Correctness Report</title>
<style>
:root{--ink:#16181d;--muted:#5b6472;--line:#e3e7ee;--bg:#f7f8fa;--grade:${gradeColor}}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:860px;margin:0 auto;padding:40px 24px}
.head{display:flex;gap:28px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:28px 32px}
.score{flex:0 0 auto;width:132px;height:132px;border-radius:16px;background:var(--grade);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center}
.score .n{font-size:44px;font-weight:800;line-height:1}.score .g{font-size:15px;opacity:.9;margin-top:4px;letter-spacing:.08em}
.head h1{margin:0 0 4px;font-size:22px}.head .sub{color:var(--muted);font-size:14px}
.stats{display:flex;gap:24px;margin-top:14px;flex-wrap:wrap}.stat b{font-size:20px}.stat span{color:var(--muted);font-size:13px;display:block}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:34px 0 12px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
td,th{padding:10px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}tr:last-child td{border-bottom:0}
.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}.ln{color:var(--muted);font-variant-numeric:tabular-nums;width:44px}
code{background:#f1f2f5;padding:1px 6px;border-radius:5px;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.d{color:var(--muted);font-size:12.5px;margin-top:2px}
.file{margin-bottom:18px}.file h3{font-size:14px;margin:0 0 6px;font-family:ui-monospace,Menlo,monospace}
.pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}.pill.fix{background:#eef2ff;color:#4f46e5}.pill.flag{background:#fff7ed;color:#b45309}
.clean{background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px;color:#067647;font-weight:600}
.foot{color:var(--muted);font-size:12.5px;margin-top:34px;border-top:1px solid var(--line);padding-top:16px}
@media(max-width:560px){.head{flex-direction:column;text-align:center}}
</style></head><body><div class="wrap">
<div class="head">
  <div class="score"><div class="n">${score.score}</div><div class="g">${score.grade}</div></div>
  <div><h1>Miraat RTL Correctness Report</h1>
  <div class="sub">Checked against the Miraat RTL ruleset — every right-to-left script (Arabic, Hebrew, Syriac, Thaana, N'Ko, Adlam).</div>
  <div class="stats"><div class="stat"><b>${score.files}</b><span>files</span></div><div class="stat"><b>${score.lines}</b><span>lines</span></div><div class="stat"><b>${score.fixable}</b><span>auto-fixable</span></div><div class="stat"><b>${score.flags}</b><span>to review</span></div></div>
  </div>
</div>
${clean ? '<div class="clean">✓ Clean — no RTL issues found. Miraat-verified correct against the ruleset.</div>'
  : `<h2>By rule</h2><table>${ruleRows}</table><h2>Findings</h2>${fileBlocks}`}
<div class="foot">Generated by miraat v${VERSION}${generatedAt ? ' · ' + esc(generatedAt) : ''} · “Miraat-verified” means checked against the published ruleset, not a legal certification. · <a href="${REPO}">${esc(REPO)}</a></div>
</div></body></html>`;
}

// Build a SARIF 2.1.0 log from findings grouped by file. `fix` findings are
// mechanically-safe (note); `flag` findings need a human (warning).
function buildSarif(byFile, rel) {
  const results = [];
  for (const [file, arr] of Object.entries(byFile)) {
    for (const f of arr) {
      results.push({
        ruleId: f.rule,
        level: f.sev === 'fix' ? 'note' : 'warning',
        message: { text: f.to ? `${f.msg} (${f.from} → ${f.to})` : `${f.msg} (${f.from})` },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: rel(file).split(path.sep).join('/') },
            region: { startLine: Math.max(1, f.line || 1) },
          },
        }],
      });
    }
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: {
        name: 'miraat',
        informationUri: REPO,
        version: VERSION,
        rules: Object.entries(SARIF_RULES).map(([id, text]) => ({
          id,
          name: id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
          shortDescription: { text },
          helpUri: `${REPO}#rules`,
          defaultConfiguration: { level: 'warning' },
        })),
      }},
      results,
    }],
  };
}

// CI report formats. `github` → workflow-command annotations that render inline
// on the PR diff; `gitlab-codequality` → GitLab Code Quality JSON artifact;
// `junit` → JUnit XML most CI dashboards ingest. Each finding carries its
// governed severity in `f.level` (error|warn).
function formatReport(fmt, byFile, rel) {
  const desc = f => f.to ? `${f.msg} (${f.from} → ${f.to})` : `${f.msg} (${f.from})`;
  const all = Object.entries(byFile).flatMap(([file, arr]) =>
    arr.map(f => ({ ...f, relPath: rel(file).split(path.sep).join('/') })));

  if (fmt === 'github') {
    // Message needs %-encoding for newlines/percent per the workflow-command spec.
    const enc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    return all.map(f => {
      const lvl = f.level === 'error' ? 'error' : 'warning';
      return `::${lvl} file=${f.relPath},line=${Math.max(1, f.line || 1)},title=miraat[${f.rule}]::${enc(desc(f))}`;
    }).join('\n');
  }
  if (fmt === 'gitlab-codequality') {
    const report = all.map(f => ({
      description: desc(f),
      check_name: `miraat/${f.rule}`,
      fingerprint: crypto.createHash('sha1').update(`${f.relPath}:${f.rule}:${f.line}:${f.from}`).digest('hex'),
      severity: f.level === 'error' ? 'major' : 'minor',
      location: { path: f.relPath, lines: { begin: Math.max(1, f.line || 1) } },
    }));
    return JSON.stringify(report, null, 2);
  }
  if (fmt === 'junit') {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cases = all.map(f =>
      `    <testcase name="${esc(f.rule)} ${esc(f.relPath)}:${f.line}" classname="miraat.${esc(f.rule)}">\n` +
      `      <failure message="${esc(desc(f))}">${esc(f.relPath)}:${f.line}</failure>\n` +
      `    </testcase>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<testsuites name="miraat" tests="${all.length}" failures="${all.length}">\n` +
      `  <testsuite name="miraat" tests="${all.length}" failures="${all.length}">\n` +
      `${cases}\n  </testsuite>\n</testsuites>`;
  }
  return null;
}

function walk(dir, opts = {}, out = [], depth = 0) {
  const { root = dir, ignored = () => false } = opts;
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_FILES) return out;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (out.length >= MAX_FILES) break;
    if (IGNORE_DIR.has(name) || (name.startsWith('.') && name !== '.')) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.lstatSync(full); } catch { continue; }   // lstat: do NOT follow symlinks
    if (st.isSymbolicLink()) continue;                              // skip symlinks → no loops / no escape
    const rel = path.relative(root, full);
    if (st.isDirectory()) {
      if (ignored(rel, true)) continue;                            // pruned by .gitignore/.miraatignore → skip subtree
      walk(full, opts, out, depth + 1);
    } else {
      const ext = path.extname(full);
      if ((CODE_EXT.has(ext) || CSS_EXT.has(ext)) && !ignored(rel, false)) out.push(full);
    }
  }
  return out;
}

// The RTL rule-set injected into AI coding agents so they stop RE-introducing
// the bugs miraat catches. Derived from miraat's own AST rules → authoritative.
const RULES_BODY = `Follow these whenever you write or edit UI, so it renders correctly in every right-to-left script (Arabic, Persian, Urdu, Hebrew, Syriac, Thaana, N'Ko, Adlam) — not just left-to-right English.

## The 6 mistakes AI code tools make most (fix these first)
These are the RTL bugs AI reintroduces again and again — it is trained mostly on LTR code. Do NOT ship any of them.
1. **Physical spacing.** ✗ \`ml-4 pr-2 text-left\`, \`margin-left\`, \`padding-right\` → ✓ \`ms-4 pe-2 text-start\`, \`margin-inline-start\`, \`padding-inline-end\`. Logical properties flip with direction; physical ones don't.
2. **Hard-coded direction.** ✗ \`dir="ltr"\`, \`direction: ltr\`, \`unicode-bidi: bidi-override\` → ✓ \`<html dir={locale.dir}>\` set once, dynamically. Never force LTR to "fix" a layout — it breaks every RTL user.
3. **Un-mirrored icons.** ✗ a back-arrow / \`ChevronLeft\` still pointing left in Arabic → ✓ mirror directional icons for RTL (\`rtl:-scale-x-100\` or an RTL-aware icon). Never mirror non-directional icons (play, search, phone).
4. **No bidi isolation.** ✗ a Latin name, URL or \`{number}\` dropped raw into Arabic text (it reorders) → ✓ wrap the opposite-direction run in \`<bdi>\` or set \`dir="auto"\`.
5. **Broken Arabic shaping.** ✗ \`text.split('')\`, per-letter \`<span>\`, SplitText \`chars\`, \`letter-spacing\`/\`tracking-*\`, \`text-transform: uppercase\` on Arabic — each shatters the cursive joins → ✓ animate by word/line; never letter-space a cursive script.
6. **LTR islands & numerals.** ✗ a phone/email/number \`<input>\` with no \`dir\`, or Western digits hard-baked into a native-numeral script → ✓ \`dir="ltr"\` on those inputs; \`Intl.NumberFormat\` for locale-aware numerals.

## Layout — logical, never physical
1. CSS: use logical properties — \`margin-inline-start/end\`, \`padding-inline-start/end\`, \`inset-inline-start/end\`, \`border-inline-start/end\`, \`text-align: start/end\` (never \`left\`/\`right\`), \`float/clear: inline-start/end\`, and logical corners (\`border-start-start-radius\`…).
2. Tailwind: use \`ms-\`/\`me-\`/\`ps-\`/\`pe-\`/\`start-\`/\`end-\`/\`text-start\`/\`text-end\`/\`rounded-s\`/\`rounded-e\`/\`border-s\`/\`border-e\` — never \`ml/mr/pl/pr/left/right/text-left/text-right/rounded-l/r/border-l/r\`.
3. Inline JS styles: \`marginInlineStart\`, \`insetInlineEnd\`, \`textAlign:'start'\` — never \`marginLeft\`/\`left\`/\`textAlign:'left'\`.

## Direction
4. Set direction dynamically: \`<html dir={locale.dir}>\` — never hard-code \`dir="ltr"\`. One dynamic \`dir\` flips ALL RTL scripts at once.

## Bidirectional text (the bug almost nobody catches)
5. When a string mixes directions — a Latin brand/name/URL/number inside Arabic text, or Arabic inside English — wrap the opposite-direction run in \`<bdi>\` or set \`dir="auto"\`, or it reorders wrongly. Never assume the browser gets mixed-direction order right on its own.

## Arabic & cursive scripts — shaping
6. Arabic/Persian/Urdu/Syriac/N'Ko letters JOIN. Never split them per-character (no \`text.split('')\`, no GSAP SplitText \`type:'chars'\`, no per-letter \`<span>\`) — it breaks the joins. Animate by word or line.
7. Never apply \`letter-spacing\` / Tailwind \`tracking-*\` to Arabic (it shatters the joins), and don't \`text-transform: uppercase\` caseless scripts.
8. Use a real script-capable font with a fallback (e.g. \`"IBM Plex Sans Arabic","Cairo",system-ui\` for Arabic). A Latin-only font renders Arabic as broken/tofu.

## Numerals, dates, icons
9. In scripts with native numerals (Arabic, Thaana, N'Ko, Adlam) use locale-aware numerals & dates (\`Intl.NumberFormat\`/\`Intl.DateTimeFormat\`); Hebrew & Syriac use Western digits.
10. Mirror directional icons (chevrons, arrows, carets, back/next) for RTL; never mirror non-directional icons (play, phone, search).

## Native frameworks
11. React Native: \`I18nManager.isRTL\`, \`paddingStart/marginStart/start\`, \`textAlign:'auto'\` — never hard \`left/right\`.
12. Flutter: \`Directionality\`, \`EdgeInsetsDirectional\`, \`TextAlign.start\`, \`AlignmentDirectional\` — never \`EdgeInsets.only(left:)\`.
13. SwiftUI: \`.leading\`/\`.trailing\` and \`.environment(\\\\.layoutDirection, …)\` — never \`.left\`/\`.right\`.

## Verify — don't trust, check
14. Run \`npx miraat --check\` in CI and before committing UI changes; it AST-verifies these and auto-fixes the mechanical ones (\`npx miraat --fix\`).
15. Add miraat's MCP server (\`npx miraat-mcp\`) and use it BEFORE proposing code. One server exposes the whole Arabic suite: \`miraat_fix_code\` (send a snippet, get the RTL-corrected code back), \`miraat_type_check\` (Arabic typography & shaping — kashida), \`miraat_i18n_check\` (hard-coded strings / missing translations — lahja), and \`miraat_a11y_check\` (WCAG 2.2 + Saudi DGA — daleel). Self-check first; the bug never ships.`;

const MARK_START = '<!-- miraat:rtl-rules — auto-generated; edits between the markers are overwritten by \`miraat --init-rules\` -->';
const MARK_END = '<!-- /miraat:rtl-rules -->';
const HEADING = '# RTL rules for AI coding agents (generated by miraat)';
const BLOCK = `${MARK_START}\n${HEADING}\n\n${RULES_BODY}\n${MARK_END}`;
const CURSOR_MDC = `---\ndescription: Arabic / RTL correctness — apply when writing or editing any UI. Stops the RTL bugs AI code tools introduce.\nglobs: ["**/*.{js,jsx,ts,tsx,css,scss,vue,svelte,html,astro}"]\nalwaysApply: true\n---\n\n${HEADING}\n\n${RULES_BODY}\n`;

// AI-agent config files to inject the rule-set into (the "immune system").
const AGENT_TARGETS = [
  { file: 'CLAUDE.md', label: 'Claude Code' },
  { file: 'AGENTS.md', label: 'Codex / OpenAI / generic agents' },
  { file: 'GEMINI.md', label: 'Gemini CLI' },
  { file: '.windsurfrules', label: 'Windsurf' },
  { file: '.clinerules', label: 'Cline' },
  { file: '.github/copilot-instructions.md', label: 'GitHub Copilot' },
  { file: 'RTL-RULES.md', label: 'standalone' },
];

// Idempotent: replace the marked block if present, else append; never clobber the user's own content.
function upsertBlock(existing, block) {
  const s = existing.indexOf(MARK_START);
  const e = existing.indexOf(MARK_END);
  if (s !== -1 && e !== -1 && e > s) return existing.slice(0, s) + block + existing.slice(e + MARK_END.length);
  return existing ? existing.replace(/\s*$/, '') + '\n\n' + block + '\n' : block + '\n';
}

function writeAgentRules(target) {
  const written = [];
  for (const t of AGENT_TARGETS) {
    const dest = path.join(target, t.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
    fs.writeFileSync(dest, upsertBlock(prev, BLOCK));
    written.push({ file: t.file, label: t.label });
  }
  const cur = path.join(target, '.cursor', 'rules', 'rtl.mdc'); // Cursor: miraat-owned, written whole (needs frontmatter)
  fs.mkdirSync(path.dirname(cur), { recursive: true });
  fs.writeFileSync(cur, CURSOR_MDC);
  written.push({ file: '.cursor/rules/rtl.mdc', label: 'Cursor' });
  return written;
}

const HELP = `miraat v${VERSION} — find & fix the RTL mistakes AI code tools make
Arabic · Hebrew · Syriac · Thaana · N'Ko · Adlam   (formerly rtlint; the \`rtlint\` command still works)

Usage:
  npx miraat [path]              scan and report (default path: .)

Rule-packs (one miraat, whole suite):
  npx miraat type [path]         Arabic typography / shaping (kashida)
  npx miraat i18n [path]         hardcoded strings / catalog (lahja)
  npx miraat a11y [path]         DGA Platforms-Code + WCAG (daleel)
  npx miraat snapshot <url>      RTL visual-regression (LTR vs dir=rtl, layout diff)
  npx miraat all  [path]         run every pack, one after another
  npx miraat [path] --fix        apply the safe fixes (physical -> logical)
  npx miraat [path] --check      report only, exit non-zero if anything found (CI)
  npx miraat [path] --dry-run    show what --fix would change, but write nothing
  npx miraat [path] --json       machine-readable output
  npx miraat [path] --sarif      SARIF 2.1.0 output (GitHub code-scanning / CI annotations)
  npx miraat [path] --format <f> CI reporter: github (PR annotations) | gitlab-codequality | junit
  npx miraat [path] --score      print the single RTL Score (0-100 + grade); add --json for data
  npx miraat [path] --badge      emit an SVG score badge for your README (> rtl-score.svg)
  npx miraat [path] --report [f] write a self-contained HTML Correctness Report (default miraat-report.html)
  npx miraat [path] --init-rules inject RTL rules into every AI editor
                                 (CLAUDE.md · .cursor · GEMINI.md · .windsurfrules · .clinerules · Copilot · AGENTS.md)
  npx miraat --help | --version

Adopt it on an existing repo (governance):
  npx miraat [path] --suppress-all           snapshot current debt → miraat-baseline.json
                                             (afterwards --check fails only on NEW RTL debt)
  npx miraat [path] --prune-suppressions     shrink the baseline after you fix debt
  --config <file>                            use a specific config (else miraat.config.json is auto-found)
  --no-config / --no-ignore                  skip config / skip .gitignore+.miraatignore
  --cache                                    skip re-parsing unchanged files (.miraatcache; report runs only)
  --report-unused-disable-directives         list miraat-disable comments that matched nothing

  Config (miraat.config.json): { "extends": "miraat:recommended" | "miraat:strict",
    "rules": { "hardcoded-dir": "error", "arabic-western-digits": "off" } }   // off | warn | error
  Inline: /* miraat-disable-next-line css-logical -- intentional LTR block */

Auto-fixes physical CSS/Tailwind/JS-style -> logical (AST-verified, so custom
classes, selectors, comments and identifiers are never touched). Flags the
parts that need a human who reads the script (icons, fonts, dir, bidi, numerals).`;

// --- Rule-pack umbrella (see CONSOLIDATION-PLAN.md): one `miraat`, many packs.
// Each pack keeps its own tested core; miraat dispatches to the pack's own CLI as
// a subprocess (zero core-merge risk). Base RTL scan stays the default. ---
const PACK_ALIASES = { type: 'kashida', i18n: 'lahja', a11y: 'daleel', dga: 'daleel' };
function safeResolve(id) { try { return require.resolve(id); } catch { return null; } }
function resolvePackBin(pkg) {
  const p = require('path');
  const fromMeta = (metaPath) => {
    if (!metaPath) return null;
    try { const meta = require(metaPath); const rel = meta.bin && (meta.bin[pkg] || Object.values(meta.bin)[0]); return rel ? p.join(p.dirname(metaPath), rel) : null; }
    catch { return null; }
  };
  return fromMeta(safeResolve(pkg + '/package.json')) || fromMeta(p.join(__dirname, '..', '..', pkg, 'package.json'));
}
function runPack(pkg, rest) {
  const bin = resolvePackBin(pkg);
  if (!bin) { console.error(`\nmiraat: the "${pkg}" pack isn't installed.\n  add it:  npm i -D ${pkg}\n  or run:  npx ${pkg} ${rest.join(' ')}\n`); process.exit(1); }
  try { require('child_process').execFileSync(process.execPath, [bin, ...rest], { stdio: 'inherit' }); }
  catch (e) { process.exit(typeof e.status === 'number' ? e.status : 1); }
}
function runAllPacks(rest) {
  const { execFileSync } = require('child_process');
  console.log('\x1b[1mmiraat all\x1b[0m — every rule-pack:\n');
  let failed = 0;
  for (const [name, pkg] of [['rtl', null], ['type', 'kashida'], ['i18n', 'lahja'], ['a11y', 'daleel']]) {
    console.log(`\x1b[2m── ${name} ──────────────────────\x1b[0m`);
    try {
      if (!pkg) execFileSync(process.execPath, [__filename, ...rest], { stdio: 'inherit' });
      else { const bin = resolvePackBin(pkg); if (!bin) { console.log(`  (skipped — ${pkg} not installed: npm i -D ${pkg})`); continue; } execFileSync(process.execPath, [bin, ...rest], { stdio: 'inherit' }); }
    } catch { failed++; }
    console.log('');
  }
  process.exit(failed ? 1 : 0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { console.log(VERSION); return; }
  // pack dispatch — `miraat type|i18n|a11y|dga .` and `miraat all .`
  if (PACK_ALIASES[args[0]]) return runPack(PACK_ALIASES[args[0]], args.slice(1));
  if (args[0] === 'all') return runAllPacks(args.slice(1));
  // RTL visual-regression — `miraat snapshot <url>` (async; own exit code)
  if (args[0] === 'snapshot') {
    require('../lib/snapshot').cli(args.slice(1))
      .then(code => process.exit(code))
      .catch(e => { console.error(`miraat snapshot: ${e && e.message || e}`); process.exit(2); });
    return;
  }
  const has = f => args.includes(f);
  const valOf = f => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const doFix = has('--fix');
  const asJson = has('--json');
  const asSarif = has('--sarif');
  const asScore = has('--score');
  const asBadge = has('--badge');
  const check = has('--check');
  const dryRun = has('--dry-run');
  const initRules = has('--init-rules');
  const suppressAll = has('--suppress-all');
  const pruneSuppressions = has('--prune-suppressions');
  const noConfig = has('--no-config');
  const noIgnore = has('--no-ignore');
  const useCache = has('--cache');
  const reportUnused = has('--report-unused-disable-directives');
  const configPathArg = valOf('--config');
  const reportArg = has('--report') ? (valOf('--report') && !valOf('--report').startsWith('-') ? valOf('--report') : 'miraat-report.html') : null;
  const format = valOf('--format');
  const VALID_FORMATS = new Set(['github', 'gitlab-codequality', 'junit']);
  if (format && !VALID_FORMATS.has(format)) {
    console.error(`miraat: unknown --format "${format}" (use: ${[...VALID_FORMATS].join(' | ')})`);
    process.exit(2);
  }
  // positional target: the first non-flag arg that isn't a flag's value
  const reportFileVal = has('--report') ? valOf('--report') : null;
  const flagValues = new Set([configPathArg, format, reportFileVal && !reportFileVal.startsWith('-') ? reportFileVal : null].filter(Boolean));
  const target = args.find(a => !a.startsWith('-') && !flagValues.has(a)) || '.';
  const willWrite = doFix && !dryRun && !check && !suppressAll && !pruneSuppressions;
  const rel = f => path.relative(process.cwd(), f) || f;
  const relKey = f => rel(f).split(path.sep).join('/');

  if (initRules) {
    const written = writeAgentRules(target);
    for (const w of written) console.log(`  ✓ ${path.join(target, w.file)}  (${w.label})`);
    console.log(`\nInjected AST-authoritative RTL rules into ${written.length} agent files — Claude Code, Cursor, Gemini CLI, Windsurf, Cline, Copilot & Codex will stop re-introducing RTL bugs. Idempotent: re-run anytime to update in place.`);
    return;
  }

  // Governance: per-rule severity (config) + .gitignore/.miraatignore matching.
  let sevRules = {};
  if (!noConfig) {
    try { sevRules = loadConfig(target, configPathArg).rules; }
    catch (e) { console.error(e.message); process.exit(2); }
  }
  const isDir = (() => { try { return fs.statSync(target).isDirectory(); } catch { return false; } })();
  const root = isDir ? target : path.dirname(target);
  const ignored = noIgnore ? () => false : loadIgnore(root);

  let files;
  try { files = isDir ? walk(target, { root: target, ignored }) : [target]; }
  catch { console.error(`miraat: cannot read ${target}`); process.exit(2); }

  // --cache: skip the expensive AST parse for files whose content is byte-identical
  // to the last run (keyed by sha1(src); the whole cache is invalidated when the
  // miraat version changes, since scanner logic — not config — decides findings).
  // Disabled on --fix runs (fixes must actually apply). Stored at <root>/.miraatcache.
  const cachePath = path.join(root, '.miraatcache');
  const cacheActive = useCache && !willWrite;
  let oldCache = {};
  if (cacheActive) {
    try { const c = JSON.parse(fs.readFileSync(cachePath, 'utf8')); if (c && c.version === VERSION) oldCache = c.files || {}; } catch {}
  }
  const newCache = {};
  let cacheHits = 0;

  let filesTouched = 0, scannedFiles = 0, totalLines = 0, disabledCount = 0;
  const byFile = {};              // absolute file -> kept findings (post inline-disable + severity)
  const unusedDirectives = [];    // { file, line, type }
  for (const file of files) {
    let src; try { if (fs.statSync(file).size > MAX_FILE_BYTES) continue; src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    scannedFiles++;
    totalLines += src.length ? src.split('\n').length : 0;
    let findings, fixed = src;
    const hash = cacheActive ? crypto.createHash('sha1').update(src).digest('hex') : null;
    const k = cacheActive ? relKey(file) : null;
    if (cacheActive && oldCache[k] && oldCache[k].hash === hash) {
      findings = oldCache[k].findings;                 // reuse: content unchanged since last run
      cacheHits++;
    } else {
      ({ findings, fixed } = scanSource(file, src));
    }
    if (cacheActive) newCache[k] = { hash, findings };
    if (willWrite && fixed !== src) { fs.writeFileSync(file, fixed); filesTouched++; }
    // A clean file still needs a directive pass when we're reporting unused ones.
    if (!findings.length && !reportUnused) continue;
    // 1) inline-disable directives
    const { kept, disabled, unused } = applyDirectives(src, findings);
    disabledCount += disabled.length;
    for (const d of unused) unusedDirectives.push({ file, line: d.line, type: d.type });
    // 2) per-rule severity: drop `off` rules; annotate the rest
    const shown = [];
    for (const f of kept) {
      const level = severityFor(f, sevRules);
      if (level === 'off') continue;
      shown.push(Object.assign({ level }, f));
    }
    if (shown.length) byFile[file] = shown;
  }

  // Persist the cache (report runs only). Best-effort — a write failure never
  // breaks a scan; the next run just re-parses.
  if (cacheActive) {
    try { fs.writeFileSync(cachePath, JSON.stringify({ version: VERSION, files: newCache })); } catch {}
  }

  // 3) baseline: suppress-all / prune write the snapshot and exit; otherwise
  //    filter current findings so only debt BEYOND the baseline is reported.
  const byFileRel = {};
  for (const f of Object.keys(byFile)) byFileRel[relKey(f)] = byFile[f];

  if (suppressAll) {
    const counts = baseline.build(byFileRel);
    baseline.write(root, counts);
    const total = Object.values(byFileRel).reduce((n, a) => n + a.length, 0);
    console.log(`✓ wrote ${path.join(root, baseline.BASELINE_FILE)} — ${total} existing findings across ${Object.keys(counts).length} files baselined.`);
    console.log(`  From now on \x1b[1mmiraat ${target} --check\x1b[0m fails only on NEW RTL debt. Run \x1b[1m--prune-suppressions\x1b[0m after fixing to shrink it.`);
    process.exit(0);
  }
  if (pruneSuppressions) {
    const existing = baseline.load(root);
    if (!existing) { console.error(`miraat: no ${baseline.BASELINE_FILE} to prune (run --suppress-all first).`); process.exit(2); }
    const pruned = baseline.prune(existing, byFileRel);
    baseline.write(root, pruned);
    const before = Object.values(existing.counts || {}).reduce((n, o) => n + Object.values(o).reduce((m, c) => m + c, 0), 0);
    const after = Object.values(pruned).reduce((n, o) => n + Object.values(o).reduce((m, c) => m + c, 0), 0);
    console.log(`✓ pruned ${baseline.BASELINE_FILE}: ${before} → ${after} baselined findings (${before - after} resolved).`);
    process.exit(0);
  }

  const base = baseline.load(root);
  let baselineSuppressed = 0;
  if (base) {
    const counts = base.counts || {};
    for (const file of Object.keys(byFile)) {
      const budget = Object.assign({}, counts[relKey(file)] || {});
      const keep = [];
      for (const f of byFile[file]) {
        if (budget[f.rule] > 0) { budget[f.rule]--; baselineSuppressed++; }
        else keep.push(f);
      }
      if (keep.length) byFile[file] = keep; else delete byFile[file];
    }
  }

  // Final counts reflect what actually remains after governance filtering.
  let fixCount = 0, flagCount = 0, errorCount = 0, warnCount = 0;
  for (const arr of Object.values(byFile)) for (const f of arr) {
    (f.sev === 'fix' ? fixCount++ : flagCount++);
    (f.level === 'error' ? errorCount++ : warnCount++);
  }
  const score = computeScore({ fixCount, flagCount, files: scannedFiles, lines: totalLines });

  // Unified exit code. --check gates CI on ANY remaining finding (beyond
  // baseline/disable/off); a plain scan fails only on unaddressed `error`-level
  // findings; a --fix run that wrote fixes never fails.
  const exitCode = () => {
    if (check) return (fixCount + flagCount) > 0 ? 1 : 0;
    if (willWrite) return 0;
    return errorCount > 0 ? 1 : 0;
  };
  // One-line note about what governance silenced this run (only when relevant).
  const govNote = () => {
    const bits = [];
    if (baselineSuppressed) bits.push(`${baselineSuppressed} baselined`);
    if (disabledCount) bits.push(`${disabledCount} inline-disabled`);
    const shown = bits.length ? `\x1b[2m(${bits.join(' · ')} not shown)\x1b[0m` : '';
    const cache = cacheHits ? `\x1b[2m(${cacheHits} cached)\x1b[0m` : '';
    return [shown, cache].filter(Boolean).join('  ');
  };
  const reportUnusedDirectives = () => {
    if (!reportUnused || !unusedDirectives.length) return;
    console.log(`\n\x1b[33m${unusedDirectives.length} unused miraat-disable directive(s):\x1b[0m`);
    for (const u of unusedDirectives) console.log(`  \x1b[2m${rel(u.file)}:${u.line}\x1b[0m  ${u.type} matched no finding`);
  };

  if (asBadge) { console.log(badgeSvg(score)); process.exit(0); }

  if (asScore) {
    if (asJson) { console.log(JSON.stringify(score, null, 2)); }
    else {
      const c = { A: 32, B: 36, C: 33, D: 33, F: 31 }[score.grade] || 33;
      console.log(`\x1b[1mMiraat RTL Score\x1b[0m  \x1b[${c}m${score.score}/100  (${score.grade})\x1b[0m`);
      console.log(`\x1b[2m${score.files} files · ${score.lines} lines · ${score.fixable} fixable · ${score.flags} to review\x1b[0m`);
    }
    process.exit(0);
  }

  if (asSarif) {
    console.log(JSON.stringify(buildSarif(byFile, rel), null, 2));
    // SARIF is an artifact to upload; the gate belongs to --check. Exit 0 so a
    // `> results.sarif` redirect always produces a valid file for upload-sarif.
    process.exit(0);
  }

  if (format) {
    console.log(formatReport(format, byFile, rel));
    // github annotations gate the step (exit reflects pass/fail); gitlab/junit
    // are report artifacts the platform ingests, so they always exit 0.
    process.exit(format === 'github' ? exitCode() : 0);
  }

  if (reportArg) {
    let generatedAt = null;
    try { generatedAt = new Date().toISOString().slice(0, 10); } catch {}
    const html = buildHtmlReport({ score, byFile, rel, generatedAt });
    try { fs.writeFileSync(reportArg, html); }
    catch (e) { console.error(`miraat: cannot write ${reportArg}: ${e.message}`); process.exit(2); }
    console.log(`✓ wrote ${reportArg} — Miraat RTL Correctness Report (${score.score}/100, grade ${score.grade}).`);
    process.exit(exitCode());
  }

  if (asJson) {
    const out = {
      version: VERSION, files: files.length, fixable: fixCount, flags: flagCount,
      errors: errorCount, warnings: warnCount,
      baselineSuppressed, inlineDisabled: disabledCount,
      unusedDisableDirectives: unusedDirectives.map(u => ({ file: rel(u.file), line: u.line, type: u.type })),
      findings: Object.entries(byFile).flatMap(([f, arr]) => arr.map(x => ({ file: rel(f), ...x }))),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(exitCode());
  }

  for (const file of Object.keys(byFile)) {
    console.log(`\n\x1b[1m${rel(file)}\x1b[0m`);
    for (const f of byFile[file]) {
      const tag = f.level === 'error' ? '\x1b[31mERR \x1b[0m'
        : f.sev === 'fix' ? '\x1b[32mFIX \x1b[0m' : '\x1b[33mFLAG\x1b[0m';
      const arrow = f.to ? `  ${f.from} → ${f.to}` : `  ${f.from}`;
      console.log(`  ${tag} :${f.line}${arrow}  \x1b[2m${f.msg}\x1b[0m`);
    }
  }
  reportUnusedDirectives();

  const note = govNote();
  console.log(`\n\x1b[1mmiraat v${VERSION}\x1b[0m  ${files.length} files  ·  \x1b[32m${fixCount} auto-fixable\x1b[0m  ·  \x1b[33m${flagCount} to review\x1b[0m${note ? '  ' + note : ''}`);
  if (willWrite) console.log(`✓ applied ${filesTouched ? fixCount : 0} fixes across ${filesTouched} files.`);
  else if (dryRun) console.log(`(dry-run) ${fixCount} fixes would be applied across the files above — nothing written.`);
  else if (fixCount) console.log(`→ run \x1b[1mmiraat ${target} --fix\x1b[0m to apply the ${fixCount} safe fixes. The FLAGs need your eye (that's the part AI can't do).`);
  if (!fixCount && !flagCount) console.log(`✓ clean — no RTL issues found.${note ? '  ' + note : ''}`);

  process.exit(exitCode());
}

main();
