---
title: "The 12 RTL bugs AI code tools make (and how to catch them)"
description: "A field guide to the right-to-left mistakes v0, Cursor, Claude and Copilot introduce in Arabic UI — grouped, explained, and mostly auto-fixable."
tags: [react, nextjs, tailwindcss, i18n, webdev, ai]
date: 2026-07-21
---

# The 12 RTL bugs AI code tools make (and how to catch them)

AI writes a lot of UI now, and it's genuinely good — until you ask for Arabic. Then it hands you code that looks perfect in English and is quietly wrong the moment a right-to-left user opens it. Here are the twelve mistakes I see over and over, grouped by how you catch them. The first eight are mechanical (a tool can fix them). The last four need a human who reads the language — which is exactly the part that stays valuable.

## Auto-fixable (a codemod handles these)

**1. `text-align: left` / `text-align: right`** — should be `start` / `end`.
**2. `margin-left` / `margin-right`** — should be `margin-inline-start` / `margin-inline-end`.
**3. `padding-left` / `padding-right`** — should be `padding-inline-start` / `end`.
**4. `border-left` / `border-right`** — should be `border-inline-start` / `end`.
**5. Tailwind spacing: `ml-*` `mr-*` `pl-*` `pr-*`** — should be `ms-*` `me-*` `ps-*` `pe-*`.
**6. Tailwind position: `left-*` `right-*`** — should be `start-*` `end-*`.
**7. Tailwind `text-left` / `text-right`** — should be `text-start` / `text-end`.
**8. Tailwind `rounded-l/r`, `border-l/r`** — should be `rounded-s/e`, `border-s/e`.

Every one of these is the same root mistake: **physical direction ("left"/"right") instead of logical direction ("start"/"end").** Logical properties flip automatically with the document direction; physical ones don't. This single idea kills ~80% of RTL bugs, and it's a mechanical rewrite — which is why `rtlint --fix` just does it for you.

## Flags — need a human who reads Arabic

**9. Hard-coded `dir="ltr"`.** The direction gets baked in instead of derived from the locale. No amount of correct CSS survives a document pointed the wrong way. Make it `dir={locale.dir}`.

**10. Un-mirrored directional icons.** A back-chevron points left; in Arabic "back" is right. Directional icons (chevrons, arrows, next/prev) must mirror — but non-directional ones (a checkmark, a magnifier, a user) must **not**. A regex can flag `ChevronLeft`; only a person can decide which icons actually carry direction.

**11. Latin-only typography.** `font-family: Inter` with no Arabic fallback renders Arabic in an ugly default at the wrong size. Arabic is a connected, diacritic-bearing script: it needs its own font, a larger minimum size, and more line-height. Choosing a fallback that *pairs* with your Latin face is taste, not lint.

**12. Locale-blind content.** Latin numerals where Arabic-Indic are expected, LTR-formatted dates and currency, and bidi-mixed strings (Arabic with an embedded English brand name) that scramble without `<bdi>`. Getting this right is cultural knowledge, not a rule.

## Why AI does all twelve

The training data is overwhelmingly left-to-right and English-first. "Left" and "right" appear in millions of CSS examples; logical properties appear far less, and correct *Arabic* UI barely at all. The model reproduces what it saw. RTL is a long-tail case — and long-tail is where AI codegen quietly fails.

Which is the opportunity: as AI ships more interfaces, the number of broken-Arabic screens goes **up**. The people who can fix them well stay rare.

## Catch them in one command

```bash
npx rtlint .          # scan and report all 12
npx rtlint . --fix    # auto-fix #1–8, flag #9–12
npx rtlint . --init-rules   # write an AI-rules file so your agent stops
```

The mechanical half is free now (shadcn and Tailwind ship logical utilities; `rtlint` rewrites the rest). The half that makes Arabic actually *feel* right — icons, type, bidi, culture — can't be faked by a model in a language it doesn't speak. That gap is the whole point, and it's getting more valuable, not less.

`rtlint` is free and open source, and it's the first piece of a handbook: *Arabic-RTL for the AI era.*
