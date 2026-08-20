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
  inputDir: 'LTR-native input (tel/email/url/number) in an RTL page needs dir="ltr" — otherwise the value and caret jump to the wrong side and “+1 (…)” / “@” reorder',
  shadow: 'shadow has a horizontal offset that won’t auto-mirror for RTL — flip its X offset per direction (e.g. a [dir="rtl"] override) so the light comes from the same logical side',
  rn: 'React Native physical style — use the direction-aware form (marginStart/paddingEnd/start/end/borderStartWidth…, or textAlign:"auto") so it follows I18nManager.isRTL',
  align: 'the align="left"/"right" attribute predates logical alignment and does NOT follow text direction — use CSS text-align:start/end (or a dir-aware class) so it flips for RTL',
};

// React Native logical style map. RN's logical props are start/end-based
// (marginStart, NOT the web marginInlineStart), so RN needs its own mapping.
const RN_LOGICAL_MAP = {
  marginLeft: 'marginStart', marginRight: 'marginEnd',
  paddingLeft: 'paddingStart', paddingRight: 'paddingEnd',
  borderLeftWidth: 'borderStartWidth', borderRightWidth: 'borderEndWidth',
  borderLeftColor: 'borderStartColor', borderRightColor: 'borderEndColor',
  borderTopLeftRadius: 'borderTopStartRadius', borderTopRightRadius: 'borderTopEndRadius',
  borderBottomLeftRadius: 'borderBottomStartRadius', borderBottomRightRadius: 'borderBottomEndRadius',
  left: 'start', right: 'end',
};
const RN_IMPORT_RE = /(?:from|import)\s*['"]react-native['"]|require\(\s*['"]react-native['"]\s*\)/;
const VE_IMPORT_RE = /@vanilla-extract\/css/;

// CSS-in-JS tagged templates whose backticked body is CSS: styled-components /
// emotion (`styled.div``, `styled(X)``, `styled.div.attrs()``, `css``,
// `createGlobalStyle``, `keyframes``, `injectGlobal``). The body is scanned by
// the real PostCSS engine (scanCss), so it reuses every physical→logical rule.
const CSSIJ_TAGS = new Set(['css', 'createGlobalStyle', 'injectGlobal', 'keyframes']);
function cssInJsTagRoot(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return cssInJsTagRoot(node.object);
  if (node.type === 'CallExpression') return cssInJsTagRoot(node.callee);
  return null;
}
function isCssInJsTag(tag) {
  if (!tag) return false;
  if (tag.type === 'Identifier') return CSSIJ_TAGS.has(tag.name);
  const root = cssInJsTagRoot(tag);
  return root === 'styled' || CSSIJ_TAGS.has(root);
}
// vanilla-extract style helpers whose first object arg IS a style object.
const VE_STYLE_CALLS = new Set(['style', 'globalStyle']);

// A strong-LTR word (≥2 chars: brand/name/URL/code) embedded in RTL text.
const LTR_WORD_RE = /[A-Za-z][A-Za-z0-9._@/+-]*[A-Za-z0-9]/;
// Native RTL numeral CHARACTERS — Arabic-Indic (٠-٩), Extended/Persian (۰-۹),
// N'Ko (߀-߉), Adlam (𞥐-𞥙). Presence signals the page uses native numerals, so a
// Western-digit run alongside them is a genuine mixed-numeral inconsistency.
const NATIVE_DIGIT_RE = /[٠-٩۰-۹߀-߉]|\uD83A[\uDD50-\uDD59]/;

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

// `skipFirst`/`skipLast` protect a token that sits directly against a template
// `${…}` boundary (it may be only a fragment of a class, e.g. `ml-4` in
// `` `ml-4${x}` ``), so an interpolated template can be mapped token-by-token
// without touching a partial token.
function transformClassString(str, skipFirst, skipLast) {
  const changes = [];
  const corners = [];
  const parts = str.split(/(\s+)/);
  const contentIdx = [];
  for (let i = 0; i < parts.length; i++) if (parts[i].trim()) contentIdx.push(i);
  const firstContent = contentIdx[0], lastContent = contentIdx[contentIdx.length - 1];
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    if (!t.trim()) continue;
    if (t.includes('${') || t.includes('{') || t.includes('}')) continue; // template artefact
    if (t.includes('\\')) continue; // a backslash-escaped token is not a class util; never rewrite it
    if (skipFirst && i === firstContent) continue; // partial token against a preceding ${…}
    if (skipLast && i === lastContent) continue;    // partial token against a following ${…}
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
  // Arabic
  'cairo', 'tajawal', 'almarai', 'amiri', 'rubik', 'el messiri', 'changa',
  'noto sans arabic', 'noto kufi arabic', 'noto naskh arabic', 'ibm plex sans arabic',
  'markazi text', 'lateef', 'scheherazade new', 'reem kufi', 'harmattan', 'mada',
  'katibeh', 'lalezar', 'jomhuria', 'aref ruqaa', 'readex pro', 'baloo bhaijaan 2',
  'dubai', 'sakkal majalla', 'traditional arabic', 'simplified arabic', 'andalus',
  'geeza pro', 'al bayan', 'baghdad', 'decotype naskh', 'droid arabic naskh',
  'droid arabic kufi', 'sultan', 'tahoma', 'segoe ui', 'arial unicode ms',
  // Persian / Farsi — Arabic script (the B1 gap: a correct Persian stack was
  // being reported as "no Arabic family")
  'vazirmatn', 'vazir', 'iransans', 'iranian sans', 'iran sans', 'iranyekan',
  'iran yekan', 'b nazanin', 'nazanin', 'sahel', 'shabnam', 'samim', 'parastoo',
  'dana', 'estedad', 'gandom', 'ziba', 'yekan', 'b yekan', 'b titr', 'titr',
  // Urdu / Sindhi — Arabic script
  'jameel noori nastaleeq', 'noto nastaliq urdu', 'mehr nastaliq', 'nafees',
]);
// A family whose name itself signals Arabic-script coverage (Arabic/Persian/Urdu
// and the classic script styles) — so a Vazir-/Nazanin-/Kufi-/Naskh-named face is
// recognized without needing every weight variant in the set above.
const ARABIC_SCRIPT_HINT = /arabic|persian|farsi|urdu|nastaliq|nastaleeq|naskh|kufi|ruqaa|thuluth|diwani|nazanin|yekan|vazir/;
function fontStackNeedsArabic(value) {
  const families = value.split(',')
    .map(f => f.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);
  if (!families.length) return false;
  const hasArabic = families.some(f => ARABIC_FONTS.has(f) || ARABIC_SCRIPT_HINT.test(f));
  const hasNamed = families.some(f => !GENERIC_FONTS.has(f));
  return hasNamed && !hasArabic;
}

// ---------------------------------------------------------------------------
// Shared regex flag detectors (report-only, never edit — safe on any text)
// ---------------------------------------------------------------------------
const ICON_RE = /(?:Chevrons?|Arrows?|Caret|Angles?|ArrowBig|CircleArrow|SquareArrow|KeyboardArrow|Move|Panel)(?:Left|Right)/g;
// The Back/Forward/Before/Next/First/Last families (MUI ArrowBack/NavigateNext,
// Ionicons ChevronForward, …) — only on a strong icon base, and `(?![a-z])` so
// `ArrowBackground`/`ForwardingAddress` can't false-match a directional word that
// is merely a prefix of a longer one.
const ICON_DIR2_RE = /(?:(?:Arrow|Chevron|Navigate)(?:Back|Forward|Before|Next)|Chevron(?:First|Last))(?![a-z])/g;
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
// LTR-island inputs: phone/email/url/number fields hold left-to-right content and
// must carry dir="ltr" even in an RTL page. Match an <input …> tag (markup or JSX),
// then check its type + absence of dir in a second pass so order doesn't matter.
const INPUT_TAG_RE = /<input\b[^>]*?\/?>/gi;
// Physical directional markup (M21 Angular templates · M22 HTML-email · legacy HTML):
// align="left|right" doesn't follow text direction; Angular [style.<physical>]
// bindings carry a physical CSS property. Markup-only, flag-only. The lookbehind
// keeps text-align= / valign= from matching.
const PHYS_ALIGN_RE = /(?<![\w-])align\s*=\s*["']?(left|right)\b/gi;
const NG_STYLE_BIND_RE = /\[style\.(margin-left|margin-right|padding-left|padding-right|border-left|border-right|left|right)\b/gi;
const INPUT_TYPE_RE = /(?<![\w-])type\s*=\s*[\s{("'`]*?(tel|email|url|number)\b/i;
const INPUT_HAS_DIR_RE = /(?<![\w?&-])dir\s*=/i;
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

// box-shadow / text-shadow: the first length in each shadow is its horizontal
// offset. A non-zero X offset points the shadow sideways and does NOT mirror for
// RTL (there is no logical form), so it must be flipped per direction. Vertical-
// only shadows (X = 0) are direction-neutral and never flagged.
const SHADOW_PROPS = new Set(['box-shadow', '-webkit-box-shadow', '-moz-box-shadow', 'text-shadow']);
const LEN_RE = /^-?(?:\d*\.)?\d+(?:px|r?em|%|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pt|pc|q)?$/;
function shadowNeedsMirror(value) {
  const v = String(value).toLowerCase();
  if (v.includes('var(') || v.includes('calc(')) return false;   // unknown offset → don't guess
  for (let shadow of v.split(/,(?![^(]*\))/)) {                    // split shadows on top-level commas
    shadow = shadow.replace(/\binset\b/g, ' ')
      .replace(/#[0-9a-f]{3,8}\b/g, ' ')
      .replace(/\b(?:rgba?|hsla?|hwb|lab|lch|color)\([^)]*\)/g, ' ');
    const lengths = shadow.split(/\s+/).filter(Boolean).filter(t => LEN_RE.test(t));
    if (lengths.length && !isZeroLen(lengths[0])) return true;     // non-zero X offset
  }
  return false;
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

  // Only treat StyleSheet.create as React Native when the file actually imports
  // react-native — otherwise it could be Aphrodite (web CSS-in-JS), whose logical
  // target is marginInlineStart, not RN's marginStart. Gate to avoid mis-advice.
  const isRN = RN_IMPORT_RE.test(src);
  const isVE = VE_IMPORT_RE.test(src);

  const processed = new Set(); // class-string node ranges already handled

  const collectClass = (raw, innerStart, innerEnd, line, skipFirst, skipLast) => {
    const key = innerStart + ':' + innerEnd;
    if (processed.has(key)) return;
    processed.add(key);
    const { out, changes, corners } = transformClassString(raw, skipFirst, skipLast);
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
      if (!tl || !tl.isTemplateLiteral()) return;
      const n = p.node;
      const line = n.loc.start.line;
      const raw = n.value.raw;
      if (isClassContext(tl)) {
        // Process every quasi of an interpolated className template, mapping only
        // tokens that aren't fragments abutting a ${…} placeholder.
        const quasis = tl.node.quasis;
        const idx = quasis.indexOf(n);
        const isFirst = idx === 0;
        const isLast = n.tail || idx === quasis.length - 1;
        const skipFirst = !isFirst && !/^\s/.test(raw); // token touches the preceding ${…}
        const skipLast = !isLast && !/\s$/.test(raw);    // token touches the following ${…}
        collectClass(raw, n.start, n.end, line, skipFirst, skipLast);
      }
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
    // CSS-in-JS: styled-components / emotion tagged templates. Scan the CSS body
    // with the real PostCSS engine. Static (no ${…}) single-quasi templates get
    // byte-safe fixes; interpolated ones are flag-only (offsets across ${…} holes
    // aren't safe to rewrite), so the fix pipeline never corrupts a template.
    TaggedTemplateExpression(p) {
      if (!postcss || !isCssInJsTag(p.node.tag)) return;
      const tl = p.node.quasi;
      const quasis = tl.quasis || [];
      const canFix = (tl.expressions || []).length === 0 && quasis.length === 1;
      for (const q of quasis) {
        const start = q.start, end = q.end;
        if (typeof start !== 'number' || typeof end !== 'number' || end <= start) continue;
        const text = src.slice(start, end);          // raw fragment — byte-faithful
        if (!/[:{]/.test(text)) continue;            // no declaration/selector in this fragment
        const baseLine = lineAt(src, start);
        const tf = [], te = [];
        scanCss(file, text, tf, te);
        for (const f of tf) findings.push(Object.assign({}, f, { line: (f.line - 1) + baseLine, sev: canFix ? f.sev : 'flag' }));
        if (canFix) for (const e of te) edits.push({ start: e.start + start, end: e.end + start, text: e.text });
      }
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
      if (keyName === 'transform' || keyName === 'backgroundPosition' || keyName === 'boxShadow' || keyName === 'textShadow') {
        const r = p.node.right;
        if (r && r.type === 'StringLiteral') {
          const shadow = keyName === 'boxShadow' || keyName === 'textShadow';
          const hit = keyName === 'transform' ? transformNeedsMirror(r.value)
            : shadow ? shadowNeedsMirror(r.value) : positionNeedsMirror(r.value);
          if (hit) findings.push({ rule: 'flippable-transform', sev: 'flag', line: r.loc.start.line, from: r.value, to: '', msg: shadow ? MSG.shadow : MSG.flip });
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
    // React Native: physical style props inside StyleSheet.create({...}). Gated
    // on an actual react-native import (so web Aphrodite isn't mis-advised) and
    // report-only — the RN logical target (marginStart) differs from web, and a
    // wrong auto-fix in a native app is costly. flexDirection:'row' is NOT flagged
    // (RN auto-flips row under RTL via I18nManager).
    CallExpression(p) {
      // vanilla-extract: style({...}) / globalStyle('sel', {...}) — the object is a
      // camelCase style object, same shape as a JSX style prop. Gated on the import
      // so a plain function named `style` is never mistaken for CSS.
      if (isVE) {
        const c = p.node.callee;
        const nm = c && c.type === 'Identifier' ? c.name : null;
        if (nm && VE_STYLE_CALLS.has(nm)) {
          for (const arg of p.node.arguments) {
            if (arg && arg.type === 'ObjectExpression') { styleObject(arg, findings, edits); break; }
          }
        }
      }
      if (!isRN) return;
      const callee = p.node.callee;
      if (!callee || callee.type !== 'MemberExpression') return;
      if (callee.object.type !== 'Identifier' || callee.object.name !== 'StyleSheet') return;
      if (callee.property.type !== 'Identifier' || callee.property.name !== 'create') return;
      const arg = p.node.arguments[0];
      if (!arg || arg.type !== 'ObjectExpression') return;
      for (const styleProp of arg.properties) {
        if (styleProp.type !== 'ObjectProperty' || styleProp.value.type !== 'ObjectExpression') continue;
        for (const decl of styleProp.value.properties) {
          if (decl.type !== 'ObjectProperty') continue;
          const dk = decl.key;
          const name = dk.type === 'Identifier' ? dk.name : (dk.type === 'StringLiteral' ? dk.value : null);
          if (!name) continue;
          if (RN_LOGICAL_MAP[name]) {
            findings.push({ rule: 'rn-logical', sev: 'flag', line: dk.loc.start.line, from: name, to: RN_LOGICAL_MAP[name], msg: MSG.rn });
          } else if (name === 'textAlign' && decl.value.type === 'StringLiteral' && (decl.value.value === 'left' || decl.value.value === 'right')) {
            findings.push({ rule: 'rn-logical', sev: 'flag', line: decl.value.loc.start.line, from: `textAlign: '${decl.value.value}'`, to: "textAlign: 'auto'", msg: MSG.rn });
          }
        }
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
    if ((keyName === 'boxShadow' || keyName === 'textShadow') && prop.value.type === 'StringLiteral' && shadowNeedsMirror(prop.value.value))
      findings.push({ rule: 'flippable-transform', sev: 'flag', line: prop.value.loc.start.line, from: prop.value.value, to: '', msg: MSG.shadow });
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
    if (SHADOW_PROPS.has(prop) && shadowNeedsMirror(decl.value))
      findings.push({ rule: 'flippable-transform', sev: 'flag', line, from: decl.prop + ': ' + decl.value.trim(), to: '', msg: MSG.shadow });
    if (CSS_CORNER.has(prop))
      findings.push({ rule: 'physical-corner', sev: 'flag', line, from: decl.prop, to: '', msg: MSG.corner });
    if (prop === 'font-family' && fontStackNeedsArabic(decl.value))
      findings.push({ rule: 'latin-font-stack', sev: 'flag', line, from: decl.value.trim(), to: '', msg: MSG.font });
  });

  // Tailwind v4: physical utilities hide in `@apply ml-4 text-left;` — an at-rule,
  // not a declaration, so walkDecls misses it. Reuse the exact className→logical
  // Tailwind mapper. Byte-safe fix only when the raw params slice verifies.
  root.walkAtRules('apply', at => {
    const rawParams = (at.raws && at.raws.params && at.raws.params.raw) || at.params || '';
    if (!rawParams.trim()) return;
    const { out, changes, corners } = transformClassString(rawParams, false, false);
    const start = at.source && at.source.start;
    const line = start ? start.line : 1;
    for (const [from, to] of changes) findings.push({ rule: 'tw-logical', sev: 'fix', line, from, to, msg: MSG.tw });
    for (const c of corners) findings.push({ rule: 'physical-corner', sev: 'flag', line, from: c, to: '', msg: MSG.corner });
    if (out !== rawParams && start && typeof start.offset === 'number') {
      const afterName = (at.raws && at.raws.afterName) || ' ';
      const paramsStart = start.offset + 1 + at.name.length + afterName.length; // '@' + name + gap
      if (src.slice(paramsStart, paramsStart + rawParams.length) === rawParams)  // guard against corruption
        edits.push({ start: paramsStart, end: paramsStart + rawParams.length, text: out });
    }
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
  // Blank every char EXCEPT newlines, so byte offsets stay valid AND line numbers
  // after a multi-line <style>/<script> block don't drift (previously the whole
  // block was replaced with spaces, collapsing its newlines).
  return src.replace(MASK_REGION_RE, m => m.replace(/[^\n]/g, ' '));
}
// Physical CSS lives inside <style> blocks too (esp. Vue/Svelte SFCs). Those
// blocks are masked out of the class/inline-style pass, so scan each one's
// content with the CSS engine and offset its findings/edits back into the file.
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
function scanStyleBlocks(file, src, findings, edits) {
  let m; STYLE_BLOCK_RE.lastIndex = 0;
  while ((m = STYLE_BLOCK_RE.exec(src)) !== null) {
    const inner = m[1];
    if (!inner.trim()) continue;
    const innerStart = m.index + m[0].indexOf(inner); // byte offset of block content in src
    const lineOffset = lineAt(src, innerStart) - 1;
    const sub = [], subEdits = [];
    scanCss(file, inner, sub, subEdits);
    for (const f of sub) { f.line += lineOffset; findings.push(f); }
    for (const e of subEdits) edits.push({ start: e.start + innerStart, end: e.end + innerStart, text: e.text });
  }
}

// The <script> blocks of an SFC (.vue/.svelte/.astro) or HTML file are masked
// out of the markup scan (so code inside them isn't rewritten) — which
// historically meant their CONTENTS were never checked. Scan them through Babel.
// Report-only: findings surface (line-offset into the file) but embedded-block
// auto-fix is skipped — the byte offsets differ from the outer file, and
// corrupting a .vue is far worse than a missed autofix. (<style> blocks are
// handled byte-safely by scanStyleBlocks above.)
const SCRIPT_BLOCK_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
function scanEmbeddedBlocks(file, src, findings) {
  const emit = (content, contentStart, run) => {
    const local = [];
    try { run(local); } catch { return; }               // parse error → skip block, never throw
    const base = lineAt(src, contentStart) - 1;
    for (const f of local) findings.push(Object.assign({}, f, { line: (f.line || 1) + base }));
  };
  let m;
  SCRIPT_BLOCK_RE.lastIndex = 0;
  while ((m = SCRIPT_BLOCK_RE.exec(src)) !== null) {
    const attrs = m[1], content = m[2], contentStart = m.index + m[0].indexOf('>') + 1;
    const ext = /lang\s*=\s*["']tsx?["']/i.test(attrs) ? '.tsx' : '.jsx';
    emit(content, contentStart, out => scanJs(file, content, ext, out, [], []));
  }
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
  // B3 — in rendered markup/content, flag a Western-digit run only where NATIVE
  // numeral CHARACTERS (٠-٩, ۰-۹ …) appear on the same line: an actual mixed-
  // numeral inconsistency (the page uses both — pick one). Uniform Western digits
  // in Arabic prose are a legitimate style choice on the modern Arabic web, not a
  // bug, so flagging them merely because the text is Arabic over-fired ~3.3k× on
  // Wikipedia. (The JSX/source path keeps its broader author-time nudge.) Digits
  // inside an explicit dir="ltr" run stay exempt — geo-coordinates, versions, etc.
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].replace(/<[^>]*>/g, ' ');
    if (!/[0-9]/.test(text) || LTR_WORD_RE.test(text)) continue;
    if (/(?<![\w-])dir\s*=\s*["']?ltr\b/i.test(lines[i])) continue;
    if (NATIVE_DIGIT_RE.test(text))
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
    ICON_DIR2_RE.lastIndex = 0;
    while ((m = ICON_DIR2_RE.exec(src)) !== null) push('icon-directional', lineAt(src, m.index), m[0], MSG.icon);
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
    // LTR-island inputs missing dir="ltr" (markup/JSX only; shares the dir gate).
    let im; INPUT_TAG_RE.lastIndex = 0;
    while ((im = INPUT_TAG_RE.exec(src)) !== null) {
      const tag = im[0];
      const tm = tag.match(INPUT_TYPE_RE);
      if (!tm || INPUT_HAS_DIR_RE.test(tag)) continue;
      push('input-dir', lineAt(src, im.index), '<input type="' + tm[1].toLowerCase() + '">', MSG.inputDir);
    }
  }
  // Physical directional markup (markup/email/Angular only — not CSS or JSX).
  if (opts.markup) {
    let m; PHYS_ALIGN_RE.lastIndex = 0;
    while ((m = PHYS_ALIGN_RE.exec(src)) !== null) push('physical-align', lineAt(src, m.index), m[0].trim(), MSG.align);
    NG_STYLE_BIND_RE.lastIndex = 0;
    while ((m = NG_STYLE_BIND_RE.exec(src)) !== null) push('css-logical', lineAt(src, m.index), '[style.' + m[1] + ']', MSG.css);
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
    regexFlags(masked, findings, { icon: true, markup: true });
    scanStyleBlocks(file, src, findings, edits); // B4 (#14): scan + byte-safe fix of physical CSS inside <style>
    scanEmbeddedBlocks(file, src, findings);     // <script> block contents (report-only)
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
