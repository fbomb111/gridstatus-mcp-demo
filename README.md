# GridStatus MCP Demo

A Model Context Protocol (MCP) server that provides real-time California electricity grid data to Claude Desktop. Built as a comprehensive showcase of MCP protocol primitives.

## Architecture

```
backend/          Azure Function App — REST API for grid data
  routes/         Market snapshot, price analysis, AI explanation endpoints
  services/       gridstatus SDK, weather, baselines, OpenAI, caching

mcp-server/       MCP server (TypeScript) — bridges Claude Desktop ↔ API
  src/index.ts    stdio transport (Claude Desktop)
  src/http.ts     Streamable HTTP transport (port 3000)
  start.sh        Auto-update wrapper for Claude Desktop
```

## Prerequisites

- Node.js 18+
- Python 3.11+
- Azure Functions Core Tools (`func`)
- A gridstatus.io API key
- Azure OpenAI endpoint (for the explain tool)

## Setup

### 1. Backend (Azure Function App)

```bash
cd backend
cp local.settings.example.json local.settings.json
# Fill in GRIDSTATUS_API_KEY, AZURE_OPENAI_ENDPOINT, etc.
pip install -r requirements.txt
func start
```

The API runs at `http://localhost:7071/api`.

### 2. MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### 3. Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gridstatus": {
      "command": "/absolute/path/to/gridstatus-demo/mcp-server/start.sh"
    }
  }
}
```

The `start.sh` wrapper auto-pulls and rebuilds on every Claude Desktop connect, so you never need to manually rebuild after pushing changes.

Restart Claude Desktop after editing the config.

## Demo Script

### 1. Resources (App-Controlled Context)

Click the "+" icon in Claude Desktop → Connectors → gridstatus to see:
- **CAISO Grid Overview** — static reference data (price patterns, trading hubs, grid facts)
- **CAISO Live Conditions** — fetches live snapshot from the API

Attach either resource to your conversation for context before asking questions.

### 2. Prompts (User-Controlled Templates)

In the "+" menu, look for prompt templates:

**Grid Briefing** (no args):
> Click it. Claude receives a pre-structured request to get the snapshot, check if price is unusual, and explain if needed. It chains all 3 tools automatically.

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

**Cross-tool chaining:**
> "Give me a full grid analysis"

Claude calls multiple tools because descriptions cross-reference each other (e.g., "If price looks high, follow up with is_price_unusual").

### 4. Logging

Check the MCP server logs:
```
~/Library/Logs/Claude/mcp-server-gridstatus.log
```

### 5. Progress Notifications

`explain_grid_conditions` sends progress notifications at each of 5 stages. Claude Desktop doesn't display these yet, but they're protocol-correct and visible in MCP Inspector.

### 6. Tool Annotations

All tools declare `readOnlyHint: true` and `openWorldHint: true` — safe (read-only) but making external network calls. Visible in `tools/list` response.

### 7. Dynamic Tool Registration

On startup, only 2 tools are available. After 5 seconds, `explain_grid_conditions` registers and `tools/list_changed` fires. This simulates premium feature unlocking or lazy loading.

### 8. Completions

The resource template `gridstatus://{iso}/conditions` supports autocomplete on `iso`, returning `["CAISO"]`.

### 9. HTTP Transport

```bash
cd mcp-server && npm run start:http

curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

Same tools, resources, and prompts over HTTP instead of stdio.

## MCP Capability Coverage

| Capability | Implementation | Status |
|------------|---------------|--------|
| Tools | 3 tools: no AI → baselines → LLM synthesis | Working |
| Resources | Static overview + live dynamic template | Working |
| Prompts | Zero-arg briefing + parameterized investigation | Working |
| Logging | Info/error messages during tool execution | Working |
| Progress | 5-stage notifications on explain tool | Sent (host doesn't display yet) |
| Annotations | readOnlyHint + openWorldHint on all tools | Working |
| Completions | Autocomplete for resource template variables | Working |
| Notifications | Delayed tool registration + list_changed | Working |
| Transport: stdio | Claude Desktop entry point | Working |
| Transport: HTTP | Streamable HTTP on port 3000 | Working |
| Sampling | Server → client LLM request | Skipped (requires client support) |
| Elicitation | Server → user input request | Skipped (2025-06-18 spec) |
| Roots | Filesystem boundaries | Skipped (not relevant for grid data) |
| Tasks | Durable execution | Skipped (no client support yet) |
