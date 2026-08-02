# Emergent Ventures — application draft
Apply at: https://www.mercatus.org/emergent-ventures  ·  (edit this into your own voice before submitting)

**Name:** Othmane Morad  ·  **Location:** Montréal, Canada  ·  **Age:** [fill]

**Your project (what you're building):**

I'm building the correctness layer for Arabic and right-to-left (RTL) interfaces in the AI-coding era. AI tools now write most of the world's UI code, and they are systematically bad at Arabic: they reach for physical CSS (`margin-left`, `text-align: left`), hard-code `dir="ltr"`, and never mirror directional icons. The result looks perfect in English and is broken the moment a right-to-left user opens it. As AI writes more interfaces, the number of quietly-broken Arabic screens goes up, not down.

I've shipped the first piece: **rtlint** (github.com/Otto-OttoSpace/rtlint, rtl.qabas.gift) — a free, open-source, zero-dependency tool that scans a codebase, auto-fixes the mechanical RTL mistakes, and flags the ones that need native judgment. It's also an MCP server, so AI agents (Cursor, Claude) can call it automatically as they write code. No RTL-specific tool of this kind exists.

**What I'd do with the grant:**

Turn rtlint from a tool into infrastructure and a body of work: (1) publish a rigorous public **benchmark** of how well each AI coding tool handles Arabic RTL — the "RTL" name is taken in hardware, so the right-to-left benchmark space is genuinely unclaimed; (2) build the paid layer (a hosted, designer-in-the-loop Arabic-RTL audit) that funds the free tool; (3) write the open handbook, *Arabic-RTL for the AI era*. The money buys me focused time (I'm a low-income student) and the credibility to reach the teams that need this — the Gulf's booming creative economy (Saudi Vision 2030, the UAE) and every Western company entering that market.

**Why me:**

I'm one of very few people who sit at the exact intersection this requires: native Arabic, a designer with Western training, someone who actually writes the code, and AI-native. Western-trained designers rarely speak Arabic; Arabic designers rarely have the Western polish and the engineering. I'm a trilingual (Arabic/French/English) immigrant who taught myself to design and code, and I can both *see* what's wrong with Arabic UI and *fix it in the codebase*. That overlap is the whole moat, and it's why a tool built by me is credible in a way a generic linter isn't.

**Why it matters beyond me:**

Hundreds of millions of people read right-to-left. As software generation gets automated, "correct for the majority language (English)" is becoming the silent default, and everyone else inherits subtly broken products. A cheap, open, agent-native way to catch and fix that — plus a public standard for what "correct" means — makes the AI-built web usable for a fifth of the planet. It also turns an under-served problem into a durable, ownable niche for someone who'd otherwise be one more junior designer competing with AI.

**Links:** github.com/Otto-OttoSpace/rtlint · rtl.qabas.gift
