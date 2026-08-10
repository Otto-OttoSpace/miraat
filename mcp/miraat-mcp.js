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

// Primary tools are miraat_*. The rtlint_* (and legacy rtl_*) names are kept as
// aliases so existing MCP configs keep working after the rebrand.
const TOOLS = [
  { name: 'miraat_scan',        description: SCAN_DESC,  inputSchema: SCAN_SCHEMA  },
  { name: 'miraat_check_code',  description: CHECK_DESC, inputSchema: CHECK_SCHEMA },
  { name: 'rtlint_scan',        description: SCAN_DESC + ' (alias of miraat_scan)',        inputSchema: SCAN_SCHEMA  },
  { name: 'rtlint_check_code',  description: CHECK_DESC + ' (alias of miraat_check_code)', inputSchema: CHECK_SCHEMA },
  { name: 'rtl_scan',           description: SCAN_DESC + ' (legacy alias of miraat_scan)',        inputSchema: SCAN_SCHEMA  },
  { name: 'rtl_check_code',     description: CHECK_DESC + ' (legacy alias of miraat_check_code)', inputSchema: CHECK_SCHEMA },
];

// A caller-supplied scan `path` must not be readable as a flag (`--init-rules`,
// `--fix`, …) that would hijack the CLI into writing/rewriting files instead of
// scanning. Reject leading-dash and prefix a bare relative path with `./`.
function safeScanPath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('-')) return null;
  if (!path.isAbsolute(p) && !p.startsWith('./') && !p.startsWith('../')) return './' + p;
  return p;
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
  if (name.endsWith('_check_code')) {
    // `ext` is attacker-controlled and gets joined into a temp path, so accept
    // only a leading dot followed by alphanumerics (no '/', '\\', '..' or other
    // separators). Anything else — including `.x/../../etc/passwd` — falls back
    // to the safe default, preventing an arbitrary-write/-delete path traversal
    // (this tool also runs --fix on the temp file, so the write is destructive).
    const ext = typeof args.ext === 'string' && /^\.[A-Za-z0-9]+$/.test(args.ext) ? args.ext : '.tsx';
    const tmp = path.join(os.tmpdir(), `miraat-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`);
    fs.writeFileSync(tmp, args.code);
    let report = {};
    try { report = JSON.parse(runCli([tmp, '--json']) || '{}'); } catch {}
    runCli([tmp, '--fix']);
    const fixed = fs.readFileSync(tmp, 'utf8');
    try { fs.unlinkSync(tmp); } catch {}
    // Scrub the internal temp path from the report before returning — the caller
    // passed CODE, not a file, so a `file` field pointing at os.tmpdir() is noise
    // and, on Windows, leaks the username (C:\Users\<name>\AppData\Local\Temp).
    // Replace both the raw path and its JSON-escaped form (backslashes doubled).
    const scrub = s => s.split(tmp).join('<snippet>').split(JSON.stringify(tmp).slice(1, -1)).join('<snippet>');
    return scrub(JSON.stringify({ report, fixed }, null, 2));
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
