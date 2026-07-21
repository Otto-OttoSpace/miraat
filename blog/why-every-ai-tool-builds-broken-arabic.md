---
title: "Why every AI coding tool builds broken Arabic (and the 6 fixes)"
description: "AI writes most of our UI now — and it's quietly, consistently wrong about right-to-left. Here are the six mistakes it makes every time, why, and how to fix them automatically."
tags: [rtl, arabic, i18n, tailwind, ai]
date: 2026-07-21
---

# Why every AI coding tool builds broken Arabic (and the 6 fixes)

Ask v0, Cursor, Claude, or Copilot to build you a UI and it will be *good*. Ask it to make that UI work in Arabic and it will confidently hand you something broken — and it won't tell you, because in English everything looks fine.

I'm a native Arabic speaker who designs and codes. I see the same six mistakes every single time. None of them are hard. All of them are invisible until a right-to-left user opens the screen and the whole layout is subtly, then obviously, wrong.

Here they are, why the models do it, and how to stop it.

## The six mistakes

**1. Physical properties instead of logical ones.** The model writes `margin-left`, `padding-right`, `text-align: left`, `border-left`. In an RTL layout, "left" is the *wrong side*. The fix is CSS logical properties: `margin-inline-start`, `padding-inline-end`, `text-align: start`, `border-inline-start`. They flip automatically with direction. One rule kills most RTL bugs.

**2. Physical Tailwind utilities.** Same mistake, Tailwind flavour: `ml-4`, `pr-2`, `text-right`, `left-0`, `rounded-l-lg`, `border-r`. Tailwind has logical equivalents — `ms-4`, `pe-2`, `text-end`, `start-0`, `rounded-s-lg`, `border-e` — and they've been there since v3.3. The model just doesn't reach for them, because almost none of its training data does.

**3. Hard-coded `dir="ltr"`.** Direction gets baked in instead of derived from the locale (`dir={locale.dir}`). Now no amount of correct CSS saves you — the document itself is pointed the wrong way.

**4. Un-mirrored directional icons.** A back-chevron points left. In Arabic, "back" is to the right. The model drops `<ChevronLeft/>` and moves on. Icons that imply direction have to mirror; icons that don't (a checkmark, a user) must *not*. That's a judgment call, every time.

**5. Latin-only typography.** `font-family: Inter` with no Arabic fallback. Arabic then renders in some ugly system default, at the wrong size, with the wrong line-height. Arabic needs its own font stack, a larger minimum size, and more line spacing — it's a cursive script with diacritics, not Latin with different glyphs.

**6. Locale-blind content.** Latin numerals where Arabic-Indic are expected, LTR-formatted dates and currency, and bidi-mixed strings (an Arabic sentence with an English brand name in it) that scramble without a `<bdi>` wrapper.

## Why the models do this

It's not a mystery: the training data is overwhelmingly left-to-right and English-first. "Left" and "right" appear millions of times in CSS the model has read; logical properties appear far less often, and correct *Arabic* UI barely at all. The model is doing exactly what it was shown. RTL is a long-tail case, and long-tail cases are where AI codegen quietly fails.

Which is the opportunity. As AI writes more of the world's interfaces, the number of broken-Arabic screens goes *up*, not down — and the people who can fix them well stay rare.

## The fix, automated

The mechanical half — mistakes 1 and 2 — is a codemod. So I wrote one:

```bash
npx rtlint .          # scan and report
npx rtlint . --fix    # rewrite physical → logical, safely
npx rtlint . --init-rules   # write an AI-rules file so your agent stops doing it
```

It rewrites physical CSS and Tailwind to logical, and — this is the part that keeps it from happening again — it drops a `RTL-RULES.md` you point Cursor or Claude at, so the agent stops reintroducing the bugs on the next prompt.

It does **not** auto-fix mistakes 3–6. It flags them. Mirroring the *right* icons, choosing an Arabic font that actually pairs with your Latin one, handling bidi, getting the numerals and the cultural details right — that's native judgment, not a regex, and pretending otherwise is how you ship Arabic that's technically valid and still feels wrong.

## The bigger point

Shadcn now ships RTL docs; Tailwind has logical utilities. The mechanical layer of RTL is becoming free. Good. That was never the hard part. The hard part is the taste — and taste in a language you don't speak can't be faked by a model or a tool. That gap is going to get more valuable, not less.

`rtlint` is free and open source. It's the first piece of a handbook I'm writing — *Arabic-RTL for the AI era* — for everyone shipping Arabic product in an AI-native workflow.

If AI built your Arabic UI, run `rtlint` on it. I promise you it's not clean.
