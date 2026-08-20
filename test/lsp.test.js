'use strict';
/*
 * LSP server integration suite — drives lsp/miraat-lsp.js over real stdio with
 * Content-Length framing. Locks: initialize advertises the capabilities, an open
 * document publishes RTL diagnostics (respecting inline-disable), and codeAction
 * returns both a per-finding quick-fix and a fix-all. This is the editor surface.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const LSP = path.join(__dirname, '..', 'lsp', 'miraat-lsp.js');

// A tiny LSP client: frame requests, parse Content-Length replies, resolve when
// a predicate matches one of the received messages.
function session(steps, waitFor, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [LSP], { stdio: ['pipe', 'pipe', 'ignore'] });
    const received = [];
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { try { srv.kill(); } catch {} reject(new Error('LSP timeout')); }, timeoutMs);
    const frame = obj => { const b = Buffer.from(JSON.stringify(obj), 'utf8'); srv.stdin.write(`Content-Length: ${b.length}\r\n\r\n`); srv.stdin.write(b); };

    srv.stdout.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const he = buf.indexOf('\r\n\r\n');
        if (he === -1) break;
        const m = /Content-Length:\s*(\d+)/i.exec(buf.slice(0, he).toString('ascii'));
        if (!m) { buf = buf.slice(he + 4); continue; }
        const len = +m[1], start = he + 4;
        if (buf.length < start + len) break;
        const msg = JSON.parse(buf.slice(start, start + len).toString('utf8'));
        buf = buf.slice(start + len);
        received.push(msg);
        const done = waitFor(msg, received);
        if (done) { clearTimeout(timer); try { srv.kill(); } catch {} resolve({ msg, received }); }
      }
    });
    for (const s of steps) frame(s);
  });
}

const OPEN = (uri, text) => ({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } } });
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } };

test('initialize advertises sync + codeAction capability', async () => {
  const { msg } = await session([INIT], m => m.id === 1);
  assert.ok(msg.result.capabilities.textDocumentSync, 'textDocumentSync present');
  assert.ok(msg.result.capabilities.codeActionProvider, 'codeActionProvider present');
  assert.equal(msg.result.serverInfo.name, 'miraat-lsp');
});

test('didOpen publishes RTL diagnostics with ranges', async () => {
  const uri = 'file:///tmp/miraat-lsp-a.tsx';
  const code = 'const C = () => <div dir="ltr" className="ml-4">x</div>;\n';
  const { msg } = await session([INIT, OPEN(uri, code)],
    m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri && m.params.diagnostics.length);
  const codes = msg.params.diagnostics.map(d => d.code);
  assert.ok(codes.includes('tw-logical'), 'ml-4 flagged');
  assert.ok(codes.includes('hardcoded-dir'), 'dir="ltr" flagged');
  const d = msg.params.diagnostics.find(x => x.code === 'tw-logical');
  assert.equal(d.source, 'miraat');
  assert.ok(d.range.start.character < d.range.end.character, 'has a real range, not zero-width');
});

test('inline-disable is honoured in the editor too', async () => {
  const uri = 'file:///tmp/miraat-lsp-b.css';
  const code = '/* miraat-disable-next-line css-logical */\n.x { margin-left: 4px; }\n.y { text-align: left; }\n';
  const { msg } = await session([INIT, OPEN(uri, code)],
    m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri && m.params.diagnostics.length);
  assert.equal(msg.params.diagnostics.length, 1, 'disabled line produces no squiggle');
  assert.equal(msg.params.diagnostics[0].range.start.line, 2, 'only the un-disabled line 3 (idx 2)');
});

test('codeAction returns a per-finding fix and a fix-all', async () => {
  const uri = 'file:///tmp/miraat-lsp-c.css';
  const code = '.x { margin-left: 4px; }\n';
  // open first, then request codeAction for line 0
  const diag = {
    range: { start: { line: 0, character: 5 }, end: { line: 0, character: 16 } },
    severity: 3, source: 'miraat', code: 'css-logical',
    message: 'physical CSS property → logical (margin-left → margin-inline-start)',
    data: { from: 'margin-left', to: 'margin-inline-start', sev: 'fix' },
  };
  const CA = { jsonrpc: '2.0', id: 2, method: 'textDocument/codeAction', params: {
    textDocument: { uri }, range: diag.range, context: { diagnostics: [diag] } } };
  const { msg } = await session([INIT, OPEN(uri, code), CA], m => m.id === 2);
  const titles = msg.result.map(a => a.title);
  assert.ok(titles.some(t => /margin-left → margin-inline-start/.test(t)), 'per-finding quick-fix offered');
  assert.ok(titles.some(t => /fix all/i.test(t)), 'fix-all offered');
  const fixAll = msg.result.find(a => /fix all/i.test(a.title));
  assert.ok(fixAll.edit.changes[uri][0].newText.includes('margin-inline-start'), 'fix-all edit carries the corrected code');
});
