# The RTL-for-AI benchmark

**How badly do AI coding tools handle Arabic / right-to-left?** This is a small, reproducible
benchmark that measures it — and the space is genuinely unclaimed (in academia "RTL" means
hardware register-transfer-level, so *right-to-left* correctness has no standard benchmark).

## Method
1. Give each AI tool (Cursor, Claude, Copilot, v0, Lovable, …) the same set of UI prompts that
   should render in Arabic — see `prompts.md` (15 prompts: a form, a card, a nav bar, a pricing
   table, an icon row, etc., each "make it work in Arabic / RTL").
2. Save each tool's output under `outputs/<tool-name>/`.
3. Score every output with rtlint: `node benchmark/score.js outputs`
   — fewer RTL issues (physical CSS/Tailwind, un-mirrored icons, hard-coded `dir`, Latin-only
   fonts) = higher score.
4. Publish the leaderboard.

## Contribute results
Run the prompts through a tool you have access to, drop the outputs in `outputs/<tool>/`, and
open a PR. rtlint is the grader, so results are objective and reproducible.

> This is a scaffold: the prompts + scorer are here; the leaderboard fills in as outputs are added.
