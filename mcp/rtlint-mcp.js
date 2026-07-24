#!/usr/bin/env node
'use strict';
/*
 * rtlint MCP server — lets AI agents (Cursor / Claude / Windsurf) scan & fix
 * RTL/Arabic bugs by calling rtlint over the Model Context Protocol.
 * Transport: stdio, newline-delimited JSON-RPC 2.0. Zero dependencies.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'rtlint.js');
const VERSION = require('../package.json').version;
const PROTOCOL = '2025-06-18';

function runCli(args) {
  try { return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); } // CLI exits 1 when flags remain
}

const TOOLS = [
  {
    name: 'rtl_scan',
    description: 'Scan a file or directory for the RTL/Arabic bugs AI code tools introduce (physical CSS/Tailwind, un-mirrored icons, hard-coded dir="ltr", Latin-only fonts). Returns JSON findings.',
    inputSchema: { type: 'object', properties: {
      path: { type: 'string', description: 'File or directory to scan' },
      fix: { type: 'boolean', description: 'Apply the safe auto-fixes (physical -> logical)' }
    }, required: ['path'] }
  },
  {
    name: 'rtl_check_code',
    description: 'Check a snippet of JSX/TSX/CSS for RTL/Arabic bugs and return the findings PLUS the auto-fixed code. Call this whenever you write or edit Arabic/RTL UI.',
    inputSchema: { type: 'object', properties: {
      code: { type: 'string', description: 'The code snippet' },
      ext: { type: 'string', description: 'File extension for context, e.g. .tsx or .css (default .tsx)' }
    }, required: ['code'] }
  }
];

function callTool(name, args) {
  if (name === 'rtl_scan') {
    const a = [args.path, '--json'];
    if (args.fix) a.push('--fix');
    return runCli(a);
  }
  if (name === 'rtl_check_code') {
    const ext = args.ext && args.ext.startsWith('.') ? args.ext : '.tsx';
    const tmp = path.join(os.tmpdir(), `rtlint-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`);
    fs.writeFileSync(tmp, args.code);
    let report = {};
    try { report = JSON.parse(runCli([tmp, '--json']) || '{}'); } catch {}
    runCli([tmp, '--fix']);
    const fixed = fs.readFileSync(tmp, 'utf8');
    try { fs.unlinkSync(tmp); } catch {}
    return JSON.stringify({ report, fixed }, null, 2);
  }
  throw new Error('unknown tool: ' + name);
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'rtlint', version: VERSION } } });
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
process.stderr.write(`rtlint MCP server v${VERSION} ready\n`);
