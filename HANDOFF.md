# rtlint — what's DONE vs. what needs YOU

Everything below the line is built and in the repo. Above the line are the things only you can do (your accounts / your click). None are urgent; do them at your pace.

## ⬜ Needs you (ranked)
1. **Make the repo public** — GitHub → rtlint → Settings → Danger Zone → Make public. *(Unblocks `npx github:...`, the landing links, and everything else.)*
2. **Launch it** — hand `LAUNCH-CHROME-PROMPT.md` to your Chrome agent: dev.to post, Show HN (be present to reply), cursor.directory listing, bio reposition.
3. **Grants = real money for what you built** — submit `grants/emergent-ventures.md` (edit to your voice) + the two in `grants/other-funding.md` (GitHub Secure OSS Fund $10k, Vercel OSS $3.6k).
4. **Money rails** — enable **GitHub Sponsors** (FUNDING.yml is ready), sign up **Polar** (polar.sh, merchant-of-record) and **thanks.dev**.
5. **Publish the MCP server** to the registry so agents can find it — registry.modelcontextprotocol.io (via `make publisher`, uses your GitHub). Also list on cursor.directory.
6. **npm (optional)** — set up a 2FA authenticator on npmjs.com, tell me, and I publish `npx rtlint`. Until then the GitHub install works.
7. **Reposition your bios** everywhere → **"Design Engineer — RTL & Arabic a11y · AR/FR/EN."**
8. **5-min money moves** (from your plan) — unclaimed-money check (ucb.bankofcanada.ca + Revenu Québec), sign up User Interviews/Respondent/Prolific/UserTesting, Prêts Québec $750/sem, email L'Archipel, verify the $75 credit.

---
## ✅ Done & in the repo (built autonomously)
- **CLI** (`bin/rtlint.js`, v0.3) — auto-fixes 16+ RTL patterns, `--fix` `--json` `--init-rules` `--help`, zero-dep, tested.
- **MCP server** (`mcp/rtlint-mcp.js`) — agents call `rtl_scan` / `rtl_check_code` in-loop. Tested end-to-end.
- **GitHub Action** (`action.yml`) — drop-in RTL check for any repo's CI.
- **Cursor rule** (`.cursor/rules/rtl.mdc`) + **AGENTS.md** + AI-rules generator.
- **Landing page** live at **rtl.qabas.gift** + `llms.txt` for agent discovery.
- **Handbook seeds** — 2 articles in `blog/`.
- **RTL benchmark** scaffold (`benchmark/`) — methodology + scorer.
- **Repo hygiene** — LICENSE (MIT), CONTRIBUTING, SECURITY, CHANGELOG, FUNDING.yml, Claude plugin manifest.
- **Grant drafts** (`grants/`) + full **launch playbook** (`LAUNCH.md`).
