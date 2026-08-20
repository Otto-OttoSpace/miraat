#!/usr/bin/env node
'use strict';
/*
 * miraat MCP server (formerly rtlint) — lets AI agents (Cursor / Claude /
 * Windsurf) scan & fix RTL bugs across Arabic, Hebrew, Syriac, Thaana, N'Ko and
 * Adlam by calling miraat over the Model Context Protocol.
 * Transport: stdio, newline-delimited JSON-RPC 2.0. Zero dependencies.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'miraat.js');
const VERSION = require('../package.json').version;
const PROTOCOL = '2025-06-18';

function runCli(args) {
  try { return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); } // CLI exits 1 when flags remain
}

const SCAN_DESC = 'Scan a file or directory for the RTL bugs AI code tools introduce — across Arabic, Hebrew, Syriac, Thaana, N\'Ko & Adlam (physical CSS/Tailwind, un-mirrored icons, hard-coded dir="ltr", script-blind fonts, Western digits in native-numeral scripts). Returns JSON findings.';
const SCAN_SCHEMA = { type: 'object', properties: {
  path: { type: 'string', description: 'File or directory to scan' },
  fix: { type: 'boolean', description: 'Apply the safe auto-fixes (physical -> logical)' }
}, required: ['path'] };
const CHECK_DESC = 'Check a snippet of JSX/TSX/CSS for RTL bugs (Arabic, Hebrew, Syriac, Thaana, N\'Ko, Adlam) and return the findings PLUS the auto-fixed code. Call this whenever you write or edit RTL UI.';
const CHECK_SCHEMA = { type: 'object', properties: {
  code: { type: 'string', description: 'The code snippet' },
  ext: { type: 'string', description: 'File extension for context, e.g. .tsx or .css (default .tsx)' }
}, required: ['code'] };
const FIX_DESC = 'Fix the RTL mistakes in a snippet and return the CORRECTED code — call this before you propose ANY UI code so the RTL bug never ships. Applies the safe mechanical fixes (physical CSS/Tailwind/JS-style -> logical) and returns { fixed } as the primary payload, with any remaining judgment calls (icons to mirror, hard-coded dir, fonts, bidi, native numerals) listed separately in flagsToReview for you to decide. Works across Arabic, Hebrew, Syriac, Thaana, N\'Ko & Adlam.';
const FIX_SCHEMA = CHECK_SCHEMA;

// The rest of the RTL/Arabic suite, exposed through this ONE miraat MCP so an
// agent gets typography, i18n and a11y checks over a single connection — not
// four separate servers. Each pack CLI takes a path + --json. Packs are optional
// deps; if one isn't installed the tool returns a one-line install hint.
const PACKS = {
  type: { pkg: 'kashida', desc: 'Check a file/dir for ARABIC TYPOGRAPHY & shaping problems — broken cursive joins, letter-spacing / tracking applied to Arabic, tofu (missing glyphs), script-blind font stacks, ZWNJ issues. HarfBuzz-backed (kashida). Returns JSON.' },
  i18n: { pkg: 'lahja', desc: 'Check a file/dir for INTERNATIONALIZATION problems — hard-coded user-facing strings, missing / empty translation keys, placeholder drift, CLDR plural completeness (Arabic needs zero/one/two/few/many/other). Runs lahja. Returns JSON.' },
  a11y: { pkg: 'daleel', desc: 'Check a file/dir for ACCESSIBILITY problems against WCAG 2.2 AA + the Saudi DGA Platforms-Code — heading order, form labels, alt text, positive tabindex, invalid ARIA, duplicate ids. Runs daleel. Returns JSON.' },
};
const PACK_SCHEMA = { type: 'object', properties: {
  path: { type: 'string', description: 'File or directory to check' }
}, required: ['path'] };

function safeResolve(id) { try { return require.resolve(id); } catch { return null; } }
function resolvePackBin(pkg) {
  const fromMeta = mp => { if (!mp) return null; try { const m = require(mp); const rel = m.bin && (m.bin[pkg] || Object.values(m.bin)[0]); return rel ? path.join(path.dirname(mp), rel) : null; } catch { return null; } };
  return fromMeta(safeResolve(pkg + '/package.json')) || fromMeta(path.join(__dirname, '..', '..', pkg, 'package.json'));
}
function runPack(pkg, args) {
  const bin = resolvePackBin(pkg);
  if (!bin) return JSON.stringify({ error: `the "${pkg}" pack isn't installed`, hint: `npm i -D ${pkg}` }, null, 2);
  try { return execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

// Primary tools are miraat_*. The rtlint_* (and legacy rtl_*) names are kept as
// aliases so existing MCP configs keep working after the rebrand.
const TOOLS = [
  { name: 'miraat_scan',        description: SCAN_DESC,  inputSchema: SCAN_SCHEMA  },
  { name: 'miraat_check_code',  description: CHECK_DESC, inputSchema: CHECK_SCHEMA },
  { name: 'miraat_fix_code',    description: FIX_DESC,   inputSchema: FIX_SCHEMA   },
  { name: 'rtlint_scan',        description: SCAN_DESC + ' (alias of miraat_scan)',        inputSchema: SCAN_SCHEMA  },
  { name: 'rtlint_check_code',  description: CHECK_DESC + ' (alias of miraat_check_code)', inputSchema: CHECK_SCHEMA },
  { name: 'rtlint_fix_code',    description: FIX_DESC + ' (alias of miraat_fix_code)',     inputSchema: FIX_SCHEMA   },
  { name: 'rtl_scan',           description: SCAN_DESC + ' (legacy alias of miraat_scan)',        inputSchema: SCAN_SCHEMA  },
  { name: 'rtl_check_code',     description: CHECK_DESC + ' (legacy alias of miraat_check_code)', inputSchema: CHECK_SCHEMA },
  { name: 'rtl_fix_code',       description: FIX_DESC + ' (legacy alias of miraat_fix_code)',     inputSchema: FIX_SCHEMA   },
  // the rest of the suite through the same server
  { name: 'miraat_type_check',  description: PACKS.type.desc, inputSchema: PACK_SCHEMA },
  { name: 'miraat_i18n_check',  description: PACKS.i18n.desc, inputSchema: PACK_SCHEMA },
  { name: 'miraat_a11y_check',  description: PACKS.a11y.desc, inputSchema: PACK_SCHEMA },
];

// A caller-supplied scan `path` must not be readable as a flag (`--init-rules`,
// `--fix`, …) that would hijack the CLI into writing/rewriting files instead of
// scanning. Reject leading-dash and prefix a bare relative path with `./`.
function safeScanPath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('-')) return null;
  if (!path.isAbsolute(p) && !p.startsWith('./') && !p.startsWith('../')) return './' + p;
  return p;
}

// Scan+fix a code SNIPPET via a temp file. `ext` is attacker-controlled and gets
// joined into a temp path, so accept only a leading dot + alphanumerics (no '/',
// '\\', '..' or separators) — anything else falls back to the safe default,
// preventing an arbitrary-write/-delete path traversal (this also runs --fix on
// the temp file, so the write is destructive). Returns { report, fixed, scrub }
// where scrub() removes the internal temp path (noise, and on Windows it leaks
// the username under C:\Users\<name>\AppData\Local\Temp).
function runOnSnippet(code, extRaw) {
  const ext = typeof extRaw === 'string' && /^\.[A-Za-z0-9]+$/.test(extRaw) ? extRaw : '.tsx';
  const tmp = path.join(os.tmpdir(), `miraat-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`);
  fs.writeFileSync(tmp, code);
  let report = {};
  try { report = JSON.parse(runCli([tmp, '--json']) || '{}'); } catch {}
  runCli([tmp, '--fix']);
  const fixed = fs.readFileSync(tmp, 'utf8');
  try { fs.unlinkSync(tmp); } catch {}
  const scrub = s => s.split(tmp).join('<snippet>').split(JSON.stringify(tmp).slice(1, -1)).join('<snippet>');
  return { report, fixed, scrub };
}

function callTool(name, args) {
  // Route by suffix so miraat_*, rtlint_* and legacy rtl_* all map to one impl.
  if (name.endsWith('_scan')) {
    const p = safeScanPath(args.path);
    if (!p) throw new Error('invalid path (must be a file/dir, not a flag or subcommand)');
    const a = [p, '--json'];
    if (args.fix) a.push('--fix');
    return runCli(a);
  }
  const packMatch = name.match(/_(type|i18n|a11y)_check$/);
  if (packMatch) {
    const p = safeScanPath(args.path);
    if (!p) throw new Error('invalid path (must be a file/dir, not a flag or subcommand)');
    return runPack(PACKS[packMatch[1]].pkg, [p, '--json']);
  }
  if (name.endsWith('_check_code')) {
    const { report, fixed, scrub } = runOnSnippet(args.code, args.ext);
    return scrub(JSON.stringify({ report, fixed }, null, 2));
  }
  if (name.endsWith('_fix_code')) {
    // The RTLify-beater: return the CORRECTED code up front so the agent can use
    // it directly, with the judgment calls miraat won't guess kept separate.
    const { report, fixed, scrub } = runOnSnippet(args.code, args.ext);
    const findings = Array.isArray(report.findings) ? report.findings : [];
    const flagsToReview = findings
      .filter(f => f.sev !== 'fix')
      .map(f => ({ line: f.line, rule: f.rule, at: f.from, issue: f.msg }));
    const applied = report.fixable || 0;
    const out = {
      fixed,
      fixesApplied: applied,
      flagsToReview,
      note: flagsToReview.length
        ? `Applied ${applied} safe RTL fix(es). ${flagsToReview.length} judgment call(s) remain (icons/dir/fonts/bidi/numerals) — decide each in flagsToReview; miraat won't guess.`
        : `Applied ${applied} safe RTL fix(es). No judgment-call issues remain — the code is RTL-clean.`,
    };
    return scrub(JSON.stringify(out, null, 2));
  }
  throw new Error('unknown tool: ' + name);
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'miraat', version: VERSION } } });
  if (method === 'notifications/initialized' || method === 'initialized') return; // notification
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    try {
      const text = callTool(params.name, params.arguments || {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
process.stderr.write(`miraat MCP server v${VERSION} ready\n`);
