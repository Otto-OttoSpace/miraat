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
const { scanSource } = require('../lib/rtlint-core');

const VERSION = require('../package.json').version;

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.vue', '.svelte', '.astro']);
const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const IGNORE_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', 'vendor', '.svelte-kit']);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (IGNORE_DIR.has(name) || (name.startsWith('.') && name !== '.')) continue;
    const full = path.join(dir, name);
    let st; try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else {
      const ext = path.extname(full);
      if (CODE_EXT.has(ext) || CSS_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

// The RTL rule-set injected into AI coding agents so they stop RE-introducing
// the bugs miraat catches. Derived from miraat's own AST rules → authoritative.
const RULES_BODY = `Follow these whenever you write or edit UI, so it renders correctly in every right-to-left script (Arabic, Persian, Urdu, Hebrew, Syriac, Thaana, N'Ko, Adlam) — not just left-to-right English.

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
15. Add miraat's MCP server so you can self-check RTL before proposing code: \`npx miraat-mcp\`. Companions: \`kashida\` (Arabic shaping/font proof), \`lahja\` (missing translations), \`daleel\` (Gulf/DGA + WCAG compliance).`;

const MARK_START = '<!-- miraat:rtl-rules — auto-generated; edits between the markers are overwritten by \`miraat --init-rules\` -->';
const MARK_END = '<!-- /miraat:rtl-rules -->';
const HEADING = '# RTL rules for AI coding agents (generated by miraat)';
const BLOCK = `${MARK_START}\n${HEADING}\n\n${RULES_BODY}\n${MARK_END}`;
const CURSOR_MDC = `---\ndescription: Arabic / RTL correctness — apply when writing or editing any UI. Stops the RTL bugs AI code tools introduce.\nglobs: ["**/*.{js,jsx,ts,tsx,css,scss,vue,svelte,html,astro}"]\nalwaysApply: true\n---\n\n${HEADING}\n\n${RULES_BODY}\n`;

// AI-agent config files to inject the rule-set into (the "immune system").
const AGENT_TARGETS = [
  { file: 'CLAUDE.md', label: 'Claude Code' },
  { file: 'AGENTS.md', label: 'Codex / generic agents' },
  { file: '.windsurfrules', label: 'Windsurf' },
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
  npx miraat [path] --fix        apply the safe fixes (physical -> logical)
  npx miraat [path] --check      report only, exit non-zero if anything found (CI)
  npx miraat [path] --dry-run    show what --fix would change, but write nothing
  npx miraat [path] --json       machine-readable output
  npx miraat [path] --init-rules inject RTL rules into every AI editor
                                 (CLAUDE.md · .cursor · .windsurfrules · Copilot · AGENTS.md)
  npx miraat --help | --version

Auto-fixes physical CSS/Tailwind/JS-style -> logical (AST-verified, so custom
classes, selectors, comments and identifiers are never touched). Flags the
parts that need a human who reads the script (icons, fonts, dir, bidi, numerals).`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { console.log(VERSION); return; }
  const doFix = args.includes('--fix');
  const asJson = args.includes('--json');
  const check = args.includes('--check');
  const dryRun = args.includes('--dry-run');
  const initRules = args.includes('--init-rules');
  const target = args.find(a => !a.startsWith('-')) || '.';
  const willWrite = doFix && !dryRun && !check;

  if (initRules) {
    const written = writeAgentRules(target);
    for (const w of written) console.log(`  ✓ ${path.join(target, w.file)}  (${w.label})`);
    console.log(`\nInjected AST-authoritative RTL rules into ${written.length} agent files — Cursor, Claude Code, Copilot, Windsurf & Codex will stop re-introducing RTL bugs. Idempotent: re-run anytime to update in place.`);
    return;
  }

  let files;
  try { files = fs.statSync(target).isDirectory() ? walk(target) : [target]; }
  catch { console.error(`rtlint: cannot read ${target}`); process.exit(2); }

  let fixCount = 0, flagCount = 0, filesTouched = 0;
  const byFile = {};
  for (const file of files) {
    let src; try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const { findings, fixed } = scanSource(file, src);
    if (!findings.length) continue;
    byFile[file] = findings;
    for (const f of findings) (f.sev === 'fix' ? fixCount++ : flagCount++);
    if (willWrite && fixed !== src) { fs.writeFileSync(file, fixed); filesTouched++; }
  }

  const rel = f => path.relative(process.cwd(), f) || f;

  if (asJson) {
    const out = {
      version: VERSION, files: files.length, fixable: fixCount, flags: flagCount,
      findings: Object.entries(byFile).flatMap(([f, arr]) => arr.map(x => ({ file: rel(f), ...x }))),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(flagCount > 0 && !willWrite ? 1 : 0);
  }

  for (const file of Object.keys(byFile)) {
    console.log(`\n\x1b[1m${rel(file)}\x1b[0m`);
    for (const f of byFile[file]) {
      const tag = f.sev === 'fix' ? '\x1b[32mFIX \x1b[0m' : '\x1b[33mFLAG\x1b[0m';
      const arrow = f.to ? `  ${f.from} → ${f.to}` : `  ${f.from}`;
      console.log(`  ${tag} :${f.line}${arrow}  \x1b[2m${f.msg}\x1b[0m`);
    }
  }

  console.log(`\n\x1b[1mmiraat v${VERSION}\x1b[0m  ${files.length} files  ·  \x1b[32m${fixCount} auto-fixable\x1b[0m  ·  \x1b[33m${flagCount} to review\x1b[0m`);
  if (willWrite) console.log(`✓ applied ${fixCount} fixes across ${filesTouched} files.`);
  else if (dryRun) console.log(`(dry-run) ${fixCount} fixes would be applied across the files above — nothing written.`);
  else if (fixCount) console.log(`→ run \x1b[1mmiraat ${target} --fix\x1b[0m to apply the ${fixCount} safe fixes. The FLAGs need your eye (that's the part AI can't do).`);
  if (!fixCount && !flagCount) console.log('✓ clean — no RTL issues found.');

  // --check: fail CI on ANY finding. Otherwise fail only when flags remain unaddressed.
  if (check) process.exit(fixCount + flagCount > 0 ? 1 : 0);
  process.exit(flagCount > 0 && !willWrite ? 1 : 0);
}

main();
