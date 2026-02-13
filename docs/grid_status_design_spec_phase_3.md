# Grid Status MCP Server — Phase 3: Implementation Journal

_Build process from skeleton to working E2E: Function App → gridstatus → AI → MCP → Claude Desktop._

---

## Step 1: Function App Skeleton

**Standalone project** — no shared packages from Captain AI. CrewAI is too heavy for single `chat.completions.create()` calls, and keeping the demo self-contained means the entire codebase is readable in minutes.

**Plain Function App, not Durable Functions** — request/response only, no orchestration or queues needed.

---

## Step 2: Foundry Model Client — Endpoint Discovery

The most instructive debugging of the build. Microsoft has (at least) three endpoint patterns:

| Endpoint Pattern | Purpose |
|---|---|
| `*.services.ai.azure.com/api/projects/*` | Foundry Agents API (threads, conversations) |
| `*.cognitiveservices.azure.com` | Legacy Azure Cognitive Services |
| `*.openai.azure.com/openai/v1/` | OpenAI-compatible completions |

We tried the Foundry project endpoint first (404), then cognitive services (404), before discovering the `.openai.azure.com` pattern worked. The rebranding from "Azure AI" to "Microsoft Foundry" has made documentation confusing.

**Auth:** MSI token passed as the OpenAI SDK's `api_key` parameter — no API keys stored anywhere.

---

## Step 3: gridstatus Integration

Minor hiccup: `gridstatus` has an undeclared `pytz` dependency.

The fuel mix endpoint fetches live CAISO data, converts to `{source: MW}` dict, and sends to gpt-4.1 for a 2-3 sentence analyst summary. First response showed batteries at -6,579 MW (charging during peak solar) — the model correctly identified this as the duck curve in action. Exactly the kind of insight that makes server-side AI enrichment worthwhile.

---

## Step 4: MCP Server

Deliberately minimal (~30 lines TypeScript). Registers tools, makes HTTP calls to the backend, returns responses. All intelligence lives in the backend.

Tested the full chain via stdin JSON-RPC piping: stdin → MCP server → HTTP → Function App → gridstatus → AI → response → stdout.

---

## Step 5: Claude Desktop Integration

Connection path: Claude Desktop (Mac) → MCP Server (stdio) → localhost:7071 (SSH tunnel) → Function App → gridstatus + AI.

**Key observation:** Two layers of AI work together:
- **Server-side (gpt-4.1):** Domain-specific data summary
- **Client-side (Claude):** User-facing presentation and follow-ups

This validated the Phase 1 design: server handles domain synthesis, client handles user context.

---

## Problems Hit

| Problem | Root Cause | Fix |
|---|---|---|
| `func start` uses bundled Python 3.10 | Function Core Tools ships its own Python | Recreate venv with 3.12, activate before `func start` |
| 404 on Foundry/cognitive endpoints | Wrong endpoint pattern | Use `.openai.azure.com/openai/v1/` |
| `gridstatus` import fails | Missing `pytz` dependency | `pip install pytz` |
| GitHub push rejected | PAT lacks `repo:create` | Create repo manually, push via SSH |
