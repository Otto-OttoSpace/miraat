# Miraat (مرآة)

**Find & fix the RTL mistakes AI code tools keep making — for every right-to-left script.**

> Formerly **rtlint**. *Miraat* (مرآة) is Arabic for "mirror" — mirroring left↔right is the whole job. The `rtlint` command and the `rtlint_*` MCP tools still work as aliases.

AI now writes most of the UI code in the world — and it is quietly, consistently *bad* at right-to-left. It reaches for `ml-4`, `text-left`, `padding-right`, hard-codes `dir="ltr"`, and never mirrors an icon. It looks fine in English and breaks the moment a real **Arabic, Hebrew, Syriac, Thaana, N'Ko or Adlam** user opens it.

`miraat` scans your React / Next / Tailwind / CSS, **auto-fixes the mechanical RTL mistakes**, flags the ones that need a human eye, and writes an **AI-rules file** so your agent (Cursor, Claude, Copilot) stops reintroducing them. It's script-aware: physical→logical, `dir` and mirrored-icon guidance fire for **all** RTL scripts, while script-specific checks (like Western digits in a native-numeral script) fire only where they're actually wrong — Arabic/Thaana/N'Ko/Adlam carry their own numerals; Hebrew and Syriac use Western digits, so those are never falsely flagged.

```bash
npx miraat .            # scan and report
npx miraat . --fix      # apply the safe fixes (physical → logical)
npx miraat . --check    # report only, exit non-zero if anything is found (CI)
npx miraat . --dry-run  # show what --fix would change, but write nothing
npx miraat . --init-rules   # write RTL-RULES.md for your AI agent
```

> Runs straight from the repo, no install: `npx github:Otto-OttoSpace/miraat . --fix`

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

Tools: **`miraat_scan`** (scan a path) and **`miraat_check_code`** (send a snippet → get the fixed code back). The `rtlint_*` and legacy `rtl_*` tool names still resolve to the same handlers.

## Use it in CI (GitHub Action)

```yaml
- uses: Otto-OttoSpace/miraat@main
  with:
    path: .
    # fix: true   # optionally apply fixes
```

## Roadmap → Miraat Pro

- **Hosted audit** — paste a repo or URL, get a full Arabic-RTL report + fixes (a designer-in-the-loop pass, not just the mechanical ones).
- **CI GitHub Action** — fail the PR when new physical RTL bugs land.
- **Arabic design layer** — drop-in typography / font-pairing / numeral / bidi tokens that are actually correct.

## Author

Built by an **Arabic-RTL Design Engineer** — Western-quality product design + RTL-correct code, in Arabic, French & English. The free handbook *"Arabic-RTL for the AI era"* is the companion to this tool.

MIT © 2026
