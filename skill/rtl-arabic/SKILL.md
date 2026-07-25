---
name: rtl-arabic
description: Check and auto-fix right-to-left / Arabic bugs — physical CSS, mirrored icons, severed cursive joins, per-character-split text, missing Arabic fonts, untranslated strings — using the open-source Miraat/Otto suite. Use whenever building, reviewing, or fixing Arabic, Hebrew, or any RTL/bidi UI, or when the user mentions RTL, Arabic, bidi, i18n, or "the Arabic looks broken."
---

# RTL / Arabic correctness (Miraat + the Otto suite)

AI codegen defaults to Latin, left-to-right assumptions and systematically breaks right-to-left scripts. When the user is building, reviewing, or fixing RTL/Arabic UI, use these open-source tools (MIT, github.com/Otto-OttoSpace) to catch and fix it.

## Commands
- **Check a repo/path:** `npx github:Otto-OttoSpace/miraat <path>`
- **Auto-fix mechanical RTL bugs** (physical→logical CSS, etc.): `npx github:Otto-OttoSpace/miraat <path> --fix`
- **Prove a font actually renders Arabic** (no tofu ▯, real cursive joins): `npx github:Otto-OttoSpace/kashida <path> --render`
- **Audit a LIVE page's Arabic:** `npx github:Otto-OttoSpace/kashida --url <url> --render`
- **Catch untranslated strings (any script):** `npx github:Otto-OttoSpace/lahja <path>`
- **Saudi DGA compliance gate:** `npx github:Otto-OttoSpace/daleel <path>`

Miraat is AST-verified: only high-confidence edits auto-apply; ambiguous cases are flagged, never silently changed.

## Hard rules — never violate when writing RTL/Arabic UI
1. **Logical CSS only** — `margin-inline-start` not `margin-left`; `padding-inline-end` not `padding-right`; `inset-inline-start` not `left`; `text-align: start/end` not `left/right`.
2. **Never letter-space/word-space cursive scripts** (Arabic, Syriac, Thaana, N'Ko…) — it severs the joins. (Non-cursive RTL like Hebrew is fine.)
3. **Never split cursive text into per-character elements** (e.g. GSAP SplitText `type:'chars'`, `.split('')` → spans). Letters can't join across element boundaries. Split by word or line, or exclude RTL text from per-character animation.
4. **Load a real Arabic font** (IBM Plex Sans Arabic / Cairo / Noto Naskh Arabic) — a Latin-only stack renders tofu (▯) or forced-Latin fallback. Don't disable `calt`/`liga` on Arabic.
5. **Mirror directional icons** (chevron/arrow) for RTL; set `dir="rtl"` + `lang` on the container (or `dir` from the locale).
6. **Arabic-Indic numerals / locale-aware formatting** in Arabic contexts; `Intl.Segmenter` for word/line breaks in no-space scripts (Thai/Khmer/CJK).

After any RTL change, run `miraat <path> --fix` and confirm **zero findings**.
