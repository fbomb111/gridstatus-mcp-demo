# GridStatus Demo — Technical Interview Guide

## Elevator Pitch

GridStatus Demo is an MCP server (Model Context Protocol) that gives AI assistants like Claude Desktop structured access to US electricity grid data — real-time prices, demand, generation mix, weather overlays, and market analysis across 7 ISOs (CAISO, ERCOT, PJM, MISO, NYISO, ISONE, SPP).

The key insight: energy data is messy, multi-source, and requires domain knowledge to interpret. Rather than having an LLM try to scrape websites or hallucinate grid data, we give it tools that return clean, structured data with appropriate context.

---

## Architecture: Why Four Layers?

```
Claude Desktop → MCP Server (TypeScript) → Backend API (FastAPI) → External Sources
```

Each layer has a distinct responsibility:

1. **Claude Desktop** — The AI client. Provides the LLM reasoning, manages tool orchestration, and presents results to the user. Crucially, the user's own Claude subscription bears the token cost.

2. **MCP Server** — Protocol translation. Speaks MCP (stdio or HTTP) to Claude, speaks REST to the backend. This is the adapter that makes grid data available to any MCP-compatible AI client.

3. **Backend API** — Data orchestration. Aggregates multiple external sources (GridStatus.io API, Open-Meteo weather, EIA baselines), handles caching, error normalization, and light AI synthesis. This is reusable — a web dashboard could consume the same API.

4. **External sources** — GridStatus.io for real-time grid data, Open-Meteo for weather, EIA for historical baselines.

**The tradeoff**: More layers = more deployment complexity, but each layer is independently testable and replaceable. If GridStatus.io changes their API, only the backend service layer changes. If MCP evolves, only the MCP server changes.

---

## Where Does Synthesis Happen? (Core Design Philosophy)

The central design question is: which layer owns interpretation? The backend API can synthesize via its own LLM calls, or we can return structured data and let the user's Claude do the reasoning. This is a spectrum, and every tool in the system sits somewhere on it:

| Approach | Example | When to Use |
|----------|---------|-------------|
| **Rule-based** | `get_current_price` — fetch, format, return | Data is structured, no interpretation needed |
| **Statistical/Deterministic** | `analyze_price_trends` — compute % changes, std dev, rank ISOs | Analysis is formulaic, LLM would be slower and less accurate |
| **LLM Synthesis** | `get_market_summary` — Microsoft Foundry synthesizes a narrative from multiple data points | Need natural language interpretation combining multiple signals |

For this demo, we push most synthesis into the backend API — the `get_market_summary` endpoint calls `get_grid_status`, `get_weather`, and `get_price_baselines` internally, then sends all that structured data to Microsoft Foundry with a domain-specific prompt. The LLM never fetches data — it only interprets pre-fetched, validated data.

But the architecture supports moving that boundary. You could strip the backend down to pure data retrieval and let Claude orchestrate everything — it already has the tools. The tradeoff is control vs. flexibility: backend synthesis gives you deterministic, tested output; client-side synthesis gives you adaptive reasoning that can handle questions you didn't anticipate.

---

## OAuth 2.1: The Bridge Pattern

MCP has two transports:
- **stdio** (local) — Claude Desktop launches the MCP server as a subprocess. No auth needed, it's on your machine.
- **HTTP** (remote) — For production deployment. Now you need auth, because anyone could call your server.

The solution: a full OAuth 2.1 implementation that acts as a *bridge* between MCP's auth requirements and the backend's auth.

Key specs implemented:
- **RFC 9728** — OAuth Protected Resource Metadata (`.well-known/oauth-protected-resource`)
- **RFC 7591** — Dynamic Client Registration (clients register themselves)
- **PKCE** — Proof Key for Code Exchange (prevents authorization code interception)
- **AES-256-GCM** — Token encryption (tokens are encrypted, not just signed)

**Why build a custom OAuth server?** This was an MVP decision — and an interesting one that reflects how AI-assisted development changes the build-vs-buy calculus. With AI-driven development, building ~400 lines of custom OAuth logic was faster and cheaper than integrating a managed service like Auth0 or Azure B2C. A year ago, the opposite was true for MVPs: you'd always reach for an off-the-shelf service. Now, the speed of AI-assisted implementation tips the scale toward custom code when the scope is bounded.

**Progressive tool unlock**: Before OAuth, you get public tools (grid status, weather). After OAuth, you unlock authenticated tools (market analysis, AI synthesis). This means the server is useful immediately but more powerful with auth.

**Production considerations**: For a production deployment, the math changes. A custom OAuth server is an extra security surface to maintain, audit, and patch. You'd re-evaluate build vs. buy based on your security requirements, team capacity, and whether the managed service's cost is justified by reduced maintenance burden.

---

## Infrastructure Choices

### Azure Container Apps vs. Azure Functions

We weighed both options. Functions were a real contender — they're simpler to deploy and have built-in scaling. But Container Apps won for this use case:

- MCP HTTP transport needs **persistent connections** (SSE streaming). Functions are optimized for request-response.
- Container Apps support **scale-to-zero** (matching Functions' cost model) while maintaining WebSocket/SSE support.
- Full control over the runtime environment, startup behavior, and health probes.
- **Managed Identity** for all Azure service auth — no secrets in env vars.

### Caching (`services/cache.py`)

- In-memory TTL cache with configurable expiration per data type.
- Grid data: 5-minute TTL (balances freshness vs. API rate limits).
- Weather: 30-minute TTL (doesn't change fast).
- Why not Redis? Not necessary for MVP scope — in-memory is simpler and sufficient. For a production deployment, we'd evaluate caching strategy based on traffic patterns, scaling needs, and whether multi-instance is warranted.

### Dual Transport in One Codebase

- `src/index.ts` — stdio transport (local development, Claude Desktop)
- `src/http.ts` — HTTP+SSE transport (production, remote clients)
- Same tools, resources, and prompts shared via `src/shared/`

---

## Key Tradeoffs

1. **Hosted API vs. direct scraping**: GridStatus.io provides a hosted API for some ISOs. We use it where available (7 ISOs) and fall back to direct GridStatus library calls for real-time data (CAISO only currently). The `REALTIME_ISOS` vs `HOSTED_API_ISOS` distinction exists because expanding real-time support requires per-ISO parsing logic.

2. **Sync GridStatus library in async FastAPI**: The `gridstatus` Python library is synchronous. Rather than rewriting it, we wrap calls in `asyncio.to_thread()`. This keeps the event loop unblocked while the sync library does its work. Practical over pure.

3. **Foundry client singleton**: Microsoft Foundry client is expensive to instantiate (token acquisition). Cached as a module-level singleton. Trade: slightly stale tokens (mitigated by token refresh logic) vs. eliminating per-request overhead.

4. **MCP resources as context, not tools**: Resources (like ISO descriptions, grid terminology glossary) are static context that Claude loads into its context window. Tools are for dynamic data fetching. This distinction means Claude "knows" what CAISO is without making an API call.

5. **Prompts as templates**: MCP prompts (`grid_analysis`, `market_report`) are pre-built prompt templates that guide Claude on how to use the tools effectively. This is "teaching the AI to use your API" — rather than hoping it figures out the right tool sequence, you give it a playbook.

---

## Why MCP Over a Traditional API?

Two advantages we don't demo but are worth discussing:

1. **Indeterministic orchestration** — Imagine providing a larger set of tools (20-30 across grid data, weather, forecasting, trading signals) and letting the model figure out what to call and in what order. No rigid API workflow, no predefined endpoints for each use case. The AI adapts its approach per question. This is where MCP's value compounds — you build tools, not workflows.

2. **User bears LLM costs** — Users bring their own Claude subscription. We provide the data interface; they provide the compute for reasoning. This is fundamentally different economics from a traditional API where *you* pay for AI inference on every request. With MCP, your cost is data serving, not token generation.

### Why MCP Over Web Search?

If asked "why not just let Claude search the web for grid data?":

1. **Accuracy** — Grid data has specific formats, units, and time zones. Web search returns articles *about* prices, not the prices themselves.
2. **Freshness** — MCP tools hit live APIs. Web search returns cached/indexed content.
3. **Structure** — Tools return typed JSON. Web search returns unstructured text the LLM has to parse (and often gets wrong).
4. **Composability** — Tools can be chained. Get prices, get weather, synthesize. Each step is validated. Web search is one monolithic "hope for the best" query.

---

## What Would You Do Differently?

- **Add WebSocket streaming** for real-time price feeds (currently polling)
- **Redis cache** if scaling to multi-instance
- **Rate limiting per OAuth client** (currently global in-memory)
- **Integration tests** — contract tests for the GridStatus.io API boundary
- **Observability** — structured logging, distributed tracing across the 4 layers

---

## Further Reading

The full design journey is documented across 5 phase docs that capture every decision, pivot, and debugging session:

- [DESIGN_JOURNEY.md](DESIGN_JOURNEY.md) — Index with links to all 5 phases
