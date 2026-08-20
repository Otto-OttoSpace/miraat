'use strict';
/*
 * Inline-disable directives — the escape hatch whose absence gets a linter
 * uninstalled the first time it fires on a legitimately-LTR block.
 * ESLint-shaped and comment-syntax agnostic (matches the keyword inside //,
 * /* *\/, <!-- --> or # comments alike):
 *
 *   miraat-disable-line [rule…]        silence findings on THIS line
 *   miraat-disable-next-line [rule…]   silence findings on the NEXT line
 *   miraat-disable [rule…]             silence from here to EOF / matching enable
 *   miraat-enable [rule…]              re-enable
 *
 * With no rule ids listed, a directive covers every rule. Text after `--` is a
 * free-form reason and is ignored. Directives that never matched a finding are
 * returned as `unused` so the caller can report dead escape hatches.
 */
const RE = /miraat-(disable-next-line|disable-line|disable|enable)\b([^\n*]*)/g;

function parseRuleList(rest) {
  const beforeReason = String(rest).split('--')[0];
  return beforeReason
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => /^[a-z][a-z0-9-]*$/.test(s));
}

function collectDirectives(src) {
  const lines = src.split('\n');
  const directives = [];
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(RE)) {
      directives.push({ type: m[1], line: i + 1, rules: parseRuleList(m[2] || ''), used: false });
    }
  }
  return directives;
}

const covers = (d, rule) => d.rules.length === 0 || d.rules.includes(rule);

// Split findings into { kept, disabled, unused } given a file's source.
function applyDirectives(src, findings) {
  const directives = collectDirectives(src);
  if (!directives.length) return { kept: findings, disabled: [], unused: [] };

  function isDisabled(line, rule) {
    // Line / next-line directives take precedence and are cheap.
    for (const d of directives) {
      if (d.type === 'disable-line' && d.line === line && covers(d, rule)) { d.used = true; return true; }
      if (d.type === 'disable-next-line' && d.line + 1 === line && covers(d, rule)) { d.used = true; return true; }
    }
    // Block state: replay disable/enable in source order up to this line.
    let allOff = false;
    const rulesOff = new Set();
    const governing = [];
    for (const d of directives) {
      if (d.line > line) break;
      if (d.type === 'disable') {
        if (d.rules.length === 0) { allOff = true; governing.push(d); }
        else { d.rules.forEach(r => rulesOff.add(r)); governing.push(d); }
      } else if (d.type === 'enable') {
        if (d.rules.length === 0) { allOff = false; rulesOff.clear(); }
        else d.rules.forEach(r => rulesOff.delete(r));
      }
    }
    if (allOff || rulesOff.has(rule)) {
      for (const d of governing) if (covers(d, rule)) d.used = true;
      return true;
    }
    return false;
  }

  const kept = [], disabled = [];
  for (const f of findings) {
    if (isDisabled(f.line, f.rule)) disabled.push(f);
    else kept.push(f);
  }
  return { kept, disabled, unused: directives.filter(d => !d.used) };
}

module.exports = { applyDirectives, collectDirectives };
