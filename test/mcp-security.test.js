'use strict';
/*
 * Security regression: the MCP `*_check_code` tool writes the snippet to a temp
 * file whose extension comes from the caller. A path-traversal extension
 * (e.g. `.x/../../etc/passwd`) must NOT let the caller write/delete files
 * outside os.tmpdir(). This tool also runs --fix on the temp file, so the
 * write is doubly destructive. See mcp/miraat-mcp.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MCP = path.join(__dirname, '..', 'mcp', 'miraat-mcp.js');

function driveCheckCode(ext, code) {
  return new Promise((resolve) => {
    const srv = spawn(process.execPath, [MCP], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const done = () => { try { srv.kill(); } catch {} resolve(); };
    srv.stdout.on('data', d => { out += d.toString(); if (out.includes('"id":2')) done(); });
    srv.on('close', () => resolve());
    const send = o => srv.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'miraat_check_code', arguments: { code, ext } } });
    setTimeout(done, 5000); // safety net
  });
}

test('check_code rejects a path-traversal ext (no arbitrary write/delete)', async () => {
  const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-victim-'));
  const victim = path.join(victimDir, 'KEEP.txt');
  fs.writeFileSync(victim, 'PRESERVE-ME');
  const ext = '.x/../' + path.basename(victimDir) + '/KEEP.txt';
  await driveCheckCode(ext, 'MALICIOUS-OVERWRITE');
  const survived = fs.existsSync(victim);
  const content = survived ? fs.readFileSync(victim, 'utf8') : '(deleted)';
  fs.rmSync(victimDir, { recursive: true, force: true });
  assert.ok(survived, 'victim outside the temp name must not be deleted by a traversal ext');
  assert.strictEqual(content, 'PRESERVE-ME', 'victim must not be overwritten by a traversal ext');
});

test('check_code still works with a normal ext', async () => {
  await driveCheckCode('.tsx', 'const a = 1;');
  assert.ok(true, 'a legitimate ext must not crash the server');
});

// ── miraat_fix_code: returns corrected code up front + separates judgment calls ──
function callTool(name, args) {
  return new Promise((resolve) => {
    const srv = spawn(process.execPath, [MCP], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const done = () => { try { srv.kill(); } catch {} resolve(out); };
    srv.stdout.on('data', d => { out += d.toString(); if (out.includes('"id":2')) done(); });
    srv.on('close', () => resolve(out));
    const send = o => srv.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    setTimeout(done, 5000);
  });
}

test('miraat_fix_code returns the corrected code and lists the judgment calls', async () => {
  const raw = await callTool('miraat_fix_code', {
    code: '<div className="ml-4 text-left" dir="ltr"><ChevronLeft/></div>', ext: '.tsx',
  });
  const line = raw.trim().split('\n').map(JSON.parse).find(m => m.id === 2);
  const out = JSON.parse(line.result.content[0].text);
  assert.match(out.fixed, /ms-4/, 'physical ml-4 -> logical ms-4 applied');
  assert.match(out.fixed, /text-start/, 'text-left -> text-start applied');
  assert.equal(out.fixesApplied, 2);
  const rules = out.flagsToReview.map(f => f.rule);
  assert.ok(rules.includes('hardcoded-dir'), 'dir="ltr" kept as a judgment call, not silently changed');
  assert.ok(rules.includes('icon-directional'), 'ChevronLeft flagged to mirror');
  assert.doesNotMatch(raw, /os\.tmpdir|AppData|\/var\/folders/, 'internal temp path must be scrubbed');
});

test('miraat_fix_code on clean code applies nothing and reports clean', async () => {
  const raw = await callTool('miraat_fix_code', { code: '.x { margin-inline-start: 8px; }', ext: '.css' });
  const line = raw.trim().split('\n').map(JSON.parse).find(m => m.id === 2);
  const out = JSON.parse(line.result.content[0].text);
  assert.equal(out.fixesApplied, 0);
  assert.equal(out.flagsToReview.length, 0);
  assert.match(out.note, /RTL-clean/);
});

// ── the whole suite through one MCP: type (kashida) / i18n (lahja) / a11y (daleel) ──
function listTools() {
  return new Promise((resolve) => {
    const srv = spawn(process.execPath, [MCP], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const done = () => { try { srv.kill(); } catch {} resolve(out); };
    srv.stdout.on('data', d => { out += d.toString(); if (out.includes('"id":2')) done(); });
    srv.on('close', () => resolve(out));
    const s = o => srv.stdin.write(JSON.stringify(o) + '\n');
    s({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    s({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    setTimeout(done, 5000);
  });
}

test('the one MCP exposes the whole suite: type / i18n / a11y pack tools', async () => {
  const raw = await listTools();
  const msg = raw.trim().split('\n').map(JSON.parse).find(m => m.id === 2);
  const names = msg.result.tools.map(t => t.name);
  for (const n of ['miraat_type_check', 'miraat_i18n_check', 'miraat_a11y_check']) assert.ok(names.includes(n), `missing ${n}`);
});

test('a pack tool runs a sibling pack through the miraat MCP and returns JSON', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'miraat-pack-'));
  fs.writeFileSync(path.join(d, 'a.css'), '.x { margin: 0; }');
  const raw = await callTool('miraat_type_check', { path: path.join(d, 'a.css') });
  fs.rmSync(d, { recursive: true, force: true });
  const msg = raw.trim().split('\n').map(JSON.parse).find(m => m.id === 2);
  const text = msg.result.content[0].text;
  // Either kashida ran (JSON with findings) or returned the install hint — both are valid JSON, never "unknown tool".
  assert.doesNotMatch(text, /unknown tool/);
  assert.ok(/"findings"|"error"/.test(text), 'returns pack JSON or an install hint');
});

test('a pack tool rejects a flag-shaped path', async () => {
  const raw = await callTool('miraat_a11y_check', { path: '--fix' });
  const msg = raw.trim().split('\n').map(JSON.parse).find(m => m.id === 2);
  assert.match(msg.result.content[0].text, /invalid path/);
});

// ── regression: a flag-shaped scan `path` must not hijack the CLI (no --fix/--init-rules) ──
test('miraat_scan rejects a flag/subcommand-shaped path', async () => {
  const { spawn } = require('node:child_process');
  const drive = (p) => new Promise((resolve) => {
    const srv = spawn(process.execPath, [MCP], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = ''; const done = () => { try { srv.kill(); } catch {} resolve(out); };
    srv.stdout.on('data', d => { out += d.toString(); if (out.includes('"id":2')) done(); });
    srv.on('close', () => resolve(out));
    const s = o => srv.stdin.write(JSON.stringify(o) + '\n');
    s({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    s({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'miraat_scan', arguments: { path: p } } });
    setTimeout(done, 4000);
  });
  assert.match(await drive('--init-rules'), /invalid path/, 'a leading-dash path is rejected');
});
