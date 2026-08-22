#!/usr/bin/env node
'use strict';
/*
 * miraat LSP — the editor surface, and the move that turns miraat from "a tool
 * you remember to run" into a default. Speaks the Language Server Protocol over
 * stdio (Content-Length framing), so ONE server lights up VS Code, Cursor,
 * Windsurf, Neovim and JetBrains. It publishes RTL diagnostics as you type and
 * offers quick-fixes that reuse miraat's zero-corruption AST auto-fixer.
 *
 * It runs the SAME pipeline as the CLI — inline-disable directives and
 * miraat.config.json per-rule severity are honoured — so the squiggles in the
 * editor match `npx miraat .` exactly. No RTL LSP exists anywhere; this is it.
 */
const path = require('path');
const url = require('url');
const { scanSource } = require('../lib/rtlint-core');
const { severityFor, loadConfig } = require('../lib/config');
const { applyDirectives } = require('../lib/directives');
const VERSION = require('../package.json').version;

// LSP DiagnosticSeverity. By default we stay gentle — judgment-call flags →
// Warning (stand out), mechanical fixes → Information (subtle) — since RTL
// issues aren't compile errors. But if a team EXPLICITLY sets a rule to `error`
// in their config, the editor shows a red Error to mirror the CI hard-fail they
// opted into (naturalSeverity's default `error` for flags is NOT treated as red).
const SEV = { Error: 1, Warning: 2, Information: 3, Hint: 4 };

// ── stdio JSON-RPC with LSP Content-Length framing (byte-accurate) ──
let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); drain(); });
process.stdin.on('end', () => process.exit(0));

function drain() {
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString('ascii');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) { buffer = buffer.slice(headerEnd + 4); continue; }
    const len = parseInt(m[1], 10);
    const start = headerEnd + 4;
    if (buffer.length < start + len) return;           // wait for the rest of the body
    const body = buffer.slice(start, start + len).toString('utf8');
    buffer = buffer.slice(start + len);
    let msg; try { msg = JSON.parse(body); } catch { continue; }
    try { handle(msg); } catch (e) { process.stderr.write('miraat-lsp: ' + e.message + '\n'); }
  }
}

function send(msg) {
  const buf = Buffer.from(JSON.stringify(msg), 'utf8');
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`);
  process.stdout.write(buf);
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

const docs = new Map();   // uri -> current text

function uriToPath(uri) {
  try { return url.fileURLToPath(uri); } catch { return String(uri).replace(/^file:\/\//, ''); }
}

// Same pipeline as the CLI: scan → inline-disable → per-rule severity.
function computeDiagnostics(uri, text) {
  const file = uriToPath(uri);
  let findings;
  try { ({ findings } = scanSource(file, text)); } catch { return []; }
  if (!findings || !findings.length) return [];
  const { kept } = applyDirectives(text, findings);
  let rules = {};
  try { rules = loadConfig(path.dirname(file)).rules; } catch {}
  const lines = text.split('\n');
  const diags = [];
  for (const f of kept) {
    const configured = rules && rules[f.rule];   // the user's explicit severity, if any
    const level = configured || severityFor(f, rules);
    if (level === 'off') continue;
    const lineIdx = Math.max(0, (f.line || 1) - 1);
    const lineText = lines[lineIdx] || '';
    let startCh = 0, endCh = lineText.length;
    if (f.from) {
      const at = lineText.indexOf(f.from);
      if (at !== -1) { startCh = at; endCh = at + f.from.length; }
    }
    diags.push({
      range: { start: { line: lineIdx, character: startCh }, end: { line: lineIdx, character: endCh } },
      severity: configured === 'error' ? SEV.Error      // explicitly opted-in → red, mirrors CI
              : level === 'error'      ? SEV.Warning     // judgment-call flag → yellow (advisory)
              : SEV.Information,                          // mechanical fix → subtle
      source: 'miraat',
      code: f.rule,
      message: f.to ? `${f.msg} (${f.from} → ${f.to})` : `${f.msg} (${f.from})`,
      // round-tripped back to us in codeAction so we can offer the exact fix
      data: { from: f.from, to: f.to || null, sev: f.sev },
    });
  }
  return diags;
}

function publish(uri, text) {
  notify('textDocument/publishDiagnostics', { uri, diagnostics: computeDiagnostics(uri, text) });
}

function codeActions(params) {
  const uri = params.textDocument.uri;
  const text = docs.get(uri);
  if (text == null) return [];
  const actions = [];
  // Per-finding quick-fixes (token replacement of the flagged range).
  for (const d of (params.context && params.context.diagnostics) || []) {
    if (d.source !== 'miraat' || !d.data || !d.data.to) continue;
    actions.push({
      title: `miraat: fix ${d.data.from} → ${d.data.to}`,
      kind: 'quickfix',
      diagnostics: [d],
      edit: { changes: { [uri]: [{ range: d.range, newText: d.data.to }] } },
    });
  }
  // Fix-all: whole-file, AST-safe (only the mechanical fixes miraat auto-applies).
  let fixed = text;
  try { ({ fixed } = scanSource(uriToPath(uri), text)); } catch {}
  if (fixed !== text) {
    const lines = text.split('\n');
    const end = { line: lines.length - 1, character: lines[lines.length - 1].length };
    actions.push({
      title: 'miraat: fix all safe RTL issues in this file',
      kind: 'source.fixAll.miraat',
      edit: { changes: { [uri]: [{ range: { start: { line: 0, character: 0 }, end }, newText: fixed }] } },
    });
  }
  return actions;
}

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return reply(id, {
        capabilities: {
          textDocumentSync: { openClose: true, change: 1, save: { includeText: true } }, // 1 = full
          codeActionProvider: { codeActionKinds: ['quickfix', 'source.fixAll.miraat'] },
        },
        serverInfo: { name: 'miraat-lsp', version: VERSION },
      });
    case 'initialized': return;
    case 'shutdown': return reply(id, null);
    case 'exit': return process.exit(0);
    case 'textDocument/didOpen': {
      const { uri, text } = params.textDocument;
      docs.set(uri, text);
      return publish(uri, text);
    }
    case 'textDocument/didChange': {
      const uri = params.textDocument.uri;
      const changes = params.contentChanges || [];
      if (!changes.length) return;
      const text = changes[changes.length - 1].text;   // full-document sync
      docs.set(uri, text);
      return publish(uri, text);
    }
    case 'textDocument/didSave': {
      const uri = params.textDocument.uri;
      const text = params.text != null ? params.text : docs.get(uri) || '';
      docs.set(uri, text);
      return publish(uri, text);
    }
    case 'textDocument/didClose': {
      const uri = params.textDocument.uri;
      docs.delete(uri);
      return notify('textDocument/publishDiagnostics', { uri, diagnostics: [] });
    }
    case 'textDocument/codeAction':
      return reply(id, codeActions(params));
    default:
      if (id !== undefined) reply(id, null);            // unknown request → null (never hang the client)
  }
}

process.stderr.write(`miraat LSP server v${VERSION} ready\n`);
