'use strict';
/*
 * scripts.js — shared world-scripts table + shaping-aware detection.
 *
 * kashida started Arabic-only. This table lets every rule reason about ALL the
 * scripts whose typography breaks differently, using native `\p{Script=X}`
 * (zero dependency). The whole point is to flag the RIGHT thing and NEVER
 * false-positive: Hebrew / Thaana / CJK are NOT cursive, so letter-spacing must
 * not be flagged on them the way it is on Arabic. The `cursive` / `complex`
 * flags are what the cut-rules gate on.
 *
 * Each entry:
 *   name        human name
 *   sc          Unicode Script property value for \p{Script=…}
 *   tag         OpenType script tag (for the HarfBuzz tier)
 *   dir         'rtl' | 'ltr'
 *   cursive     letters join — letter/word-spacing SHATTERS the joins (Arabic-like)
 *   complex     needs shaping (reordering / conjuncts / marks) — spacing splits it
 *   cjk         Han/Kana/Hangul — has no case; spacing is a *feature*, not a bug
 *   noSpaces    no inter-word spaces — line-breaking needs a segmenter, not split(' ')
 *   nativeDigits (RTL only) the script carries its OWN numeral set, so Western
 *               ASCII digits in its text are a localization bug (Arabic, Thaana,
 *               N'Ko, Adlam). Hebrew & Syriac use Western numerals → false, so
 *               the digit rule must NOT fire on them. This is the line miraat
 *               draws between "flag" and "leave alone" across RTL scripts.
 *   ranges      representative Unicode block(s), for docs/reporting
 *   rules       cut-rule categories that apply (informational)
 */

const SCRIPTS = [
  // ── RTL cursive (joining): letter/word-spacing SHATTERS the cursive joins ──
  { name: 'Arabic',     sc: 'Arabic',     tag: 'arab', dir: 'rtl', cursive: true,  complex: true,  cjk: false, noSpaces: false, nativeDigits: true,  ranges: ['0600-06FF', '0750-077F', '08A0-08FF', 'FB50-FDFF', 'FE70-FEFF'], rules: ['spacing', 'ligature', 'bidi', 'zwnj', 'case', 'font'] },
  { name: 'Syriac',     sc: 'Syriac',     tag: 'syrc', dir: 'rtl', cursive: true,  complex: true,  cjk: false, noSpaces: false, nativeDigits: false, ranges: ['0700-074F'], rules: ['spacing', 'ligature', 'bidi'] },
  { name: "N'Ko",       sc: 'Nko',        tag: 'nko ', dir: 'rtl', cursive: true,  complex: true,  cjk: false, noSpaces: false, nativeDigits: true,  ranges: ['07C0-07FF'], rules: ['spacing', 'ligature', 'bidi'] },
  { name: 'Adlam',      sc: 'Adlam',      tag: 'adlm', dir: 'rtl', cursive: true,  complex: true,  cjk: false, noSpaces: false, nativeDigits: true,  ranges: ['1E900-1E95F'], rules: ['spacing', 'ligature', 'bidi'] },

  // ── RTL non-cursive: bidi matters, but NOT letter-spacing (the key guard) ──
  { name: 'Hebrew',     sc: 'Hebrew',     tag: 'hebr', dir: 'rtl', cursive: false, complex: false, cjk: false, noSpaces: false, nativeDigits: false, ranges: ['0590-05FF', 'FB1D-FB4F'], rules: ['bidi', 'leading', 'size'] },
  { name: 'Thaana',     sc: 'Thaana',     tag: 'thaa', dir: 'rtl', cursive: false, complex: false, cjk: false, noSpaces: false, nativeDigits: true,  ranges: ['0780-07BF'], rules: ['bidi', 'leading', 'size'] },

  // ── Indic complex: letter-spacing SPLITS conjuncts (क् + ष → क्ष) ──
  { name: 'Devanagari', sc: 'Devanagari', tag: 'deva', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: false, ranges: ['0900-097F'], rules: ['spacing', 'ligature'] },
  { name: 'Bengali',    sc: 'Bengali',    tag: 'beng', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: false, ranges: ['0980-09FF'], rules: ['spacing', 'ligature'] },
  { name: 'Gujarati',   sc: 'Gujarati',   tag: 'gujr', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: false, ranges: ['0A80-0AFF'], rules: ['spacing', 'ligature'] },
  { name: 'Tamil',      sc: 'Tamil',      tag: 'taml', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: false, ranges: ['0B80-0BFF'], rules: ['spacing', 'ligature'] },
  { name: 'Telugu',     sc: 'Telugu',     tag: 'telu', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: false, ranges: ['0C00-0C7F'], rules: ['spacing', 'ligature'] },

  // ── SE-Asian: no inter-letter spacing; line-break needs a word segmenter ──
  { name: 'Thai',       sc: 'Thai',       tag: 'thai', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: true,  ranges: ['0E00-0E7F'], rules: ['spacing', 'segment'] },
  { name: 'Lao',        sc: 'Lao',        tag: 'lao ', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: true,  ranges: ['0E80-0EFF'], rules: ['spacing', 'segment'] },
  { name: 'Khmer',      sc: 'Khmer',      tag: 'khmr', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: true,  ranges: ['1780-17FF'], rules: ['spacing', 'ligature', 'segment'] },
  { name: 'Myanmar',    sc: 'Myanmar',    tag: 'mymr', dir: 'ltr', cursive: false, complex: true,  cjk: false, noSpaces: true,  ranges: ['1000-109F'], rules: ['spacing', 'ligature', 'segment'] },

  // ── CJK: no case; letter-spacing is a *feature* (use text-spacing); kinsoku ──
  { name: 'Han',        sc: 'Han',        tag: 'hani', dir: 'ltr', cursive: false, complex: false, cjk: true,  noSpaces: true,  ranges: ['4E00-9FFF', '3400-4DBF'], rules: ['leading', 'size', 'case'] },
  { name: 'Hiragana',   sc: 'Hiragana',   tag: 'kana', dir: 'ltr', cursive: false, complex: false, cjk: true,  noSpaces: true,  ranges: ['3040-309F'], rules: ['leading', 'size', 'case'] },
  { name: 'Katakana',   sc: 'Katakana',   tag: 'kana', dir: 'ltr', cursive: false, complex: false, cjk: true,  noSpaces: true,  ranges: ['30A0-30FF'], rules: ['leading', 'size', 'case'] },
  { name: 'Hangul',     sc: 'Hangul',     tag: 'hang', dir: 'ltr', cursive: false, complex: false, cjk: true,  noSpaces: false, ranges: ['AC00-D7AF', '1100-11FF'], rules: ['leading', 'size', 'case'] },
];

// Explicit codepoint ranges for the RTL scripts the linter's rules gate on, so
// detection is byte-for-byte identical on every engine. A `\p{Script=X}` class
// tracks the engine's bundled Unicode version — e.g. Arabic Extended-C
// (U+10EC0–U+10EFF) is script "Arabic" only from Unicode 15.1, so Node 18
// (older ICU) and Node 20+/Deno/Bun/Workers disagreed on the same input. Ranges
// are version-independent. LTR/CJK entries (used only by sibling tools) keep
// \p{Script=…}.
const RTL_RANGES = {
  Arabic: ['0600-06FF', '0750-077F', '0870-089F', '08A0-08FF', 'FB50-FDFF', 'FE70-FEFF',
    '10E60-10E7F', '10EC0-10EFF', '1EC70-1ECBF', '1ED00-1ED4F', '1EE00-1EEFF'],
  Hebrew: ['0590-05FF', 'FB1D-FB4F'],
  Syriac: ['0700-074F', '0860-086F'],
  Nko: ['07C0-07FF'],
  Thaana: ['0780-07BF'],
  Adlam: ['1E900-1E95F'],
};
function rangeMatcher(ranges) {
  const esc = cp => cp <= 0xFFFF
    ? '\\u' + cp.toString(16).toUpperCase().padStart(4, '0')
    : '\\u{' + cp.toString(16).toUpperCase() + '}';
  const cls = ranges.map(r => {
    const [lo, hi] = r.split('-').map(h => parseInt(h, 16));
    return esc(lo) + '-' + esc(hi);
  }).join('');
  return new RegExp('[' + cls + ']', 'u');
}
for (const s of SCRIPTS) {
  const ranges = RTL_RANGES[s.sc];
  if (ranges) { s.re = rangeMatcher(ranges); continue; }
  // Guarded so an unknown script value on an older engine degrades to
  // "never matches" instead of throwing.
  try { s.re = new RegExp('\\p{Script=' + s.sc + '}', 'u'); }
  catch { s.re = { test: () => false }; }
}
const BY_NAME = new Map(SCRIPTS.map(s => [s.name, s]));
const BY_SC = new Map(SCRIPTS.map(s => [s.sc, s]));

// Fast reject: pure-ASCII text can hold none of these scripts.
const NON_ASCII = /[^\x00-\x7F]/;
/**
 * detectScripts(text) → array of SCRIPTS entries whose glyphs appear in `text`.
 * Latin / punctuation / digits / emoji are not in the table → not returned, so
 * a pure-English string yields [] (zero false positives downstream).
 */
function detectScripts(text) {
  if (!text || !NON_ASCII.test(text)) return [];
  const out = [];
  for (const s of SCRIPTS) if (s.re.test(text)) out.push(s);
  return out;
}

/**
 * complexScriptsIn(text) → the non-Latin scripts present that need typographic
 * care. This REPLACES the old Arabic-only gate: any entry here means "we're in
 * a script context where Western-default CSS can break rendering". Whether a
 * *specific* cut-rule fires is then decided per-family (see the `any*` helpers)
 * — e.g. letter-spacing only fires for `cursive || complex`, never Hebrew/CJK.
 */
function complexScriptsIn(text) {
  return detectScripts(text);
}

/** rtlScriptsIn(text) → only the RTL entries present (Arabic, Hebrew, Syriac,
 * Thaana, N'Ko, Adlam). This is the all-RTL replacement for the old
 * Arabic-only `\p{Script=Arabic}` gate: physical→logical / dir / mirrored-icon
 * guidance applies to EVERY script that lays out right-to-left. */
function rtlScriptsIn(text) {
  return detectScripts(text).filter(s => s.dir === 'rtl');
}

/** nativeDigitScriptsIn(text) → RTL entries present whose own numeral system
 * means Western ASCII digits are a localization bug (Arabic, Thaana, N'Ko,
 * Adlam). Hebrew & Syriac use Western numerals, so they're deliberately absent
 * — the digit rule must never fire on them. */
function nativeDigitScriptsIn(text) {
  return detectScripts(text).filter(s => s.dir === 'rtl' && s.nativeDigits);
}

// ── family predicates the cut-rules gate on ───────────────────────────────
const anyCursive = (scripts) => scripts.some(s => s.cursive);
const anyComplex = (scripts) => scripts.some(s => s.complex);
const anyCursiveOrComplex = (scripts) => scripts.some(s => s.cursive || s.complex);
const anyRtl = (scripts) => scripts.some(s => s.dir === 'rtl');
const anyCjk = (scripts) => scripts.some(s => s.cjk);
const anyNoSpaces = (scripts) => scripts.some(s => s.noSpaces);
const anyIndic = (scripts) => scripts.some(s => s.complex && !s.cursive && !s.noSpaces);
const anySEAsian = (scripts) => scripts.some(s => s.noSpaces && !s.cjk);

/** Human list e.g. "Arabic, Hebrew" for messages. */
function namesOf(scripts) { return scripts.map(s => s.name).join(', '); }

/**
 * familyOf(scripts) — pick the dominant family for message selection. Cursive
 * (Arabic-like) wins because its breakage is the most severe, then Indic, then
 * SE-Asian, then CJK, then plain RTL.
 */
function familyOf(scripts) {
  if (anyCursive(scripts)) return 'cursive';
  if (anyIndic(scripts)) return 'indic';
  if (anySEAsian(scripts)) return 'sea';
  if (anyCjk(scripts)) return 'cjk';
  if (anyRtl(scripts)) return 'rtl';
  return 'other';
}

module.exports = {
  SCRIPTS, BY_NAME, BY_SC,
  detectScripts, complexScriptsIn, rtlScriptsIn, nativeDigitScriptsIn,
  anyCursive, anyComplex, anyCursiveOrComplex, anyRtl, anyCjk, anyNoSpaces, anyIndic, anySEAsian,
  namesOf, familyOf,
};
