'use strict';
/*
 * miraat config — per-rule severity + shareable presets.
 * Deliberately ESLint-shaped ("familiarity is the feature"): a config is a
 * `rules: { <ruleId>: "off" | "warn" | "error" }` map plus optional `extends`.
 * No bespoke DSL. Discovery walks up from the target like cosmiconfig.
 */
const fs = require('fs');
const path = require('path');

// Known rule ids — keep in sync with SARIF_RULES in bin/miraat.js and the core.
const RULES = [
  'css-logical', 'tw-logical', 'js-style-logical', 'physical-corner',
  'flippable-transform', 'latin-font-stack', 'arabic-western-digits',
  'bidi-isolation', 'icon-directional', 'hardcoded-dir', 'input-dir', 'rn-logical',
];

const VALID_SEV = new Set(['off', 'warn', 'error']);

// Presets map ruleId -> severity. An empty map means "use each finding's
// natural severity" (mechanical fix -> warn, judgment flag -> error), which is
// exactly today's default behaviour — so `miraat:recommended` is a no-op preset.
const PRESETS = {
  'miraat:recommended': {},
  'miraat:strict': Object.fromEntries(RULES.map(r => [r, 'error'])),
  'miraat:all': Object.fromEntries(RULES.map(r => [r, 'error'])),
};

const CONFIG_NAMES = [
  'miraat.config.json', 'miraat.config.js', 'miraat.config.cjs',
  '.miraatrc', '.miraatrc.json',
];

function findConfigFile(startDir) {
  let dir = path.resolve(startDir);
  try { if (fs.statSync(dir).isFile()) dir = path.dirname(dir); } catch {}
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadRaw(file) {
  if (file.endsWith('.json') || file.endsWith('.miraatrc')) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return require(path.resolve(file));   // .js / .cjs
}

function resolveExtends(ext) {
  const out = {};
  const list = Array.isArray(ext) ? ext : ext ? [ext] : [];
  for (const name of list) {
    const preset = PRESETS[name];
    if (!preset) {
      throw new Error(`unknown preset in "extends": ${name} (valid: ${Object.keys(PRESETS).join(', ')})`);
    }
    Object.assign(out, preset);
  }
  return out;
}

function normalizeSeverity(val, id, where) {
  let sev = Array.isArray(val) ? val[0] : val;
  if (typeof sev === 'number') sev = ['off', 'warn', 'error'][sev];   // ESLint numeric form
  if (!VALID_SEV.has(sev)) {
    throw new Error(`invalid severity ${JSON.stringify(val)} for rule "${id}"${where} (use off | warn | error)`);
  }
  return sev;
}

// Returns { rules: { ruleId: 'off'|'warn'|'error' }, configPath }.
// A rule absent from the map falls back to its natural severity (caller decides).
function loadConfig(startDir, explicitPath) {
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : findConfigFile(startDir);
  if (!configPath) return { rules: {}, configPath: null };
  let raw;
  try { raw = loadRaw(configPath); }
  catch (e) { throw new Error(`miraat: failed to read ${configPath}: ${e.message}`); }

  const rules = {};
  Object.assign(rules, resolveExtends(raw.extends));
  if (raw.rules && typeof raw.rules === 'object') {
    for (const [id, val] of Object.entries(raw.rules)) {
      if (!RULES.includes(id)) {
        // Unknown rule id — warn but don't crash (forward-compat with new packs).
        process.stderr.write(`miraat: config references unknown rule "${id}" (ignored)\n`);
        continue;
      }
      rules[id] = normalizeSeverity(val, id, ` in ${configPath}`);
    }
  }
  return { rules, configPath };
}

// A finding's natural severity when no explicit config governs its rule.
function naturalSeverity(finding) { return finding.sev === 'fix' ? 'warn' : 'error'; }

// Effective severity for a finding under the loaded rules map.
function severityFor(finding, rules) {
  return (rules && rules[finding.rule]) || naturalSeverity(finding);
}

module.exports = { loadConfig, severityFor, naturalSeverity, findConfigFile, RULES, PRESETS };
