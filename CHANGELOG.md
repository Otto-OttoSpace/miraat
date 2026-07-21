# Changelog

## 0.3.0
- **MCP server** (`mcp/rtlint-mcp.js`) — agents can call `rtl_scan` / `rtl_check_code` over the Model Context Protocol.
- **GitHub Action** (`action.yml`) — drop-in RTL check for CI.
- `llms.txt`, benchmark scaffold, repo hygiene (LICENSE, CONTRIBUTING, SECURITY, FUNDING).

## 0.2.0
- Auto-fix **JS inline styles** (`marginLeft` → `marginInlineStart`, `textAlign: 'left'` → `'start'`).
- More Tailwind: `scroll-*`, `float`, `clear`. CSS: `float` / `clear`.
- Added `--json` and `--help`.

## 0.1.0
- First release: scan React/Next/Tailwind/CSS, auto-fix physical → logical, flag the rest, `--init-rules`.
