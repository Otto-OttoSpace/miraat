#!/usr/bin/env node
'use strict';
/*
 * rtlint — find & fix the RTL/Arabic mistakes AI code tools keep making.
 * v0.2 — zero-dependency. Scans a repo, reports the failure patterns,
 * auto-fixes the safe mechanical ones (physical -> logical), and can
 * write an AI-rules file so your agent stops reintroducing them.
 */
const fs = require('fs');
const path = require('path');

const VERSION = '0.2.0';
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.html', '.vue', '.svelte', '.astro']);
const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const IGNORE_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', 'vendor', '.svelte-kit']);

// ---- Tailwind physical -> logical utility mapping (variant/negative aware) ----
function mapTailwindToken(tok) {
  const ci = tok.lastIndexOf(':');
  const prefix = ci === -1 ? '' : tok.slice(0, ci + 1);
  let util = ci === -1 ? tok : tok.slice(ci + 1);
  const neg = util.startsWith('-') ? '-' : '';
  if (neg) util = util.slice(1);

  let out = null;
  if (util.startsWith('scroll-ml-')) out = 'scroll-ms-' + util.slice(10);
  else if (util.startsWith('scroll-mr-')) out = 'scroll-me-' + util.slice(10);
  else if (util.startsWith('scroll-pl-')) out = 'scroll-ps-' + util.slice(10);
  else if (util.startsWith('scroll-pr-')) out = 'scroll-pe-' + util.slice(10);
  else if (util.startsWith('ml-')) out = 'ms-' + util.slice(3);
  else if (util.startsWith('mr-')) out = 'me-' + util.slice(3);
  else if (util.startsWith('pl-')) out = 'ps-' + util.slice(3);
  else if (util.startsWith('pr-')) out = 'pe-' + util.slice(3);
  else if (util.startsWith('left-')) out = 'start-' + util.slice(5);
  else if (util.startsWith('right-')) out = 'end-' + util.slice(6);
  else if (util === 'text-left') out = 'text-start';
  else if (util === 'text-right') out = 'text-end';
  else if (util === 'float-left') out = 'float-start';
  else if (util === 'float-right') out = 'float-end';
  else if (util === 'clear-left') out = 'clear-start';
  else if (util === 'clear-right') out = 'clear-end';
  else if (util === 'rounded-l' || util.startsWith('rounded-l-')) out = 'rounded-s' + util.slice(9);
  else if (util === 'rounded-r' || util.startsWith('rounded-r-')) out = 'rounded-e' + util.slice(9);
  else if (util === 'border-l' || util.startsWith('border-l-')) out = 'border-s' + util.slice(8);
  else if (util === 'border-r' || util.startsWith('border-r-')) out = 'border-e' + util.slice(8);

  return out === null ? null : prefix + neg + out;
}

function transformClassString(str) {
  const changes = [];
  const parts = str.split(/(\s+)/);
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    if (!t.trim() || t.includes('${') || t.includes('{')) continue;
    const mapped = mapTailwindToken(t);
    if (mapped && mapped !== t) { changes.push([t, mapped]); parts[i] = mapped; }
  }
  return { out: parts.join(''), changes };
}

// ---- CSS physical -> logical property mapping (auto-fix) ----
const CSS_RULES = [
  [/margin-left/g, 'margin-inline-start'],
  [/margin-right/g, 'margin-inline-end'],
  [/padding-left/g, 'padding-inline-start'],
  [/padding-right/g, 'padding-inline-end'],
  [/border-left/g, 'border-inline-start'],
  [/border-right/g, 'border-inline-end'],
  [/text-align:\s*left/g, 'text-align: start'],
  [/text-align:\s*right/g, 'text-align: end'],
  [/float:\s*left/g, 'float: inline-start'],
  [/float:\s*right/g, 'float: inline-end'],
  [/clear:\s*left/g, 'clear: inline-start'],
  [/clear:\s*right/g, 'clear: inline-end'],
];

// ---- JS inline-style physical keys -> logical (auto-fix) ----
const JS_RULES = [
  [/\bmarginLeft(\s*:)/g, 'marginInlineStart$1'],
  [/\bmarginRight(\s*:)/g, 'marginInlineEnd$1'],
  [/\bpaddingLeft(\s*:)/g, 'paddingInlineStart$1'],
  [/\bpaddingRight(\s*:)/g, 'paddingInlineEnd$1'],
  [/(\btextAlign\s*:\s*['"])left(['"])/g, '$1start$2'],
  [/(\btextAlign\s*:\s*['"])right(['"])/g, '$1end$2'],
];

// ---- FLAG-only patterns (need human judgment = the moat) ----
const FLAGS = [
  { re: /\b(Chevron|Arrow|Caret)(Left|Right)\b/g, msg: 'directional icon — mirror it for RTL (or use a logical/auto-flipping icon)' },
  { re: /dir=["']ltr["']/g, msg: 'hard-coded dir="ltr" — make direction dynamic (dir={locale.dir})' },
  { re: /border-top-left-radius|border-top-right-radius|border-bottom-left-radius|border-bottom-right-radius/g, msg: 'physical corner radius — use logical (border-start-start-radius, etc.)' },
  { re: /rounded-t[lr]|rounded-b[lr]/g, msg: 'physical Tailwind corner — use logical (rounded-ss/se/ee/es)' },
  { re: /font-family:[^;]*\b(Inter|Roboto|Helvetica|Arial)\b(?![^;]*[Aa]rabic)/g, msg: 'Latin-only font stack — add an Arabic font fallback (e.g. "Cairo","IBM Plex Sans Arabic")' },
];

const CLASS_ATTR = /\b(class(?:Name)?)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g;
function lineOf(src, index) { return src.slice(0, index).split('\n').length; }

// Report each match from the ORIGINAL src (correct line numbers), then apply
// the fix with a plain string replace so $1/$2 back-references interpolate.
function applyRules(rules, src, fixed, file, findings, msg) {
  for (const [re, repl] of rules) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(src)) !== null) {
      findings.push({ file, line: lineOf(src, m.index), sev: 'fix', from: m[0].trim(), to: repl.includes('$') ? '' : repl, msg });
      if (m.index === r.lastIndex) r.lastIndex++;
    }
    fixed = fixed.replace(re, repl);
  }
  return fixed;
}

function scanFile(file, src) {
  const ext = path.extname(file);
  const findings = [];
  let fixed = src;

  if (CODE_EXT.has(ext)) {
    fixed = fixed.replace(CLASS_ATTR, (m, attr, d, s, cd, cs, ct) => {
      const raw = d ?? s ?? cd ?? cs ?? ct;
      if (raw == null) return m;
      const { out, changes } = transformClassString(raw);
      for (const [from, to] of changes) findings.push({ file, line: lineOf(src, src.indexOf(m)), sev: 'fix', from, to, msg: 'physical Tailwind utility → logical' });
      return changes.length ? m.replace(raw, out) : m;
    });
    fixed = applyRules(JS_RULES, src, fixed, file, findings, 'inline JS style physical property → logical');
  }
  if (CSS_EXT.has(ext)) {
    fixed = applyRules(CSS_RULES, src, fixed, file, findings, 'physical CSS property → logical');
  }
  for (const f of FLAGS) {
    let m; const re = new RegExp(f.re.source, f.re.flags);
    while ((m = re.exec(src)) !== null) {
      findings.push({ file, line: lineOf(src, m.index), sev: 'flag', from: m[0], msg: f.msg });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return { findings, fixed };
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (IGNORE_DIR.has(name) || (name.startsWith('.') && name !== '.')) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(full)) || CSS_EXT.has(path.extname(full))) out.push(full);
  }
  return out;
}

const RULES_DOC = `# RTL rules for AI coding agents (generated by rtlint)
Follow these when writing or editing UI so Arabic / RTL renders correctly.
1. Never use physical CSS: use logical properties — margin-inline-start/end, padding-inline-start/end, inset-inline-start/end, border-inline-start/end, and text-align: start/end (not left/right); float/clear: inline-start/end.
2. Tailwind: use ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-s/rounded-e/border-s/border-e/scroll-ms-/float-start — never ml/mr/pl/pr/left/right/text-left/text-right/rounded-l/r/border-l/r.
3. Set direction dynamically: <html dir={locale.dir}> — never hard-code dir="ltr".
4. Mirror directional icons (chevrons, arrows, back/next) for RTL. Never mirror non-directional icons.
5. Use an Arabic-capable font with a fallback (e.g. "Cairo","IBM Plex Sans Arabic", system-ui). Body Arabic >= 16px, line-height >= 1.5.
6. Use Arabic-Indic numerals / locale-aware date & currency where the locale calls for it. Wrap bidi-mixed content in <bdi>.
`;

const HELP = `rtlint v${VERSION} — find & fix the RTL/Arabic mistakes AI code tools make

Usage:
  npx rtlint [path]              scan and report (default path: .)
  npx rtlint [path] --fix        apply the safe fixes (physical -> logical)
  npx rtlint [path] --json       machine-readable output (for CI)
  npx rtlint [path] --init-rules write RTL-RULES.md for your AI agent
  npx rtlint --help | --version

Auto-fixes physical CSS/Tailwind/JS-style -> logical. Flags the parts that
need a human who reads Arabic (icons, fonts, dir, bidi) — that's the point.`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { console.log(VERSION); return; }
  const doFix = args.includes('--fix');
  const asJson = args.includes('--json');
  const initRules = args.includes('--init-rules');
  const target = args.find(a => !a.startsWith('-')) || '.';

  if (initRules) {
    const dest = path.join(target, 'RTL-RULES.md');
    fs.writeFileSync(dest, RULES_DOC);
    console.log(`✓ wrote ${dest} — point Cursor/Claude at it so they stop breaking RTL.`);
    return;
  }

  let files;
  try { files = fs.statSync(target).isDirectory() ? walk(target) : [target]; }
  catch { console.error(`rtlint: cannot read ${target}`); process.exit(2); }

  let fixCount = 0, flagCount = 0, filesTouched = 0;
  const byFile = {};
  for (const file of files) {
    let src; try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const { findings, fixed } = scanFile(file, src);
    if (!findings.length) continue;
    byFile[file] = findings;
    for (const f of findings) (f.sev === 'fix' ? fixCount++ : flagCount++);
    if (doFix && fixed !== src) { fs.writeFileSync(file, fixed); filesTouched++; }
  }

  if (asJson) {
    const rel = f => path.relative(process.cwd(), f) || f;
    const out = { version: VERSION, files: files.length, fixable: fixCount, flags: flagCount,
      findings: Object.entries(byFile).flatMap(([f, arr]) => arr.map(x => ({ ...x, file: rel(f) }))) };
    console.log(JSON.stringify(out, null, 2));
    process.exit(flagCount > 0 && !doFix ? 1 : 0);
  }

  const rel = f => path.relative(process.cwd(), f) || f;
  for (const file of Object.keys(byFile)) {
    console.log(`\n\x1b[1m${rel(file)}\x1b[0m`);
    for (const f of byFile[file]) {
      const tag = f.sev === 'fix' ? '\x1b[32mFIX \x1b[0m' : '\x1b[33mFLAG\x1b[0m';
      const arrow = f.to ? `  ${f.from} → ${f.to}` : `  ${f.from}`;
      console.log(`  ${tag} :${f.line}${arrow}  \x1b[2m${f.msg}\x1b[0m`);
    }
  }

  console.log(`\n\x1b[1mrtlint v${VERSION}\x1b[0m  ${files.length} files  ·  \x1b[32m${fixCount} auto-fixable\x1b[0m  ·  \x1b[33m${flagCount} to review\x1b[0m`);
  if (doFix) console.log(`✓ applied ${fixCount} fixes across ${filesTouched} files.`);
  else if (fixCount) console.log(`→ run \x1b[1mrtlint ${target} --fix\x1b[0m to apply the ${fixCount} safe fixes. The FLAGs need your eye (that's the part AI can't do).`);
  if (!fixCount && !flagCount) console.log('✓ clean — no RTL issues found.');
  process.exit(flagCount > 0 && !doFix ? 1 : 0);
}

main();
