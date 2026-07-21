# Contributing to rtlint

Thanks for helping make the AI-built web work in Arabic.

- **Report a missed pattern** — open an issue with a small before/after snippet. The most useful contributions are real RTL bugs AI tools produce that rtlint doesn't yet catch.
- **Add a fix or a flag** — rules live in `bin/rtlint.js` (`mapTailwindToken`, `CSS_RULES`, `JS_RULES`, `FLAGS`). Keep auto-fixes strictly mechanical (physical → logical); anything needing judgment stays a **flag**.
- **Run it** — `node bin/rtlint.js test/fixtures` should report the seeded bugs; `--fix` on a copy should leave zero fixables.
- Zero runtime dependencies is a feature — please keep it that way.

MIT licensed. Be kind.
