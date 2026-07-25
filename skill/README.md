# Miraat — Claude Skill + MCP server

Two ways to give your AI agent RTL/Arabic superpowers.

## 1. Claude Skill (`rtl-arabic`)
A skill that makes Claude Code / Claude check + fix RTL/Arabic bugs and follow the rules automatically.

**Install:**
```bash
mkdir -p ~/.claude/skills
cp -r skill/rtl-arabic ~/.claude/skills/rtl-arabic
```
Claude will auto-invoke it whenever you work on Arabic/Hebrew/RTL UI, or you can call `/rtl-arabic`.

## 2. MCP server
Miraat ships an MCP server (`mcp/miraat-mcp.js`) exposing `miraat_scan` and `miraat_check_code`, so any MCP-capable agent (Claude Desktop, Cursor, etc.) can call it during code generation.

**Add to Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "miraat": { "command": "node", "args": ["/absolute/path/to/miraat/mcp/miraat-mcp.js"] }
  }
}
```
Or from anywhere: `npx github:Otto-OttoSpace/miraat` and point your agent at the `miraat-mcp` bin.

Sibling tools ship their own MCP servers too: `kashida-mcp`, `lahja-mcp`, `daleel-mcp`.

— Part of the Otto suite · github.com/Otto-OttoSpace · MIT
