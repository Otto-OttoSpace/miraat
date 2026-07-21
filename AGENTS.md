# AGENTS.md — RTL/Arabic rules for AI agents

Any agent editing UI in this repo (Claude, Cursor, Copilot) must follow these so Arabic / right-to-left renders correctly:

1. **Logical CSS only** — `margin-inline-start/end`, `padding-inline-start/end`, `inset-inline-start/end`, `border-inline-start/end`, `text-align: start/end`. Never `left`/`right`.
2. **Logical Tailwind only** — `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-s/rounded-e/border-s/border-e`. Never `ml/mr/pl/pr/left/right/text-left/text-right/rounded-l/rounded-r/border-l/border-r`.
3. **Dynamic direction** — `<html dir={locale.dir}>`, never hard-coded `dir="ltr"`.
4. **Mirror directional icons** (chevrons/arrows) for RTL; never mirror non-directional icons.
5. **Arabic font + scale** — Arabic-capable font with fallback, body ≥ 16px, line-height ≥ 1.5.
6. **Locale content** — Arabic-Indic numerals, locale date/currency, `<bdi>` around bidi-mixed strings.

Run `npx rtlint . --fix` before finishing.
