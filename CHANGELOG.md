# Changelog

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
