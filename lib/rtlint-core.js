'use strict';
/*
 * rtlint core — AST/PostCSS-verified detection & surgical fixing.
 *
 * Safety architecture (the "zero mistakes" gate):
 *   - Every AUTO-FIX edit is produced only from a parsed AST (Babel) or the
 *     PostCSS decl tree, and applied as a surgical string splice into the
 *     ORIGINAL source, so untouched bytes are preserved verbatim. Files with
 *     nothing to fix come back byte-identical, and re-running --fix is a no-op.
 *   - Everything ambiguous (icons, hard-coded dir, Western digits in Arabic,
 *     font stacks, physical corners) is REPORT-ONLY (sev: 'flag'), never edited.
 */
const path = require('path');
const { rtlScriptsIn, nativeDigitScriptsIn } = require('@ottospace/rtl-scripts');

let babelParser, babelTraverse, postcss;
try { babelParser = require('@babel/parser'); } catch { babelParser = null; }
try { const t = require('@babel/traverse'); babelTraverse = t.default || t; } catch { babelTraverse = null; }
try { postcss = require('postcss'); } catch { postcss = null; }

const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const MARKUP_EXT = new Set(['.html', '.htm', '.vue', '.svelte', '.astro']);

const MSG = {
  tw: 'physical Tailwind utility → logical',
  css: 'physical CSS property → logical',
  cssVal: 'physical CSS value → logical',
  js: 'inline style physical property → logical',
  icon: 'directional icon — mirror it for RTL, Arabic/Hebrew/Syriac/Thaana/N’Ko/Adlam (or use a logical/auto-flipping icon)',
  dir: 'hard-coded direction — make it dynamic (e.g. dir={locale.dir}) so every RTL script flips',
  digits: 'Western digits in an RTL script with its own numerals (Arabic/Thaana/N’Ko/Adlam) — use native / locale-aware numerals',
  font: 'font stack has no Arabic family — add one (e.g. "Cairo","IBM Plex Sans Arabic")',
  corner: 'physical corner radius — use logical (rounded-ss/se/ee/es or border-start-start-radius…)',
  bidi: 'mixed-direction text can reorder incorrectly — isolate the opposite-direction run with <bdi>, dir="auto", or unicode-bidi: isolate',
  flip: 'physical transform/position won’t auto-mirror for RTL — mirror it per direction (e.g. a scaleX/translateX override under [dir="rtl"], or a logical / inset-inline-based value)',
};

// A strong-LTR word (≥2 chars: brand/name/URL/code) embedded in RTL text.
const LTR_WORD_RE = /[A-Za-z][A-Za-z0-9._@/+-]*[A-Za-z0-9]/;

// ---------------------------------------------------------------------------
// Tailwind physical → logical, value-validated (G1: never touch custom classes)
// ---------------------------------------------------------------------------
const SPACING = /^(?:\d+(?:\.\d+)?|px|auto|\[[^\]]*\])$/;              // ml-4 pl-px mr-auto ml-[3px]
const INSET   = /^(?:\d+(?:\.\d+)?|px|auto|full|\d+\/\d+|\[[^\]]*\])$/;// left-0 right-full left-1/2
const RADIUS  = /^(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]*\])$/;      // rounded-l-lg
const BORDERW = /^(?:0|2|4|8|\[[^\]]*\])$/;                            // border-l-2

function mapUtil(u) {
  let m;
  if ((m = u.match(/^scroll-ml-(.+)$/)) && SPACING.test(m[1])) return 'scroll-ms-' + m[1];
  if ((m = u.match(/^scroll-mr-(.+)$/)) && SPACING.test(m[1])) return 'scroll-me-' + m[1];
  if ((m = u.match(/^scroll-pl-(.+)$/)) && SPACING.test(m[1])) return 'scroll-ps-' + m[1];
  if ((m = u.match(/^scroll-pr-(.+)$/)) && SPACING.test(m[1])) return 'scroll-pe-' + m[1];
  if ((m = u.match(/^ml-(.+)$/)) && SPACING.test(m[1])) return 'ms-' + m[1];
  if ((m = u.match(/^mr-(.+)$/)) && SPACING.test(m[1])) return 'me-' + m[1];
  if ((m = u.match(/^pl-(.+)$/)) && SPACING.test(m[1])) return 'ps-' + m[1];
  if ((m = u.match(/^pr-(.+)$/)) && SPACING.test(m[1])) return 'pe-' + m[1];
  if ((m = u.match(/^left-(.+)$/)) && INSET.test(m[1])) return 'start-' + m[1];
  if ((m = u.match(/^right-(.+)$/)) && INSET.test(m[1])) return 'end-' + m[1];
  if (u === 'text-left') return 'text-start';
  if (u === 'text-right') return 'text-end';
  if (u === 'float-left') return 'float-start';
  if (u === 'float-right') return 'float-end';
  if (u === 'clear-left') return 'clear-start';
  if (u === 'clear-right') return 'clear-end';
  if (u === 'rounded-l') return 'rounded-s';
  if (u === 'rounded-r') return 'rounded-e';
  if ((m = u.match(/^rounded-l-(.+)$/)) && RADIUS.test(m[1])) return 'rounded-s-' + m[1];
  if ((m = u.match(/^rounded-r-(.+)$/)) && RADIUS.test(m[1])) return 'rounded-e-' + m[1];
  if (u === 'border-l') return 'border-s';
  if (u === 'border-r') return 'border-e';
  if ((m = u.match(/^border-l-(.+)$/)) && BORDERW.test(m[1])) return 'border-s-' + m[1];
  if ((m = u.match(/^border-r-(.+)$/)) && BORDERW.test(m[1])) return 'border-e-' + m[1];
  return null;
}

// Map one whitespace-free class token, preserving variant:prefixes, ! and -.
function mapTailwindToken(tok) {
  const ci = tok.lastIndexOf(':');
  const prefix = ci === -1 ? '' : tok.slice(0, ci + 1);
  let util = ci === -1 ? tok : tok.slice(ci + 1);
  let imp = '';
  if (util.startsWith('!')) { imp = '!'; util = util.slice(1); }
  let neg = '';
  if (util.startsWith('-')) { neg = '-'; util = util.slice(1); }
  const mapped = mapUtil(util);
  return mapped === null ? null : prefix + imp + neg + mapped;
}

const CORNER_TOK = /^(?:[\w-]+:)*!?-?rounded-(?:tl|tr|bl|br)(?:-|$)/;

function transformClassString(str) {
  const changes = [];
  const corners = [];
  const parts = str.split(/(\s+)/);
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    if (!t.trim()) continue;
    if (t.includes('${') || t.includes('{') || t.includes('}')) continue; // template artefact
    if (t.includes('\\')) continue; // a backslash-escaped token is not a class util; never rewrite it
    if (CORNER_TOK.test(t)) corners.push(t);
    const mapped = mapTailwindToken(t);
    if (mapped && mapped !== t) { changes.push([t, mapped]); parts[i] = mapped; }
  }
  return { out: parts.join(''), changes, corners };
}

// ---------------------------------------------------------------------------
// Null-prototype dictionaries. These maps are looked up with user-controlled
// keys (CSS property names, JS style keys, CSS values). A plain `{}` inherits
// from Object.prototype, so a key like `constructor`, `toString`, `valueOf` or
// `__proto__` resolves to an inherited member and is truthy — which previously
// produced a corrupt auto-fix (e.g. `.a{constructor:red}` --fix ->
// `.a{function Object() { [native code] }:red}`). `dict()` strips the prototype
// so only real, own entries ever match. (See test/proto-safe.test.js.)
const dict = (obj) => Object.assign(Object.create(null), obj);

// ---------------------------------------------------------------------------
// CSS physical → logical (PostCSS, decl-only — G2)
// ---------------------------------------------------------------------------
const CSS_PROP_MAP = dict({
  'margin-left': 'margin-inline-start', 'margin-right': 'margin-inline-end',
  'padding-left': 'padding-inline-start', 'padding-right': 'padding-inline-end',
  'border-left': 'border-inline-start', 'border-right': 'border-inline-end',
  'border-left-width': 'border-inline-start-width', 'border-right-width': 'border-inline-end-width',
  'border-left-color': 'border-inline-start-color', 'border-right-color': 'border-inline-end-color',
  'border-left-style': 'border-inline-start-style', 'border-right-style': 'border-inline-end-style',
  // Positional insets (a physical left/right offset does not flip for RTL;
  // inert on unpositioned elements, so the rewrite is always safe in CSS).
  'left': 'inset-inline-start', 'right': 'inset-inline-end',
  'scroll-margin-left': 'scroll-margin-inline-start', 'scroll-margin-right': 'scroll-margin-inline-end',
  'scroll-padding-left': 'scroll-padding-inline-start', 'scroll-padding-right': 'scroll-padding-inline-end',
});
const CSS_VALUE_MAP = dict({
  'text-align': dict({ left: 'start', right: 'end' }),
  float: dict({ left: 'inline-start', right: 'inline-end' }),
  clear: dict({ left: 'inline-start', right: 'inline-end' }),
});
const CSS_CORNER = new Set([
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
]);

// ---------------------------------------------------------------------------
// JS inline-style physical → logical (Babel, style-context only — G3)
// ---------------------------------------------------------------------------
const STYLE_MAP = dict({
  marginLeft: 'marginInlineStart', marginRight: 'marginInlineEnd',
  paddingLeft: 'paddingInlineStart', paddingRight: 'paddingInlineEnd',
  borderLeft: 'borderInlineStart', borderRight: 'borderInlineEnd',
  borderLeftWidth: 'borderInlineStartWidth', borderRightWidth: 'borderInlineEndWidth',
  borderLeftColor: 'borderInlineStartColor', borderRightColor: 'borderInlineEndColor',
  borderLeftStyle: 'borderInlineStartStyle', borderRightStyle: 'borderInlineEndStyle',
});
const TEXT_ALIGN_VAL = dict({ left: 'start', right: 'end' });

// class-combining helpers whose string args are class lists (G4)
const CLASS_UTILS = new Set(['cn', 'clsx', 'classnames', 'classNames', 'cx', 'cva', 'tv', 'tw', 'twMerge', 'twJoin']);
const CLASS_TAGS = new Set(['tw', 'css']);

// ---------------------------------------------------------------------------
// Fonts (G9) — flag only when no Arabic-capable family is present
// ---------------------------------------------------------------------------
const GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji',
  'fangsong', 'inherit', 'initial', 'revert', 'revert-layer', 'unset',
  '-apple-system', 'blinkmacsystemfont',
]);
const ARABIC_FONTS = new Set([
  'cairo', 'tajawal', 'almarai', 'amiri', 'rubik', 'el messiri', 'changa',
  'noto sans arabic', 'noto kufi arabic', 'noto naskh arabic', 'ibm plex sans arabic',
  'markazi text', 'lateef', 'scheherazade new', 'reem kufi', 'harmattan', 'mada',
  'katibeh', 'lalezar', 'jomhuria', 'aref ruqaa', 'readex pro', 'baloo bhaijaan 2',
]);
function fontStackNeedsArabic(value) {
  const families = value.split(',')
    .map(f => f.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);
  if (!families.length) return false;
  const hasArabic = families.some(f => ARABIC_FONTS.has(f) || f.includes('arabic'));
  const hasNamed = families.some(f => !GENERIC_FONTS.has(f));
  return hasNamed && !hasArabic;
}

// ---------------------------------------------------------------------------
// Shared regex flag detectors (report-only, never edit — safe on any text)
// ---------------------------------------------------------------------------
const ICON_RE = /(?:Chevrons|Chevron|Arrows|Arrow|Caret|Angle)(?:Left|Right)/g;
// Kebab icon names (lucide `arrow-left`, Ionicons `chevron-forward`, …) used in a
// JSX/markup string prop `name=`/`icon=`/`iconName=`. Gated three ways to stay
// zero-FP: (1) only those prop names, (2) a known directional icon *base* word,
// (3) an explicit direction *segment* (verified in code). `name="left-field"` on a
// form input never matches (no icon base); `icon="chevron-down"` never matches
// (no directional segment) — mirroring the existing PascalCase discipline.
const ICON_KEBAB_RE = /\b(?:name|icon|iconName)\s*=\s*["'`]((?:arrows?|chevrons?|caret|carets|angle|angles|triangle)-[a-z0-9-]+)["'`]/gi;
const ICON_DIR_SEG = new Set(['left', 'right', 'back', 'forward', 'next', 'prev']);
// Lead-in `(?<![\w?&-])` (not `\b`) so `data-dir=`, a `?dir=`/`&dir=` URL param,
// and words like `redir` never match — only a real `dir=` attribute/prop.
const DIR_ATTR_RE = /(?<![\w?&-])dir\s*=\s*[\s{("'`]*?(ltr|rtl)\b/gi;
const DIR_CSS_RE = /\bdirection\s*:\s*["'`]?\s*(ltr|rtl)\b/gi;
const DIR_SETATTR_RE = /setAttribute\(\s*["'`]dir["'`]\s*,\s*["'`]\s*(ltr|rtl)\s*["'`]\s*\)/gi;
const DIGIT_RUN_RE = /[0-9]+/g;

// ---------------------------------------------------------------------------
// Flippable transforms / positions (report-only, sev:'flag') — a physical
// `transform: translateX(...)` / `scaleX(-1)` or `background-position: left|right`
// carries a horizontal effect that the browser does NOT auto-mirror for RTL the
// way a logical property would. (Note: `float`/`clear` DO get an auto-fix to
// their logical values above, so they are intentionally NOT re-flagged here.)
const TRANSFORM_PROPS = new Set([
  'transform', '-webkit-transform', '-moz-transform', '-ms-transform', '-o-transform',
]);
// Properties whose value can carry an explicit horizontal `left`/`right` keyword
// that does NOT auto-mirror for RTL (background shorthand is excluded — a
// gradient `to left` would false-positive).
const POSITION_PROPS = new Set([
  'background-position', 'background-position-x', 'transform-origin',
  'mask-position', '-webkit-mask-position', 'object-position', 'perspective-origin',
]);
// A zero-length arg (0, 0px, 0%, -0em, …) has no horizontal effect → never flag.
const ZERO_LEN_RE = /^-?0(?:\.0+)?(?:px|%|r?em|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pt|pc|q)?$/;
function isZeroLen(s) { return ZERO_LEN_RE.test(String(s).trim()); }

function transformNeedsMirror(value) {
  const v = String(value).toLowerCase();
  if (/scale\s*x\s*\(\s*-\s*1(?:\.0+)?\s*\)/.test(v)) return true;      // scaleX(-1)
  if (/\bscale\s*\(\s*-\s*1(?:\.0+)?\s*,/.test(v)) return true;         // scale(-1, …)
  if (/\bscale\s*\(\s*-\s*1(?:\.0+)?\s*\)/.test(v)) return true;        // scale(-1) — point reflection mirrors X
  let m;
  if ((m = v.match(/translate\s*x\s*\(\s*([^)]+?)\s*\)/)) && !isZeroLen(m[1])) return true;
  if ((m = v.match(/translate3d\s*\(\s*([^,]+?)\s*,/)) && !isZeroLen(m[1])) return true;
  if ((m = v.match(/\btranslate\s*\(\s*([^,)]+?)\s*[,)]/)) && !isZeroLen(m[1])) return true;
  return false;
}
// background-position with an explicit horizontal keyword (left|right) is the
// direction-sensitive case; center/top/bottom/length-only positions are not.
function positionNeedsMirror(value) {
  return /(?:^|[\s,(])(?:left|right)(?=$|[\s,)])/i.test(String(value));
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

// ---------------------------------------------------------------------------
// Edit application — surgical splices, descending, overlap-safe
// ---------------------------------------------------------------------------
// Blank the given [start,end) ranges with spaces (newlines preserved so line
// numbers stay correct). Used to hide JS comments and non-JSX string contents
// from the raw regex flag passes, so `// dir="rtl"` or `const s = "dir=ltr"`
// are not mistaken for a hard-coded direction.
function blankRanges(src, ranges) {
  if (!ranges || !ranges.length) return src;
  let out = src;
  for (const [s, e] of ranges.slice().sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, s) + src.slice(s, e).replace(/[^\n]/g, ' ') + out.slice(e);
  }
  return out;
}

function applyEdits(src, edits) {
  if (!edits.length) return src;
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const uniq = [];
  let lastEnd = -1;
  const seen = new Set();
  for (const e of edits) {
    const k = e.start + ':' + e.end;
    if (seen.has(k)) continue;
    if (e.start < lastEnd) continue; // overlap — skip to stay safe
    seen.add(k); uniq.push(e); lastEnd = e.end;
  }
  uniq.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of uniq) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ---------------------------------------------------------------------------
// JS / TS / JSX / TSX scan (Babel)
// ---------------------------------------------------------------------------
function babelPlugins(ext) {
  const p = [];
  if (ext === '.ts' || ext === '.tsx') p.push('typescript');
  if (ext !== '.ts') p.push('jsx');
  return p;
}

function scanJs(file, src, ext, findings, edits, maskRanges) {
  if (!babelParser || !babelTraverse) return false;
  let ast;
  try {
    ast = babelParser.parse(src, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      plugins: babelPlugins(ext),
    });
  } catch {
    return false; // parse failed → caller keeps flag-only, no edits (no corruption)
  }

  // Comments are never live UI — hide them from the raw regex flag passes.
  if (maskRanges && ast.comments) for (const c of ast.comments) maskRanges.push([c.start, c.end]);

  const processed = new Set(); // class-string node ranges already handled

  const collectClass = (raw, innerStart, innerEnd, line) => {
    const key = innerStart + ':' + innerEnd;
    if (processed.has(key)) return;
    processed.add(key);
    const { out, changes, corners } = transformClassString(raw);
    for (const [from, to] of changes) findings.push({ rule: 'tw-logical', sev: 'fix', line, from, to, msg: MSG.tw });
    for (const c of corners) findings.push({ rule: 'physical-corner', sev: 'flag', line, from: c, to: '', msg: MSG.corner });
    if (out !== raw) edits.push({ start: innerStart, end: innerEnd, text: out });
  };

  const isClassContext = (p) => {
    // className/class JSX attribute (direct string or {expr})
    let n = p.parentPath;
    if (n && n.isJSXExpressionContainer && n.isJSXExpressionContainer()) n = n.parentPath;
    if (n && n.isJSXAttribute && n.isJSXAttribute()) {
      const an = n.node.name && n.node.name.name;
      if (an === 'className' || an === 'class') return true;
    }
    // inside a class-combining helper call / tagged template
    const anc = p.findParent(pp =>
      (pp.isCallExpression && pp.isCallExpression() && utilCallee(pp.node.callee)) ||
      (pp.isTaggedTemplateExpression && pp.isTaggedTemplateExpression() && utilTag(pp.node.tag)));
    return !!anc;
  };

  // RTL scripts that carry their OWN numerals (Arabic, Thaana, N'Ko, Adlam):
  // Western ASCII digits inside their text are a localization bug. Hebrew &
  // Syriac use Western numerals, so the SCRIPTS table keeps them out and this
  // never false-positives on them.
  const rtlDigits = (text, line) => {
    if (!/[0-9]/.test(text) || !nativeDigitScriptsIn(text).length) return false;
    for (const m of text.matchAll(DIGIT_RUN_RE))
      findings.push({ rule: 'arabic-western-digits', sev: 'flag', line, from: m[0], to: '', msg: MSG.digits });
    return true;
  };

  // Mixed-direction UI text: an RTL script AND a strong-LTR word in the same run
  // reorder ambiguously (the Unicode Bidi Algorithm can't know intent) unless the
  // opposite-direction run is isolated. The whole localization industry validates
  // translation but NOT this — report-only, one flag per mixed text node.
  const bidiIsolation = (text, line) => {
    if (!rtlScriptsIn(text).length) return;
    const m = LTR_WORD_RE.exec(text);
    if (!m) return;
    findings.push({ rule: 'bidi-isolation', sev: 'flag', line, from: m[0], to: '', msg: MSG.bidi });
  };

  babelTraverse(ast, {
    StringLiteral(p) {
      const n = p.node;
      const line = n.loc.start.line;
      // Transform the RAW source slice, not n.value: the decoded value re-encodes
      // escapes (e.g. "a\\b" would be spliced back as "a\b" = a backspace),
      // silently corrupting the string. The raw slice is byte-faithful.
      if (isClassContext(p)) collectClass(src.slice(n.start + 1, n.end - 1), n.start + 1, n.end - 1, line);
      rtlDigits(n.value, line);
    },
    TemplateElement(p) {
      const tl = p.parentPath;
      if (!tl || !tl.isTemplateLiteral() || tl.node.expressions.length !== 0) return;
      const n = p.node;
      const line = n.loc.start.line;
      const raw = n.value.raw;
      if (isClassContext(tl)) collectClass(raw, n.start, n.end, line);
      rtlDigits(raw, line);
    },
    JSXText(p) {
      const n = p.node;
      const line = n.loc.start.line;
      bidiIsolation(n.value, line);
      if (rtlDigits(n.value, line)) return;
      // Bare Western digits under a lang="ar"/dir="rtl" ancestor are a
      // localization bug — BUT only when the run has no strong-LTR word. Latin
      // text like "Page 3 of 10" inside an RTL shell is correct English and must
      // not be flagged; "2024" alone in a lang="ar" span is.
      if (!/[0-9]/.test(n.value) || LTR_WORD_RE.test(n.value)) return;
      const el = p.findParent(pp => pp.isJSXElement());
      if (!el) return;
      const attrs = el.node.openingElement.attributes || [];
      const rtlAttr = attrs.some(a => a.type === 'JSXAttribute' && a.value && a.value.type === 'StringLiteral' &&
        ((a.name.name === 'lang' && /^ar\b/i.test(a.value.value)) || (a.name.name === 'dir' && /^rtl$/i.test(a.value.value))));
      if (rtlAttr) for (const m of n.value.matchAll(DIGIT_RUN_RE))
        findings.push({ rule: 'arabic-western-digits', sev: 'flag', line, from: m[0], to: '', msg: MSG.digits });
    },
    JSXAttribute(p) {
      if (p.node.name.name !== 'style') return;
      const v = p.node.value;
      if (!v || v.type !== 'JSXExpressionContainer' || !v.expression || v.expression.type !== 'ObjectExpression') return;
      styleObject(v.expression, findings, edits);
    },
    AssignmentExpression(p) {
      const left = p.node.left;
      if (!left || left.type !== 'MemberExpression') return;
      const obj = left.object;
      const isStyle = obj && obj.type === 'MemberExpression' && !obj.computed &&
        obj.property.type === 'Identifier' && obj.property.name === 'style';
      const isStyleId = obj && obj.type === 'Identifier' && obj.name === 'style';
      if (!isStyle && !isStyleId) return;
      const prop = left.property;
      let keyName = null, isString = false;
      if (!left.computed && prop.type === 'Identifier') keyName = prop.name;
      else if (left.computed && prop.type === 'StringLiteral') { keyName = prop.value; isString = true; }
      if (keyName && STYLE_MAP[keyName]) {
        const line = prop.loc.start.line;
        findings.push({ rule: 'js-style-logical', sev: 'fix', line, from: keyName, to: STYLE_MAP[keyName], msg: MSG.js });
        edits.push({ start: isString ? prop.start + 1 : prop.start, end: isString ? prop.end - 1 : prop.end, text: STYLE_MAP[keyName] });
      }
      if (keyName === 'textAlign') {
        const r = p.node.right;
        if (r && r.type === 'StringLiteral' && TEXT_ALIGN_VAL[r.value]) {
          findings.push({ rule: 'js-style-logical', sev: 'fix', line: r.loc.start.line, from: r.value, to: TEXT_ALIGN_VAL[r.value], msg: MSG.js });
          edits.push({ start: r.start + 1, end: r.end - 1, text: TEXT_ALIGN_VAL[r.value] });
        }
      }
      if (keyName === 'transform' || keyName === 'backgroundPosition') {
        const r = p.node.right;
        if (r && r.type === 'StringLiteral') {
          const hit = keyName === 'transform' ? transformNeedsMirror(r.value) : positionNeedsMirror(r.value);
          if (hit) findings.push({ rule: 'flippable-transform', sev: 'flag', line: r.loc.start.line, from: r.value, to: '', msg: MSG.flip });
        }
      }
    },
    ObjectProperty(p) {
      // font-family flag anywhere (report-only)
      const k = p.node.key;
      const keyName = k.type === 'Identifier' ? k.name : (k.type === 'StringLiteral' ? k.value : null);
      if (keyName === 'fontFamily' && p.node.value.type === 'StringLiteral') {
        if (fontStackNeedsArabic(p.node.value.value))
          findings.push({ rule: 'latin-font-stack', sev: 'flag', line: p.node.value.loc.start.line, from: p.node.value.value, to: '', msg: MSG.font });
      }
    },
  });
  return true;

  function utilCallee(callee) {
    if (!callee) return false;
    if (callee.type === 'Identifier') return CLASS_UTILS.has(callee.name);
    if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return CLASS_UTILS.has(callee.property.name);
    return false;
  }
  function utilTag(tag) {
    return tag && tag.type === 'Identifier' && CLASS_TAGS.has(tag.name);
  }
}

function styleObject(objExpr, findings, edits) {
  for (const prop of objExpr.properties) {
    if (prop.type !== 'ObjectProperty' || prop.computed) continue;
    const k = prop.key;
    const keyName = k.type === 'Identifier' ? k.name : (k.type === 'StringLiteral' ? k.value : null);
    if (!keyName) continue;
    if (STYLE_MAP[keyName]) {
      const isString = k.type === 'StringLiteral';
      findings.push({ rule: 'js-style-logical', sev: 'fix', line: k.loc.start.line, from: keyName, to: STYLE_MAP[keyName], msg: MSG.js });
      edits.push({ start: isString ? k.start + 1 : k.start, end: isString ? k.end - 1 : k.end, text: STYLE_MAP[keyName] });
    }
    if (keyName === 'textAlign' && prop.value.type === 'StringLiteral' && TEXT_ALIGN_VAL[prop.value.value]) {
      const v = prop.value;
      findings.push({ rule: 'js-style-logical', sev: 'fix', line: v.loc.start.line, from: v.value, to: TEXT_ALIGN_VAL[v.value], msg: MSG.js });
      edits.push({ start: v.start + 1, end: v.end - 1, text: TEXT_ALIGN_VAL[v.value] });
    }
    if (keyName === 'transform' && prop.value.type === 'StringLiteral' && transformNeedsMirror(prop.value.value))
      findings.push({ rule: 'flippable-transform', sev: 'flag', line: prop.value.loc.start.line, from: prop.value.value, to: '', msg: MSG.flip });
    if (keyName === 'backgroundPosition' && prop.value.type === 'StringLiteral' && positionNeedsMirror(prop.value.value))
      findings.push({ rule: 'flippable-transform', sev: 'flag', line: prop.value.loc.start.line, from: prop.value.value, to: '', msg: MSG.flip });
  }
}

// ---------------------------------------------------------------------------
// CSS scan (PostCSS)  →  returns fixed CSS string (byte-faithful) or null
// ---------------------------------------------------------------------------
function scanCss(file, src, findings, edits) {
  if (!postcss) return;
  let root;
  try { root = postcss.parse(src); }
  catch { return; } // e.g. exotic SCSS — keep flag-only, no fix
  // Fixes are applied as surgical byte-offset edits into the original source
  // (not via root.toString()), so a leading BOM, inline comments in values, and
  // every other unrelated byte are preserved verbatim.
  root.walkDecls(decl => {
    const prop = decl.prop.toLowerCase();
    const start = decl.source && decl.source.start;
    const line = start ? start.line : 1;
    const propOff = start && typeof start.offset === 'number' ? start.offset : null;
    if (CSS_PROP_MAP[prop]) {
      findings.push({ rule: 'css-logical', sev: 'fix', line, from: decl.prop, to: CSS_PROP_MAP[prop], msg: MSG.css });
      if (propOff !== null) edits.push({ start: propOff, end: propOff + decl.prop.length, text: CSS_PROP_MAP[prop] });
      return;
    }
    if (CSS_VALUE_MAP[prop]) {
      const val = decl.value.trim().toLowerCase();
      const to = CSS_VALUE_MAP[prop][val];
      if (to) {
        findings.push({ rule: 'css-logical', sev: 'fix', line, from: prop + ': ' + val, to: prop + ': ' + to, msg: MSG.cssVal });
        if (propOff !== null) {
          const between = (decl.raws && decl.raws.between) || '';
          const rawVal = decl.raws && decl.raws.value ? decl.raws.value.raw : decl.value;
          const lead = rawVal.match(/^\s*/)[0].length;
          const kw = rawVal.slice(lead).match(/^[^\s/;]+/);
          if (kw) {
            const kwStart = propOff + decl.prop.length + between.length + lead;
            edits.push({ start: kwStart, end: kwStart + kw[0].length, text: to });
          }
        }
        return;
      }
    }
    if (TRANSFORM_PROPS.has(prop) && transformNeedsMirror(decl.value))
      findings.push({ rule: 'flippable-transform', sev: 'flag', line, from: decl.prop + ': ' + decl.value.trim(), to: '', msg: MSG.flip });
    if (POSITION_PROPS.has(prop) && positionNeedsMirror(decl.value))
      findings.push({ rule: 'flippable-transform', sev: 'flag', line, from: decl.prop + ': ' + decl.value.trim(), to: '', msg: MSG.flip });
    if (CSS_CORNER.has(prop))
      findings.push({ rule: 'physical-corner', sev: 'flag', line, from: decl.prop, to: '', msg: MSG.corner });
    if (prop === 'font-family' && fontStackNeedsArabic(decl.value))
      findings.push({ rule: 'latin-font-stack', sev: 'flag', line, from: decl.value.trim(), to: '', msg: MSG.font });
  });
}

// ---------------------------------------------------------------------------
// Markup scan (.html/.vue/.svelte/.astro) — class attrs via bounded regex
// ---------------------------------------------------------------------------
// Lead-in `(?<![\w-])` (not `\b`) so `data-class`, `data-className`, `xclass`,
// etc. are NOT treated as class attributes — only a real `class=`/`className=`
// preceded by `<`, whitespace, a quote or `{`.
const MARKUP_CLASS_RE = /(?<![\w-])(?:class|className)\s*=\s*(["'])((?:(?!\1).)*)\1/g;

// Blank out <script>, <style> and HTML-comment regions (same-length spaces so
// byte offsets stay valid) before scanning markup — a `class="…"` inside a
// script string, a stylesheet, or a commented-out block is not a live class
// attribute and must never be rewritten by --fix.
const MASK_REGION_RE = /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi;
function maskRegions(src) {
  return src.replace(MASK_REGION_RE, m => ' '.repeat(m.length));
}

// Inline `style="…"` attribute (real attribute only — `:style`/`v-bind:style`/
// `[style]` bindings and JSX `style={{…}}` are excluded).
const MARKUP_STYLE_RE = /(?<![\w:.[-])style\s*=\s*(["'])((?:(?!\1).)*)\1/g;
// Apply the CSS physical→logical prop/value maps to an inline-style string,
// pushing byte-offset edits relative to `base` (the offset of raw[0] in src).
function scanInlineStyle(raw, base, line, findings, edits) {
  let idx = 0;
  for (const part of raw.split(';')) {
    const ci = part.indexOf(':');
    if (ci !== -1) {
      const rawProp = part.slice(0, ci);
      const prop = rawProp.trim().toLowerCase();
      if (CSS_PROP_MAP[prop]) {
        const propLead = rawProp.length - rawProp.trimStart().length;
        const propStart = base + idx + propLead;
        findings.push({ rule: 'css-logical', sev: 'fix', line, from: rawProp.trim(), to: CSS_PROP_MAP[prop], msg: MSG.css });
        edits.push({ start: propStart, end: propStart + rawProp.trim().length, text: CSS_PROP_MAP[prop] });
      } else if (CSS_VALUE_MAP[prop]) {
        const rawVal = part.slice(ci + 1);
        const kwm = rawVal.match(/^(\s*)([^\s;]+)/);
        const val = kwm ? kwm[2].toLowerCase() : '';
        const to = CSS_VALUE_MAP[prop][val];
        if (to && kwm) {
          const valStart = base + idx + ci + 1 + kwm[1].length;
          findings.push({ rule: 'css-logical', sev: 'fix', line, from: prop + ': ' + val, to: prop + ': ' + to, msg: MSG.cssVal });
          edits.push({ start: valStart, end: valStart + kwm[2].length, text: to });
        }
      }
    }
    idx += part.length + 1; // +1 for the ';'
  }
}
function scanMarkup(file, src, findings, edits) {
  let m;
  MARKUP_CLASS_RE.lastIndex = 0;
  while ((m = MARKUP_CLASS_RE.exec(src)) !== null) {
    const raw = m[2];
    if (raw.includes('{') || raw.includes('}') || raw.includes('<') || raw.includes('$')) continue; // binding/template
    const valStart = m.index + m[0].length - 1 - raw.length;
    const line = lineAt(src, valStart);
    const { out, changes, corners } = transformClassString(raw);
    for (const [from, to] of changes) findings.push({ rule: 'tw-logical', sev: 'fix', line, from, to, msg: MSG.tw });
    for (const c of corners) findings.push({ rule: 'physical-corner', sev: 'flag', line, from: c, to: '', msg: MSG.corner });
    if (out !== raw) edits.push({ start: valStart, end: valStart + raw.length, text: out });
  }
  // Inline style="…" physical→logical (skip dynamic bindings).
  MARKUP_STYLE_RE.lastIndex = 0;
  while ((m = MARKUP_STYLE_RE.exec(src)) !== null) {
    const raw = m[2];
    if (raw.includes('{') || raw.includes('}') || raw.includes('$')) continue; // binding/expression
    const valStart = m.index + m[0].length - 1 - raw.length;
    scanInlineStyle(raw, valStart, lineAt(src, valStart), findings, edits);
  }
  // RTL-native-numeral script + Western digits, line heuristic. Scan only
  // element TEXT content (tags stripped) so class/style/id/attribute digits
  // (`ml-4`, `width:200px`, `id="s3"`, `tabindex`) are never mistaken for UI
  // numerals, and skip any run with a strong-LTR word so Latin numbers inside
  // an RTL container ("Page 3") are not flagged. Fire when the text carries a
  // native-digit script, or the element is lang="ar"/dir="rtl" (a bare number).
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].replace(/<[^>]*>/g, ' ');
    if (!/[0-9]/.test(text) || LTR_WORD_RE.test(text)) continue;
    const rtlEl = /(?<![\w-])lang\s*=\s*["']?ar\b/i.test(lines[i]) || /(?<![\w-])dir\s*=\s*["']?rtl\b/i.test(lines[i]);
    if (nativeDigitScriptsIn(text).length || rtlEl)
      for (const dm of text.matchAll(DIGIT_RUN_RE))
        findings.push({ rule: 'arabic-western-digits', sev: 'flag', line: i + 1, from: dm[0], to: '', msg: MSG.digits });
  }
}

// ---------------------------------------------------------------------------
// Regex flag passes shared by code + markup
// ---------------------------------------------------------------------------
function regexFlags(src, findings, opts) {
  const seen = new Set();
  const push = (rule, line, from, msg) => {
    const k = rule + ':' + line + ':' + from;
    if (seen.has(k)) return;
    seen.add(k);
    findings.push({ rule, sev: 'flag', line, from, to: '', msg });
  };
  if (opts.icon) {
    let m; ICON_RE.lastIndex = 0;
    while ((m = ICON_RE.exec(src)) !== null) push('icon-directional', lineAt(src, m.index), m[0], MSG.icon);
    ICON_KEBAB_RE.lastIndex = 0;
    while ((m = ICON_KEBAB_RE.exec(src)) !== null) {
      const nameTok = m[1];
      if (nameTok.split('-').some(seg => ICON_DIR_SEG.has(seg)))
        push('icon-directional', lineAt(src, m.index), nameTok, MSG.icon);
    }
  }
  // The hardcoded-dir rule is about markup/JS `dir=` attributes and
  // element.dir assignments. A CSS `direction: rtl` declaration and a
  // `[dir="rtl"]` selector are the canonical way to author RTL styles, not a
  // bug — so this pass is skipped for CSS (opts.dir === false).
  if (opts.dir !== false) {
    for (const re of [DIR_ATTR_RE, DIR_CSS_RE, DIR_SETATTR_RE]) {
      let m; re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) push('hardcoded-dir', lineAt(src, m.index), m[0].trim(), MSG.dir);
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------
const SEV_ORDER = { fix: 0, flag: 1 };
function sortFindings(findings) {
  findings.sort((a, b) =>
    a.line - b.line ||
    SEV_ORDER[a.sev] - SEV_ORDER[b.sev] ||
    a.rule.localeCompare(b.rule) ||
    a.from.localeCompare(b.from) ||
    a.to.localeCompare(b.to));
  const seen = new Set();
  return findings.filter(f => {
    const k = [f.rule, f.sev, f.line, f.from, f.to].join('|');
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

function scanSource(file, src) {
  const ext = path.extname(file).toLowerCase();
  let findings = [];
  const edits = [];
  let fixed = src;

  if (JS_EXT.has(ext)) {
    const maskRanges = [];
    scanJs(file, src, ext, findings, edits, maskRanges);
    regexFlags(blankRanges(src, maskRanges), findings, { icon: true });
    fixed = applyEdits(src, edits);
  } else if (CSS_EXT.has(ext)) {
    // Offsets from PostCSS are relative to the BOM-stripped body; edit the body
    // and re-attach the BOM so a leading BOM survives verbatim.
    const hasBom = src.charCodeAt(0) === 0xFEFF;
    const body = hasBom ? src.slice(1) : src;
    scanCss(file, body, findings, edits);
    regexFlags(body, findings, { icon: false, dir: false });
    fixed = (hasBom ? '﻿' : '') + applyEdits(body, edits);
  } else if (MARKUP_EXT.has(ext)) {
    // Scan a copy with <script>/<style>/comment regions blanked so class
    // attributes inside them are never rewritten; edits apply to the real src
    // (masking preserves length, so offsets line up).
    const masked = maskRegions(src);
    scanMarkup(file, masked, findings, edits);
    regexFlags(masked, findings, { icon: true });
    fixed = applyEdits(src, edits);
  } else {
    return { findings: [], fixed: src };
  }

  findings = sortFindings(findings);
  return { findings, fixed };
}

module.exports = {
  scanSource,
  // exported for unit tests / reuse
  mapTailwindToken, transformClassString, fontStackNeedsArabic,
  rtlScriptsIn, nativeDigitScriptsIn,
  JS_EXT, CSS_EXT, MARKUP_EXT,
};
