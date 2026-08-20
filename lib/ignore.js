'use strict';
/*
 * .gitignore-style ignore matching, dependency-free.
 * miraat honours BOTH `.gitignore` and `.miraatignore` at the scan root so a
 * repo doesn't need to re-list its build output. Practical subset of the
 * gitignore spec: comments (#), negation (!), root anchoring (/), directory
 * patterns (trailing /), and * / ** / ? globs. Applied per entry during the
 * walk, so ignoring a directory prunes the whole subtree.
 */
const fs = require('fs');
const path = require('path');

function compile(pattern) {
  let neg = false, anchored = false, dirOnly = false;
  let p = pattern;
  if (p.startsWith('!')) { neg = true; p = p.slice(1); }
  if (p.endsWith('/')) { dirOnly = true; p = p.slice(0, -1); }
  if (p.startsWith('/')) { anchored = true; p = p.slice(1); }
  else if (p.slice(0, -1).includes('/')) { anchored = true; }  // an interior slash anchors to root

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {                     // **
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else { re += '[^/]*'; }
    } else if (c === '?') { re += '[^/]'; }
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const head = anchored ? '^' : '(?:^|/)';
  return { neg, dirOnly, regex: new RegExp(head + re + '(?:/|$)') };
}

// Returns a matcher(relPath, isDir) -> boolean (true = ignore).
// last-match-wins across both files (gitignore then miraatignore), so a later
// `!pattern` un-ignores.
function loadIgnore(rootDir) {
  const patterns = [];
  for (const name of ['.gitignore', '.miraatignore']) {
    let txt;
    try { txt = fs.readFileSync(path.join(rootDir, name), 'utf8'); } catch { continue; }
    for (let line of txt.split('\n')) {
      line = line.replace(/\r$/, '').trim();
      if (!line || line.startsWith('#')) continue;
      try { patterns.push(compile(line)); } catch {}
    }
  }
  if (!patterns.length) return () => false;
  return function ignored(relPath, isDir) {
    const rp = relPath.split(path.sep).join('/');
    let ig = false;
    for (const pt of patterns) {
      if (pt.dirOnly && !isDir) continue;
      if (pt.regex.test(rp)) ig = !pt.neg;
    }
    return ig;
  };
}

module.exports = { loadIgnore, compile };
