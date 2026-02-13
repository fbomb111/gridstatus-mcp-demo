# Grid Status MCP Server — Phase 4: From Hello World to Production

_From "one tool works in Claude Desktop" to a fully deployed, OAuth-protected, protocol-complete MCP server._

---

## The Biggest Unplanned Feature: OAuth 2.1

**Original plan:** No authentication — public demo backend.

**What changed:** The MCP spec requires OAuth 2.1 for remote HTTP transport. And the deeper realization: OAuth isn't just spec compliance — it's the "user brings their own API key" pattern that makes MCP servers viable as products.

**Key design choices:**
1. **Custom OAuth server (< 500 lines)** over Auth0 — demonstrates protocol understanding
2. **API key → OAuth bridge** — user pastes key in browser form → encrypted into opaque token → decrypted on each request. Raw key never stored.
3. **AES-256-GCM token encryption** — no database needed for token validation
4. **PKCE required**, refresh token rotation, 5-minute single-use authorization codes

See [architecture.md](architecture.md) for the full OAuth flow diagram and security properties.

---

## Full Protocol Showcase

**Question:** MCP has many primitives. How much to implement?

**Answer:** This is a demo for a company evaluating MCP — showing just tools is only 30% of the protocol.

**What we implemented:** Tools (3), Resources (2), Prompts (3), Logging, Progress, Annotations, Completions, Notifications (delayed tool registration + `tools/list_changed`).

**What we skipped:** Sampling, Elicitation, Roots, Tasks — no client support yet.

**Delayed registration** simulates a "premium feature unlock" pattern: only 2 tools at startup, 3rd appears after 5 seconds via `tools/list_changed`.

---

## Tool Consolidation

Phase 2 proposed 6 tools. We consolidated to 3, each at a point on the AI spectrum. Tool descriptions guide Claude's chaining: "If price looks high, follow up with `is_price_unusual`" → "If unusual, consider `explain_grid_conditions`." This chaining pattern is more impressive than having many tools.

---

## Function App → Container Apps Pivot

**Trigger:** MCP Streamable HTTP needs in-memory session state. Azure Functions are stateless.

Container Apps solved it: long-running process, scale-to-zero (same cost), instances stay alive during connections, HTTPS ingress built in. We lost `func publish` simplicity but gained correct protocol support.

---

## Dual Transport Design

- **stdio** (`index.ts`): Local dev. `start.sh` auto-pulls and rebuilds on connect. Delayed registration demo, detailed resources, logging helper.
- **Streamable HTTP** (`http.ts`): Remote production. OAuth 2.1, API key forwarding, all tools immediate.

Both share the same tool/resource/prompt definitions on `McpServer`.

---

## CI/CD

GitHub Actions with self-hosted runner. Two sequential jobs: `deploy-api` → `deploy-mcp`. Each: Docker build → push to ACR → update Container App → health poll. Images tagged with `latest` + commit SHA.

---

## Interactive Tutorial Prompt

An MCP prompt that teaches MCP by using MCP. 6-step guided walkthrough: welcome → market snapshot (no AI) → price analysis (statistics) → AI explanation (LLM synthesis) → authentication → free exploration. Self-guided — no README required.
