# rtlint — launch playbook (verified 2026-07-21)

**Strategic key:** the product's premise IS its distribution. Put rtlint *where the AI writes the code* (Cursor rules, MCP, CI) and ride the "AI gets Arabic wrong" story. Don't bet on docs-SEO (dying — devs ask ChatGPT/Claude now). Two audiences: **devs** = stars/users (don't pay), **buyers** = agencies/SaaS/gaming (pay for audits). Run both.

## Do-this-week order
1. **Polish README + a 15-sec terminal GIF** (broken Arabic → `rtlint --fix` → fixed) + repo topics. Visitors decide to star within one screen.
2. **Ship the Cursor rule** — `.cursor/rules/rtl.mdc` is in this repo. List it on **cursor.directory** + PR it into **PatrickJS/awesome-cursorrules**. (Lowest effort, immediate, compounding.)
3. **Write the dev.to post** — "The 12 RTL bugs AI code tools make (and how to catch them)" (draft in `blog/`). Tags: react, nextjs, tailwindcss, i18n, webdev, ai. Canonical = repo. Cross-post Hashnode.
4. **Show HN** (your #1 spike) — see template below. Best window for you: **Sunday ~00:00–01:00 PT** (lower competition = your night hours) or Tue–Thu 8–10am ET.
5. **Reddit Showoff + Peerlist Launchpad** the same week (reuse the GIF/writeup).
6. **Send 10 proof-first audit DMs** to category-1 agencies (below).

## Show HN
- **Title (flat, no superlatives — HN punishes hype):**
  `Show HN: rtlint – Find and auto-fix RTL/Arabic bugs AI code tools introduce`
- **First comment (post it yourself, immediately):** who you are (trilingual AR/FR/EN designer-who-codes in Montreal), one line on what it does, the problem (AI writes `ml-4`/`text-left`/hard-coded LTR that silently breaks Arabic), why you're credible, the 15-sec GIF, `free, MIT — npx rtlint`, and an invite to critique. **Then answer every comment for 3–4h** — thread-tending is what holds the front page.
- ❌ Never seed fake upvotes (HN detects rings and buries you).

## Embed where AI looks (unfair-advantage, compounding)
Ship the same rules in 4 wrappers: (1) Cursor `.mdc` → cursor.directory + awesome-cursorrules; (2) **MCP server** → list on mcp.so, smithery.ai, glama.ai/mcp, punkpeye/awesome-mcp-servers; (3) **ESLint plugin + Biome rule** (piggyback every repo's CI); (4) **GitHub Action** (`.github/workflows/ci.yml` here is the seed → a future paid CI dashboard).

## GitHub-native
README sells in the first screen + GIF. Repo **topics**: rtl, arabic, i18n, react, nextjs, tailwindcss, eslint, ai. Open PRs adding rtlint to awesome-react, awesome-nextjs, awesome-i18n. **Highest-leverage:** contribute an RTL rule upstream to eslint-plugin-jsx-a11y / Tailwind / Biome — an accepted PR brands you as *the* RTL person.

## MENA / Arabic communities (arrive with proof, not a pitch)
Design/type: **Nuqta** (nuqta.com), Behance "Arabic Typography", **Khatt** (khtt.net). Dev: **Developer Arab** + **Arab Dev Hub** Discords, **Startup UAE Slack** (founders = buyers), GDG Saudi/DevFest, Apple Dev Academy @ Tuwaiq. X: build-in-public in AR + EN; the 2026 algo rewards early reply velocity (a reply from you ≈ 150× a like) and boosts external article links.

## BUYERS TRACK — the first $1k
Wedge = a **free, specific audit**, never a pitch. Show, don't sell.
**Targets (ranked by broken-Arabic likelihood × budget):**
1. ⭐ **RTL/Gulf Shopify & e-comm agencies** (recurring need, real budgets): Creative971, Titan Digital UAE, Globify, Vista by Lara, Beeps Digital.
2. **Arabic localization vendors** (nail linguistic QA, miss front-end RTL — partner, don't compete): Saudisoft, Bayantech, Arabize, Fast Trans.
3. **Gulf gaming studios/publishers**: Savvy/Nine66 portfolio, NEOM "Level Up" studios.
4. **Western SaaS that just added `/ar`** (visibly broken locale = the audit sells itself).
5. Gulf dev shops (Markup, Purrweb, Hamrix); 6. i18n SaaS (Lokalise/Crowdin/Phrase — integration angle); 7. Vision-2030 gov portals (via delivery agencies); 8. MENA fintech/super-apps; 9. component-library maintainers adding RTL; 10. Western D2C brands entering KSA/UAE (via their Gulf agency).
**Find them:** Shopify Partners + Clutch MENA; LinkedIn "Localization Manager"/"Arabic" + Saudi/UAE; GitHub code search `dir="rtl"` / `lang="ar"`; job posts hiring "Arabic localization" (= active pain + budget).
**Opening message (proof-first):**
> Subject: 7 RTL bugs on your Arabic store
> Hi [name] — I run rtlint, an open-source scanner for the RTL/Arabic mistakes AI code tools introduce. I ran it on [their Arabic page] and found [N] issues — mirrored chevrons, `text-left` on Arabic body, LTR-locked prices [1 screenshot]. Full free list + fixes: [link]. I'm a trilingual (AR/FR/EN) designer-engineer in Montreal; if a deeper RTL audit helps before [their next launch], happy to send a fixed diff — no charge for the first pass.

## Free → paid ladder (copy Semgrep)
Free CLI + handbook (forever, no account) → paid **RTL audit** (first $1k this quarter) → hosted **Pro** = GitHub App CI dashboard, per-repo/per-team + premium **rule packs / Arabic design-token sets**. The paid layer must be a *service + system* AI can't replace (not a docs paywall — that's what killed Tailwind's funnel).

## ❌ Don't over-invest
Product Hunt as the *lead* channel (crowded 6am-PT lottery — do it later for the badge). Chasing GitHub/npm "trending" (it's an output, not a channel). Lobsters (invite-gated, anti-promo). Hashnode as primary (cross-post only). Buying stars (reputation risk with the exact crowd you need).
