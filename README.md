# rtlint

**Find & fix the RTL/Arabic mistakes AI code tools keep making.**

AI now writes most of the UI code in the world — and it is quietly, consistently *bad* at Arabic and right-to-left. It reaches for `ml-4`, `text-left`, `padding-right`, hard-codes `dir="ltr"`, and never mirrors an icon. It looks fine in English and breaks the moment a real Arabic user opens it.

`rtlint` scans your React / Next / Tailwind / CSS, **auto-fixes the mechanical RTL mistakes**, flags the ones that need a human eye, and writes an **AI-rules file** so your agent (Cursor, Claude, Copilot) stops reintroducing them.

```bash
npx rtlint .            # scan and report
npx rtlint . --fix      # apply the safe fixes (physical → logical)
npx rtlint . --check    # report only, exit non-zero if anything is found (CI)
npx rtlint . --dry-run  # show what --fix would change, but write nothing
npx rtlint . --init-rules   # write RTL-RULES.md for your AI agent
```

> Runs straight from the repo, no install: `npx github:moradothmanepro-OTTO/rtlint . --fix`

## Zero-corruption by design

rtlint parses your code with a real **AST** (Babel for JS/TS/JSX/TSX, PostCSS for CSS) — it does **not** regex over raw text. Only high-confidence, mechanically-safe edits are auto-applied, and they're written as surgical splices into the original source, so formatting is preserved to the byte. Custom class names (`left-sidebar`, `pl-PL`), CSS selectors/comments/custom-properties, and JS identifiers/params/types that merely *look* physical are **never** touched. Everything ambiguous is reported, never rewritten. Re-running `--fix` is always a no-op.

## What it catches

| # | Pattern | rtlint |
|---|---------|--------|
| 1 | Physical CSS (`margin-left`, `padding-right`, `border-left`, `text-align: left`) | **auto-fix → logical** (`margin-inline-start`, …) |
| 2 | Physical Tailwind (`ml-`, `pr-`, `left-`, `text-right`, `rounded-l`, `border-r`) — incl. inside `cn()`/`clsx()`/`cva()` | **auto-fix → logical** (`ms-`, `pe-`, `start-`, `text-end`, `rounded-s`, `border-e`) |
| 3 | Hard-coded `dir="ltr"` / `dir={"ltr"}` / `direction: "ltr"` / `setAttribute('dir','ltr')` (and `"rtl"`) | flag — make it dynamic |
| 4 | Un-mirrored directional icons (`ChevronLeft`, `BsChevronLeft`, `ArrowLeftIcon`, `MdKeyboardArrowRight`, …) | flag — mirror for RTL |
| 5 | Inline JS physical styles (`marginLeft`, `textAlign: 'left'`, `el.style.marginLeft = …`) | **auto-fix → logical** |
| 6 | Latin-only font stacks (no Arabic fallback) | flag — add an Arabic font |
| 7 | Western numerals inside Arabic text (`السعر 1234 درهم`) | flag — use Arabic-Indic / locale-aware numerals |

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

The mechanical half of RTL — logical properties, mirrored utilities — is now commodity (shadcn and Tailwind ship it). **rtlint gives you that for free.** But the half that actually makes Arabic *feel right* — mirroring the correct icons, Arabic typographic scale and font pairing, bidi edge-cases, Arabic-Indic numerals, cultural correctness — takes native judgment. rtlint flags those; it doesn't guess. That judgment is a service, not a regex — see the roadmap.

## Use it in your AI agent (MCP)

rtlint ships an **MCP server**, so Cursor / Claude / Windsurf can call it *while they write code* — the bug never ships:

```json
{
  "mcpServers": {
    "rtlint": { "command": "npx", "args": ["-y", "-p", "github:moradothmanepro-OTTO/rtlint", "rtlint-mcp"] }
  }
}
```

Tools: **`rtl_scan`** (scan a path) and **`rtl_check_code`** (send a snippet → get the fixed code back).

## Use it in CI (GitHub Action)

```yaml
- uses: moradothmanepro-OTTO/rtlint@main
  with:
    path: .
    # fix: true   # optionally apply fixes
```

## Roadmap → rtlint Pro

- **Hosted audit** — paste a repo or URL, get a full Arabic-RTL report + fixes (a designer-in-the-loop pass, not just the mechanical ones).
- **CI GitHub Action** — fail the PR when new physical RTL bugs land.
- **Arabic design layer** — drop-in typography / font-pairing / numeral / bidi tokens that are actually correct.

## Author

Built by an **Arabic-RTL Design Engineer** — Western-quality product design + RTL-correct code, in Arabic, French & English. The free handbook *"Arabic-RTL for the AI era"* is the companion to this tool.

MIT © 2026
