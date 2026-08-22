# Miraat (مرآة)

[![npm](https://img.shields.io/npm/v/miraat?color=cb3837&logo=npm)](https://www.npmjs.com/package/miraat)
[![CI](https://img.shields.io/github/actions/workflow/status/Otto-OttoSpace/miraat/ci.yml?branch=main&label=CI&logo=github)](https://github.com/Otto-OttoSpace/miraat/actions)
[![tests](https://img.shields.io/badge/tests-256%20passing-brightgreen)](https://github.com/Otto-OttoSpace/miraat/tree/main/test)
[![license](https://img.shields.io/npm/l/miraat?color=blue)](./LICENSE)
[![sponsor](https://img.shields.io/badge/sponsor-%E2%9D%A4-ea4aaa?logo=githubsponsors)](https://github.com/sponsors/Otto-OttoSpace)

**Find & fix the RTL mistakes AI code tools keep making — for every right-to-left script.**

> Formerly **rtlint**. *Miraat* (مرآة) is Arabic for "mirror" — mirroring left↔right is the whole job. The `rtlint` command and the `rtlint_*` MCP tools still work as aliases.

AI now writes most of the UI code in the world — and it is quietly, consistently *bad* at right-to-left. It reaches for `ml-4`, `text-left`, `padding-right`, hard-codes `dir="ltr"`, and never mirrors an icon. It looks fine in English and breaks the moment a real **Arabic, Hebrew, Syriac, Thaana, N'Ko or Adlam** user opens it.

`miraat` scans your React / Next / Tailwind / CSS, **auto-fixes the mechanical RTL mistakes**, flags the ones that need a human eye, and writes an **AI-rules file** so your agent (Cursor, Claude, Copilot) stops reintroducing them. It's script-aware: physical→logical, `dir` and mirrored-icon guidance fire for **all** RTL scripts, while script-specific checks (like Western digits in a native-numeral script) fire only where they're actually wrong — Arabic/Thaana/N'Ko/Adlam carry their own numerals; Hebrew and Syriac use Western digits, so those are never falsely flagged.

```bash
npx miraat .            # scan and report
npx miraat . --fix      # apply the safe fixes (physical → logical)
npx miraat . --check    # report only, exit non-zero if anything is found (CI)
npx miraat . --dry-run  # show what --fix would change, but write nothing
npx miraat . --init-rules   # inject RTL rules into your AI agents (Claude/Cursor/Gemini/Windsurf/Cline/Copilot/Codex)
```

> Runs straight from the repo, no install: `npx github:Otto-OttoSpace/miraat . --fix`

## One command, the whole suite

`miraat` is the umbrella for the RTL toolchain — one install, one command, every rule-pack:

```bash
npx miraat .            # RTL correctness            (default)
npx miraat type .       # Arabic typography & shaping (kashida)
npx miraat i18n .       # hardcoded strings / catalog (lahja)
npx miraat a11y .       # DGA Platforms-Code + WCAG   (daleel)
npx miraat all  .       # run every pack, one after another
```

The packs ship **with `miraat`**, so `npx miraat all .` runs the whole suite out of the box — no extra install. Each pack keeps its own audited engine (no monolith), so you can also install and run any of them standalone (`npx kashida .`, `npx lahja .`, `npx daleel .`), and `npx miraat . --score` gives the single RTL Score. The base RTL engine itself is dependency-light (Babel + PostCSS); the packs' heavier, feature-specific extras (e.g. a headless browser for live rendering) stay optional and load only when you use them.

## Zero-corruption by design

miraat parses your code with a real **AST** (Babel for JS/TS/JSX/TSX, PostCSS for CSS) — it does **not** regex over raw text. Only high-confidence, mechanically-safe edits are auto-applied, and they're written as surgical splices into the original source, so formatting is preserved to the byte. Custom class names (`left-sidebar`, `pl-PL`), CSS selectors/comments/custom-properties, and JS identifiers/params/types that merely *look* physical are **never** touched. Everything ambiguous is reported, never rewritten. Re-running `--fix` is always a no-op.

## Every RTL script, not just Arabic

miraat carries a Unicode **scripts table** (`lib/scripts.js`) so it reasons about each right-to-left script correctly instead of hard-coding Arabic:

| Script | dir | Own numerals? | Western digits flagged? |
|--------|-----|---------------|--------------------------|
| Arabic, N'Ko, Adlam, Thaana | rtl | yes | yes — use native / locale-aware numerals |
| Hebrew, Syriac | rtl | no (use Western) | **no** — never falsely flagged |

Physical→logical, `dir` handling and mirrored-icon flags apply to **all** of them; the numeral check keys off the table so it only fires where a script has its own digits.

## What it catches

| # | Pattern | miraat |
|---|---------|--------|
| 1 | Physical CSS (`margin-left`, `padding-right`, `border-left`, `text-align: left`) | **auto-fix → logical** (`margin-inline-start`, …) |
| 2 | Physical Tailwind (`ml-`, `pr-`, `left-`, `text-right`, `rounded-l`, `border-r`) — incl. inside `cn()`/`clsx()`/`cva()` | **auto-fix → logical** (`ms-`, `pe-`, `start-`, `text-end`, `rounded-s`, `border-e`) |
| 3 | Hard-coded `dir="ltr"` / `dir={"ltr"}` / `direction: "ltr"` / `setAttribute('dir','ltr')` (and `"rtl"`) | flag — make it dynamic |
| 4 | Un-mirrored directional icons (`ChevronLeft`, `BsChevronLeft`, `ArrowLeftIcon`, `MdKeyboardArrowRight`, …) | flag — mirror for RTL |
| 5 | Inline JS physical styles (`marginLeft`, `textAlign: 'left'`, `el.style.marginLeft = …`) | **auto-fix → logical** |
| 6 | Script-blind font stacks (no RTL-capable fallback) | flag — add a script-capable font |
| 7 | Western numerals inside a native-numeral RTL script (`السعر 1234 درهم`) | flag — use native / locale-aware numerals |
| 8 | LTR-native `<input type="tel\|email\|url\|number">` with no `dir` | flag — add `dir="ltr"` so the value & caret don't jump |
| 9 | React Native physical style in `StyleSheet.create` (`marginLeft`, `left`, `textAlign:'left'`) | flag — use RN logical (`marginStart`, `start`, `textAlign:'auto'`) |

## Before → after

```diff
- <div dir="ltr" className="ml-4 pr-2 text-left border-l rounded-l-lg">
+ <div dir="ltr" className="ms-4 pe-2 text-start border-s rounded-s-lg">
```
```diff
- margin-left: 16px; padding-right: 8px; text-align: left;
+ margin-inline-start: 16px; padding-inline-end: 8px; text-align: start;
```

## Why the flags aren't auto-fixed

The mechanical half of RTL — logical properties, mirrored utilities — is now commodity (shadcn and Tailwind ship it). **miraat gives you that for free.** But the half that actually makes an RTL script *feel right* — mirroring the correct icons, typographic scale and font pairing per script, bidi edge-cases, native numerals, cultural correctness — takes native judgment. miraat flags those; it doesn't guess. That judgment is a service, not a regex — see the roadmap.

## Use it in your AI agent (MCP)

miraat ships an **MCP server**, so Cursor / Claude / Windsurf can call it *while they write code* — the bug never ships:

```json
{
  "mcpServers": {
    "miraat": { "command": "npx", "args": ["-y", "-p", "github:Otto-OttoSpace/miraat", "miraat-mcp"] }
  }
}
```

RTL tools: **`miraat_scan`** (scan a path), **`miraat_check_code`** (snippet → findings + fixed code), and **`miraat_fix_code`** — send a snippet, get the **corrected code back** up front with the judgment calls (icons/dir/fonts/bidi/numerals) listed separately to decide. Call `miraat_fix_code` before proposing any UI code and the RTL bug never ships. The `rtlint_*` and legacy `rtl_*` names resolve to the same handlers.

**The whole suite, one server.** The same MCP also exposes the rest of the Arabic toolchain, so your agent gets every check over one connection:

- **`miraat_type_check`** — Arabic typography & shaping (kashida): broken cursive joins, letter-spacing on Arabic, tofu, script-blind fonts.
- **`miraat_i18n_check`** — internationalization (lahja): hard-coded strings, missing/empty keys, placeholder drift, CLDR plural completeness.
- **`miraat_a11y_check`** — accessibility (daleel): WCAG 2.2 AA + the Saudi DGA Platforms-Code.

Each takes a `path`. The packs ship with `miraat`; in the rare case one is unavailable, the tool returns a one-line install hint instead of failing.

## Use it in your editor (LSP)

miraat ships a **Language Server** — one binary that gives you **live RTL squiggles as you type** and **quick-fixes**, in every LSP editor (VS Code, Cursor, Windsurf, Neovim, JetBrains). It runs the same engine as the CLI, so your `miraat.config.json` severities and `miraat-disable` comments are honoured in the editor too. There is no other RTL language server.

```bash
npx -p miraat miraat-lsp        # stdio LSP server
```

Neovim (built-in LSP) example:

```lua
vim.lsp.start({ name = 'miraat', cmd = { 'npx', '-p', 'miraat', 'miraat-lsp' },
  root_dir = vim.fn.getcwd(), filetypes = { 'javascriptreact','typescriptreact','css','scss' } })
```

It publishes diagnostics on open/change/save and offers a per-finding fix plus **"fix all safe RTL issues in this file"** as code actions.

**VS Code:** install the one-click **[Miraat — RTL / Arabic linter](https://github.com/Otto-OttoSpace/miraat/tree/main/vscode-miraat)** extension — it boots this server for you, adds a status-bar fix-all button, and supports `"editor.codeActionsOnSave": { "source.fixAll.miraat": "explicit" }`.

## Use it in CI (GitHub Action)

```yaml
- uses: Otto-OttoSpace/miraat@main
  with:
    path: .
    # fix: true   # optionally apply fixes
```

Get inline PR annotations via **GitHub code scanning** — emit SARIF and upload it:

```yaml
- uses: Otto-OttoSpace/miraat@main
  with:
    path: .
    sarif: true            # writes miraat.sarif (does not fail the job)
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: miraat.sarif
```

Or straight from the CLI: `npx miraat . --sarif > miraat.sarif`.

**Other CI reporters:** `--format github` prints annotations that render inline on the PR diff; `--format gitlab-codequality` and `--format junit` emit the report artifacts GitLab / most CI dashboards ingest.

```yaml
- run: npx miraat . --format github        # inline PR annotations (step fails on errors)
```

## Turn it on in a real repo (governance)

A large existing app has RTL debt already. miraat is built to be adoptable on day one — snapshot the debt, then gate CI on *new* debt only:

```bash
npx miraat . --suppress-all          # writes miraat-baseline.json (file → rule → count)
npx miraat . --check                 # from now on, fails only on NEW RTL debt
npx miraat . --prune-suppressions    # after you fix some, shrink the baseline
```

Tune per rule with an auto-discovered `miraat.config.json` (ESLint-shaped — nothing new to learn):

```jsonc
{
  "extends": "miraat:recommended",          // or "miraat:strict" (fixes become errors)
  "rules": {
    "hardcoded-dir": "error",
    "arabic-western-digits": "off"          // off | warn | error
  }
}
```

Keep a legitimately LTR block quiet with an inline escape hatch (works in any comment syntax):

```css
/* miraat-disable-next-line css-logical -- phone-number field is intentionally LTR */
.phone { text-align: left; }
```

`miraat-disable-line`, block `miraat-disable` / `miraat-enable`, `.miraatignore` (+ your `.gitignore`), and
`--report-unused-disable-directives` all work as you'd expect. Exit codes: a plain scan fails on unaddressed
**error**-level findings; `--check` fails on **any** finding beyond the baseline (the CI gate).

## Get one number: the RTL Score

```bash
npx miraat . --score          # → Miraat RTL Score  100/100  (A)
npx miraat . --score --json    # { "score": 100, "grade": "A", ... }
```

100 = clean. Judgment-call flags weigh double the mechanical fixes, and penalties are normalized by
how much code was scanned — so one bad file doesn't tank a large, mostly-correct repo. Grades:
A ≥ 90 · B ≥ 75 · C ≥ 60 · D ≥ 40 · F.

**Show it off — the RTL Score badge:**

```bash
npx miraat . --badge > rtl-score.svg    # shields-style SVG (score + grade, colored A→F)
```
```md
![RTL Score](rtl-score.svg)             <!-- in your README -->
```

**Shareable proof — the HTML Correctness Report:**

```bash
npx miraat . --report                   # → miraat-report.html (self-contained; opens & prints anywhere)
npx miraat . --report audit.html        # custom filename
```

One page: the RTL Score, a by-rule breakdown, and every finding with its file/line and fix. No external assets. It's the artifact you hand a client or ship with a design system to *prove* the RTL is correct — checked against the ruleset, not a claim.

## Use it as an ESLint / stylelint rule

RTL issues in the lint run you already have:
[`eslint-plugin-miraat`](https://github.com/Otto-OttoSpace/miraat/tree/main/eslint-plugin-miraat)
(JS/TS/JSX) and
[`stylelint-plugin-miraat`](https://github.com/Otto-OttoSpace/miraat/tree/main/stylelint-plugin-miraat)
(CSS/SCSS/LESS):

```js
// eslint.config.js (flat, ESLint 9+)
import miraat from "eslint-plugin-miraat";
export default [ miraat.configs["flat/recommended"] ];
```

```jsonc
// .stylelintrc.json
{ "plugins": ["stylelint-plugin-miraat"], "rules": { "miraat/rtl": true } }
```

## Use it as a git hook (pre-commit)

```yaml
# .pre-commit-config.yaml
- repo: https://github.com/Otto-OttoSpace/miraat
  rev: v0.11.0
  hooks:
    - id: miraat
```

Or with husky + lint-staged:

```jsonc
// package.json
"lint-staged": { "*.{js,jsx,ts,tsx,css,scss,vue,svelte,html}": "miraat --check" }
```

## Roadmap → Miraat Pro

- **Hosted audit** — paste a repo or URL, get a full Arabic-RTL report + fixes (a designer-in-the-loop pass, not just the mechanical ones).
- **CI GitHub Action** — fail the PR when new physical RTL bugs land.
- **Arabic design layer** — drop-in typography / font-pairing / numeral / bidi tokens that are actually correct.

## Author

Built by an **Arabic-RTL Design Engineer** — Western-quality product design + RTL-correct code, in Arabic, French & English. The free handbook *"Arabic-RTL for the AI era"* is the companion to this tool.

MIT © 2026

## 💛 Support & commercial use

The Miraat suite is free and open-source (MIT). If it helps you ship correct Arabic/RTL, please consider [sponsoring on GitHub](https://github.com/sponsors/Otto-OttoSpace) — it funds maintenance and new rules.

Using it in a commercial product, in CI, or need the private **DGA Platforms-Code rule pack**? A **Miraat Pro** commercial licence — commercial use, a hosted CI audit that gates PRs ([miraat-action](https://github.com/Otto-OttoSpace/miraat-action)), and priority support — is available. Email **work@ottospace.co** and we'll set you up.
