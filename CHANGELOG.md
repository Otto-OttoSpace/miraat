# Changelog

## 0.11.0 — "adoptable on an existing repo"
The governance layer that lets a real, large codebase turn miraat on. A 4-lens feature hunt (see `ROADMAP-TO-THE-END.md`) found the blocker was never capability — it was that a 40k-line app can't switch `--check` on without it exploding on thousands of pre-existing hits, and had no per-rule tuning or escape hatch. This ships all four, ESLint-shaped so there's nothing new to learn.

- **Baseline / bulk-suppress.** `miraat . --suppress-all` snapshots the current debt to `miraat-baseline.json` (a `file → rule → count` map). Afterward `--check` fails only on **new** RTL debt — miraat becomes a ratchet. `--prune-suppressions` shrinks the baseline as you fix things (it can only ever shrink, never silently re-grow to hide a regression).
- **Config file + per-rule severity + presets.** Auto-discovers `miraat.config.json` (or `.js`/`.cjs`/`.miraatrc`) walking up from the target; `--config <file>` / `--no-config` override. `rules: { "hardcoded-dir": "error", "arabic-western-digits": "off" }` (`off` | `warn` | `error`), plus `extends: "miraat:recommended" | "miraat:strict"`. Default is unchanged: mechanical fixes are `warn` (don't fail a plain scan), judgment flags are `error`.
- **Inline-disable directives.** `/* miraat-disable-next-line css-logical -- reason */`, `miraat-disable-line`, and block `miraat-disable` / `miraat-enable`. Comment-syntax agnostic (works in `//`, `/* */`, `<!-- -->`, `#`). `--report-unused-disable-directives` lists escape hatches that matched nothing.
- **Ignore files.** Honors both `.gitignore` and `.miraatignore` at the scan root (gitignore syntax: negation, anchoring, `**`, directory pruning). `--no-ignore` to disable.
- Exit-code contract clarified: a plain scan fails on unaddressed **error**-level findings; `--check` gates CI on **any** finding beyond the baseline/disabled/off; a `--fix` run that wrote fixes never fails. `--json` now also reports `errors`, `warnings`, `baselineSuppressed`, `inlineDisabled`, and `unusedDisableDirectives`.

**One MCP for the whole Arabic suite (5 CLIs → one server):**
- The `miraat` MCP now also exposes **`miraat_type_check`** (kashida — Arabic typography & shaping), **`miraat_i18n_check`** (lahja — hard-coded strings, missing keys, plural completeness), and **`miraat_a11y_check`** (daleel — WCAG 2.2 + Saudi DGA). An AI agent gets RTL, typography, i18n and a11y over a single connection instead of four separate servers. Each takes a `path` (flag-guarded), packs are optional (missing → `npm i -D <pack>` hint). Same server, same aliases.

**AI-generation-time moat (agents self-correct mid-write):**
- **New MCP tool `miraat_fix_code`** — send a snippet, get the **corrected code back** as the primary payload, with the judgment calls miraat won't guess (icons to mirror, hard-coded `dir`, fonts, bidi, numerals) listed separately in `flagsToReview`. This is the fix-and-return loop a checker-only tool can't do — call it before proposing any UI code. (`rtlint_fix_code` / `rtl_fix_code` aliases too.)
- **`--init-rules` reaches more agents** — now also writes `GEMINI.md` (Gemini CLI) and `.clinerules` (Cline), alongside CLAUDE.md, Cursor, Windsurf, Copilot and AGENTS.md (Codex/OpenAI) — 8 targets, idempotent.
- The injected ruleset now leads with **"The 6 mistakes AI code tools make most"** (physical spacing · hard-coded direction · un-mirrored icons · no bidi isolation · broken Arabic shaping · LTR islands & numerals), each with a ✗→✓ one-liner — the exact failure modes AI reintroduces, primed up front.

**New rule — `rn-logical` (React Native, a class no linter covered):**
- Flags physical styles inside `StyleSheet.create({...})` with **RN-correct** logical targets (`marginLeft→marginStart`, `paddingRight→paddingEnd`, `left→start`, `borderTopLeftRadius→borderTopStartRadius`, `textAlign:'left'→'auto'`). Note RN's targets are `start`/`end`-based, *not* the web `marginInlineStart`. **Gated on an actual `react-native` import** so web CSS-in-JS that also uses `StyleSheet.create` (Aphrodite) is never mis-advised, and `flexDirection:'row'` is deliberately *not* flagged (RN auto-flips it under RTL). Report-only — a wrong auto-fix in a native app is costly.

**Vue / Svelte / HTML — the `<style>` and `<script>` blocks are now scanned:**
- Single-file-component `<style>` blocks go through PostCSS and `<script>` blocks through Babel — the same engines as `.css`/`.tsx` files — with findings line-offset into the real file. Previously these blocks were masked out and their contents never checked; now a `margin-left` in a `.vue` `<style scoped>` or an `el.style.marginLeft` in `<script setup lang="ts">` is caught, alongside the template classes and `input-dir` that already worked. Report-only inside blocks (auto-fix stays byte-exact on the outer file — a corrupted `.vue` is worse than a missed fix). No new dependencies.

**`--report` — the shareable HTML Correctness Report:**
- `npx miraat . --report [file]` writes a **self-contained** HTML report (default `miraat-report.html`): the RTL Score + grade, a by-rule breakdown, and every finding with file/line and fix. No external assets — opens and prints anywhere. It's the proof artifact you hand a client or ship with a design system (this is the "Miraat Correctness Report" the Arabic/RTL UI Kit ships). Language is legal-safe — "Miraat-verified against the ruleset," never "compliant."

**Wider `flippable-transform` coverage — directional shadows:**
- `box-shadow` / `text-shadow` (and JSX `boxShadow`/`textShadow`, `el.style.boxShadow`) with a **non-zero horizontal offset** now flag — a sideways shadow has no logical form and won't mirror for RTL. Vertical-only shadows (`0 2px …`, focus rings) and `var()`/`calc()` offsets are never flagged (no guessing). Joins the existing transform / background-position / transform-origin detection.

**New rule — `input-dir` (the most end-user-visible RTL bug):**
- Flags an LTR-native `<input type="tel|email|url|number">` that has no `dir` — in an RTL page its value and caret jump to the wrong side and `+1 (…)` / `@` reorder. Fires in JSX and HTML/Vue/Svelte markup, never in CSS, and skips inputs that already set `dir`. Report-only (adding an attribute is a structural edit, not a token swap). A class no CSS-only linter can see.

**The editor surface (the flagship — no RTL language server exists anywhere):**
- **New `miraat-lsp` binary** — a Language Server (LSP over stdio) that gives **live RTL diagnostics as you type** and **quick-fixes**, lighting up VS Code, Cursor, Windsurf, Neovim and JetBrains from one server. It runs the same pipeline as the CLI, so `miraat.config.json` severities and `miraat-disable` directives are honoured in-editor too. Code actions: a per-finding token fix and a whole-file "fix all safe RTL issues" (AST-safe). `npx -p miraat miraat-lsp`.

**CI reporters (surface findings where the team already looks):**
- **`--format github`** emits workflow-command annotations that render inline on the PR diff (`::error`/`::warning` by governed severity; the step's exit code still gates).
- **`--format gitlab-codequality`** emits a GitLab Code Quality JSON artifact (sha1 fingerprints, `major`/`minor` severity) and **`--format junit`** emits JUnit XML most CI dashboards ingest — both exit 0 as report artifacts.
- **`--cache`** skips the expensive AST re-parse for files whose content is byte-identical to the last run (sha1-keyed `.miraatcache`, invalidated on version change; report runs only, never `--fix`). Gitignore it.

## 0.10.0
- **Hardened for untrusted repos.** The tree walk now **never follows symlinks** (`lstatSync` + skip — no loops, no traversal outside the target), caps depth (40) and file count (20k), and the scanner **skips files > 2 MB** (no OOM on a pathological file). Safe to `npx` on any repo or run in CI on a PR from a fork.
- **RTL Score badge** — `npx miraat . --badge > rtl-score.svg` emits a shields-style SVG (score + grade, colored A→F). Drop it in a README to advertise RTL correctness — a distributed billboard for the metric.
- **One `miraat`, every rule-pack.** New subcommands dispatch to the sibling tools so the whole suite is one command + one install: `miraat type .` (kashida — Arabic typography), `miraat i18n .` (lahja — hardcoded strings / catalog), `miraat a11y .` / `miraat dga .` (daleel — DGA Platforms-Code + WCAG), and `miraat all .` (every pack, sequential). The bare `miraat .` RTL scan is unchanged (145 tests still green).
- Packs are **optionalDependencies** — each pack lazy-resolves (installed dep → local sibling); if a pack isn't present, `miraat` prints a one-line `npm i -D <pack>` hint and never crashes. Base install stays lean.
- Each pack keeps its own tested core (no core-merge) — see `CONSOLIDATION-PLAN.md`. mizan (the AI-tool benchmark) stays a separate package by design.

## 0.9.0
- **The single RTL Score** — `miraat --score` prints one 0–100 number + letter grade (`--json` for the raw data). Bounded to [0,100], monotone (more defects never scores higher), surface-normalized, and flags weigh 2× fixes. This is the badge-/marketing-facing metric and the number shown on the Arabic/RTL UI Kit's correctness report.
- **SARIF output** — `miraat --sarif` emits valid SARIF 2.1.0 (10-rule catalog; fix→note, flag→warning), wired into `action.yml` (`sarif: true` + `sarif-file`) so RTL findings surface as inline GitHub code-scanning / PR annotations. Gating behaviour unchanged (additive).
- **Fix (false positive):** CSS `[dir="rtl"]` / `:root[dir="rtl"]` attribute selectors and `direction: ltr|rtl` declarations — the canonical way to author direction-aware styles — are no longer flagged as "hard-coded direction." The hard-coded-`dir` pass is markup/JS-only (element attributes and `element.dir` assignments); CSS is exempt. New regression corpus locks `:root[dir="rtl"]` and `.num { unicode-bidi: isolate; direction: ltr }` (the "numbers stay LTR" pattern) as clean. *(Buyers of the UI kit run `npx miraat .` — this keeps that run at 0 findings on correct RTL CSS.)*
- **Pre-commit** — ships `.pre-commit-hooks.yaml` (pre-commit.com) + a husky/lint-staged recipe in the README.
- **Companion packages** — `eslint-plugin-miraat` (rule `miraat/rtl`, flat + legacy configs) and `stylelint-plugin-miraat` (CSS/SCSS/LESS), each wrapping the real scanner so the ESLint/Stylelint install bases become adoption channels.
- Keywords: `linter`, `sarif`.

## 0.5.0
- **Rebrand: rtlint → miraat** (مرآة, "mirror"). The package is now `miraat`; the CLI is `miraat` and the MCP server is `miraat-mcp`. Backwards-compatible aliases are kept everywhere: the `rtlint` / `rtlint-mcp` bins still work, the MCP tools answer to `miraat_scan` / `miraat_check_code` **and** the `rtlint_*` / legacy `rtl_*` names, and `rtlint` stays an npm keyword. Repo, docs and funding now point at `github.com/Otto-OttoSpace/miraat` (site stays `rtl.ottospace.co`).
- **All RTL scripts, not just Arabic.** A Unicode scripts table (`lib/scripts.js`, shared with arabitype) now drives detection so physical→logical, `dir` handling and mirrored-icon flags apply to every right-to-left script — Arabic, Hebrew, Syriac, Thaana, N'Ko, Adlam.
- **Numeral check is now script-correct.** Western-digits-in-RTL flags only fire for scripts that carry their own numerals (Arabic, Thaana, N'Ko, Adlam); Hebrew and Syriac use Western digits and are never falsely flagged. The AST-verified surgical-splice safety gate is unchanged — only mechanically-safe edits auto-apply.
- New regression corpus cases for Hebrew and Syriac snippets (physical→logical + dir + icon fire; digits correctly left alone).

## 0.4.0
- **AST-verified engine** — JS/TS/JSX/TSX now parsed with Babel, CSS with PostCSS. Fixes are surgical splices into the original source, so formatting is byte-preserved and re-running `--fix` is a guaranteed no-op. No more regex-over-raw-text corruption.
- **Zero-corruption guarantees**: custom class names (`left-sidebar`, `pl-PL`), CSS selectors/comments/custom-properties, and JS identifiers/params/types are never rewritten. Tailwind mapping is value-validated.
- **Detects classes inside `cn()` / `clsx()` / `cva()` / `classnames()` / `tw` and `cva` variant objects**, not just literal `class`/`className`.
- **New:** Western-numerals-in-Arabic detector (flag) — ASCII digits inside Arabic-script text or `lang="ar"`/`dir="rtl"` elements.
- Broader directional-icon detection (`BsChevronLeft`, `ArrowLeftIcon`, `MdKeyboardArrowRight`, `ChevronsLeft`, …) and hard-coded direction detection (`dir={"ltr"}`, `direction:"ltr"`, `setAttribute('dir','ltr')`, and `"rtl"`).
- Font-stack flag now allowlists Arabic families (no false positive on `Inter, Cairo`).
- New flags: `--check` (CI: exit non-zero on any finding) and `--dry-run` (preview without writing).
- Correct per-occurrence line numbers for duplicated lines.
- Unified version across CLI, MCP and package. Adds `@babel/parser`, `@babel/traverse`, `postcss` (correctness over the old zero-dep badge).
- Regression corpus under `test/corpus/` + `node --test` runner wired into CI (asserts scan JSON and byte-exact `--fix`).

## 0.3.0
- **MCP server** (`mcp/rtlint-mcp.js`) — agents can call `rtl_scan` / `rtl_check_code` over the Model Context Protocol.
- **GitHub Action** (`action.yml`) — drop-in RTL check for CI.
- `llms.txt`, benchmark scaffold, repo hygiene (LICENSE, CONTRIBUTING, SECURITY, FUNDING).

## 0.2.0
- Auto-fix **JS inline styles** (`marginLeft` → `marginInlineStart`, `textAlign: 'left'` → `'start'`).
- More Tailwind: `scroll-*`, `float`, `clear`. CSS: `float` / `clear`.
- Added `--json` and `--help`.

## 0.1.0
- First release: scan React/Next/Tailwind/CSS, auto-fix physical → logical, flag the rest, `--init-rules`.
