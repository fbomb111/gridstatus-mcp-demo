# GridStatus MCP Demo Guide

How to exercise every MCP feature in Claude Desktop.

## Setup

1. Backend running: `cd backend && func start`
2. MCP server built: `cd mcp-server && npm run build`
3. Claude Desktop configured to use `node /path/to/mcp-server/dist/index.js`
4. Restart Claude Desktop after config changes

## Demo Script

### 1. Resources (App-Controlled Context)

Claude Desktop shows available resources in the connector menu. Click the "+" icon → Connectors → gridstatus to see:
- **CAISO Grid Overview** — static reference data (price patterns, trading hubs, grid facts)
- **CAISO Live Conditions** — fetches live snapshot from the API

Attach either resource to your conversation for context before asking questions.

### 2. Prompts (User-Controlled Templates)

In the "+" menu, look for prompt templates:

**Grid Briefing** (no args):
> Click it. Claude will receive a pre-structured request to get the snapshot, check if price is unusual, and explain if needed. It chains all 3 tools automatically.

**Investigate Price** (takes ISO arg):
> Click it, enter "CAISO". Claude follows a structured investigation: check price → if unusual, explain why → if normal, summarize conditions.

### 3. Tools (Model-Controlled)

Type these into Claude Desktop:

**Tool 1 — Market Snapshot (no AI):**
> "What's happening on the California grid right now?"

Triggers `get_market_snapshot`. Returns prices, load, generation mix, highlights.

**Tool 2 — Price Analysis (deterministic baselines):**
> "Is that price normal?"

Triggers `is_price_unusual`. Returns sigma, percentile, severity, template verdict.

**Tool 3 — AI Explanation (LLM synthesis):**
> "Why are conditions like this?"

Triggers `explain_grid_conditions`. Returns multi-paragraph analyst explanation with contributing factors.

**Cross-tool chaining (descriptions guide Claude):**
> "Give me a full grid analysis"

Claude should call multiple tools because the descriptions cross-reference each other (e.g., "If price looks high, follow up with is_price_unusual").

### 4. Logging (Utility)

Not visible in Claude Desktop UI, but check the MCP server logs:
```
~/Library/Logs/Claude/mcp-server-gridstatus.log
```
You'll see structured log messages like:
```
Fetching market snapshot for CAISO...
Market snapshot retrieved: CAISO grid at ...
```

### 5. Progress Notifications (Utility)

When `explain_grid_conditions` runs, the server sends progress notifications at each stage:
- 0/5: Fetching generation mix
- 1/5: Fetching load data
- ...
- 5/5: Complete

Claude Desktop doesn't display these yet (confirmed [GH #4157](https://github.com/anthropics/claude-code/issues/4157)), but they're protocol-correct. Visible in MCP Inspector.

### 6. Tool Annotations (Metadata)

All tools declare `readOnlyHint: true` and `openWorldHint: true`. This tells the host that tools are safe (read-only) but make external network calls. Visible in `tools/list` response.

### 7. Notifications (Dynamic Registration)

On startup, only 2 tools are available (`get_market_snapshot`, `is_price_unusual`). After 5 seconds, `explain_grid_conditions` registers and `tools/list_changed` fires.

To observe: connect to the server, immediately list tools (only 2), wait 5 seconds, list again (now 3). This simulates premium feature unlocking or lazy loading.

### 8. Completions (Autocomplete)

The dynamic resource template `gridstatus://{iso}/conditions` supports autocomplete on the `iso` variable, returning `["CAISO"]`. This helps clients offer suggestions when users type resource URIs.

### 9. HTTP Transport (Alternative Transport)

```bash
# Start HTTP transport (separate from stdio)
cd mcp-server && npm run start:http

# Test with curl
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

Same data layer (tools, resources, prompts) over HTTP instead of stdio. Demonstrates transport independence.

## MCP Capability Coverage

| Capability | Where | Status |
|------------|-------|--------|
| Tools | 3 tools with spectrum (no AI → baselines → LLM) | ✅ Working |
| Resources | Static overview + live dynamic template | ✅ Working |
| Prompts | Zero-arg briefing + parameterized investigation | ✅ Working |
| Logging | Info/error messages during tool execution | ✅ Working |
| Progress | 5-stage notifications on explain tool | ✅ Sent (host doesn't display) |
| Annotations | readOnlyHint + openWorldHint on all tools | ✅ Working |
| Completions | Autocomplete for resource template variables | ✅ Working |
| Notifications | Delayed tool registration + list_changed | ✅ Working |
| Transport: stdio | Claude Desktop entry point | ✅ Working |
| Transport: HTTP | Streamable HTTP on port 3000 | ✅ Working |
| Sampling | Server → client LLM request | ⏭ Skipped (requires client support) |
| Elicitation | Server → user input request | ⏭ Skipped (2025-06-18 spec, new) |
| Roots | Filesystem boundaries | ⏭ Skipped (not relevant for grid data) |
| Tasks | Experimental durable execution | ⏭ Skipped (no client support yet) |
