# Grid Status MCP Server — Phase 4: From Hello World to Production

_The journey from "one tool works in Claude Desktop" to a fully deployed, OAuth-protected, protocol-complete MCP server. Covers the decisions, pivots, and debugging that got us from Phase 3's proof of concept to a production demo._

---

## Starting Point

Phase 3 ended with a working vertical: Azure Function App → gridstatus data → AI enrichment → MCP server (one tool) → Claude Desktop. The architecture was proven but the scope was minimal — a single `get_fuel_mix` tool that called one endpoint.

The remaining work: build three real tools, showcase the full MCP protocol, deploy to production, add authentication, and make it demo-ready.

---

## The Biggest Unplanned Feature: OAuth 2.1

**Original plan:** No authentication. The demo backend would be public.

**What changed:** The MCP spec requires OAuth 2.1 for remote HTTP transport. Claude Desktop expects to discover OAuth metadata and run a full authorization flow before making MCP requests. You can't just skip it.

**The deeper realization:** OAuth isn't just a spec requirement — it's the "user brings their own API key" pattern that makes MCP servers viable as products. GridStatus uses API keys for their hosted API. An MCP server that just hardcodes one API key is a toy. One that lets each user provide their own key — and never stores it in plain text — is a real product pattern.

**Design decisions for the OAuth server:**

1. **Custom OAuth server, not Auth0.** Building it ourselves (< 500 lines) demonstrates deeper protocol understanding. Auth0 would work but hides the interesting part.

2. **API key → OAuth bridge.** gridstatus.io uses API keys, MCP requires OAuth. We bridge: user pastes API key in a browser form → server encrypts it into an opaque access token → Claude Desktop sends the token → server decrypts and forwards the key. The raw key is never stored.

3. **AES-256-GCM token encryption.** The access token is not a JWT — it's an opaque encrypted blob containing the API key and expiration. This means the server can validate tokens without a database (just needs the encryption key).

4. **PKCE required.** S256 code challenge, verifier length 43-128 characters per RFC 7636. No plain method.

5. **Refresh token rotation.** Old refresh token invalidated on use, new pair issued. 7-day TTL on refresh tokens.

6. **Dynamic Client Registration (RFC 7591).** Claude Desktop doesn't pre-register — it discovers the server and self-registers. Required by the MCP spec.

**The OAuth flow in practice:**
```
Claude Desktop → discovers /.well-known/oauth-protected-resource
              → dynamically registers via POST /oauth/register
              → opens browser to /oauth/authorize (user pastes API key)
              → receives authorization code via redirect
              → exchanges code for access + refresh tokens
              → sends Bearer token on every /mcp request
              → server decrypts → extracts API key → forwards to backend
```

This was the most technically interesting part of the entire project — and the least planned.

---

## Decision 1: Full Protocol Showcase — How Much MCP to Implement?

**The question:** MCP has many primitives (tools, resources, prompts, logging, progress, annotations, completions, notifications, sampling, elicitation, roots, tasks). How many should we implement?

**Initial instinct:** Just tools. That's the core value — everything else is nice-to-have.

**Revised thinking:** This is a demo for a company evaluating whether MCP is the right interface for their data. If we only show tools, we're showing 30% of the protocol. The demo should answer: "What can MCP do beyond tool calls?"

**What we implemented:**
- **Tools** (3) — the core value proposition
- **Resources** (2) — static reference data + live dynamic template, showing app-controlled context
- **Prompts** (3) — pre-built workflows that chain tools automatically, showing user-controlled templates
- **Logging** — info/error messages during tool execution
- **Progress** — 5-stage notifications on the explain tool (most complex tool = best demo)
- **Annotations** — `readOnlyHint` + `openWorldHint` on all tools (safety metadata)
- **Completions** — autocomplete for ISO parameter on resource template
- **Notifications** — delayed tool registration after 5 seconds + `tools/list_changed` event

**What we skipped:**
- **Sampling** — requires client support (Claude Desktop doesn't support it)
- **Elicitation** — 2025-06-18 spec addition, no client support
- **Roots** — filesystem boundaries, not relevant for grid data
- **Tasks** — durable execution, no client support yet

**The delayed registration demo** was a specific design choice. On stdio startup, only 2 tools are available. After 5 seconds, `explain_grid_conditions` registers and fires `tools/list_changed`. This simulates a "premium feature unlock" or "lazy loading" pattern — a real product scenario for MCP servers with tiered access.

---

## Decision 2: Three Backend Tools — Consolidation from Phase 2

Phase 2 proposed 6 tools. We consolidated to 3, each representing a point on the AI spectrum:

| Original Proposal | What Happened |
|---|---|
| `list_isos()` | Cut — CAISO-only scope made it unnecessary |
| `get_grid_snapshot(iso)` | Became `get_market_snapshot` — expanded to include highlights |
| `check_anomaly(iso, metric)` | Became `is_price_unusual` — focused on price, added statistical depth |
| `compare_isos(metric)` | Cut — CAISO-only scope |
| `explain_conditions(iso)` | Became `explain_grid_conditions` — added weather correlation, focus parameter |
| `explain_anomaly(iso, metric)` | Merged into `explain_grid_conditions` with `focus` parameter |

**Key insight:** Fewer tools, each more capable, with cross-referencing descriptions. The tool descriptions tell Claude when to chain them: "If the price looks high, follow up with `is_price_unusual`" and "If the result shows unusual, consider calling `explain_grid_conditions`."

This tool-chaining pattern is more impressive than having many tools — it shows the MCP server guiding Claude's reasoning without requiring it.

---

## Decision 3: Function App → Container Apps Pivot

**The trigger:** Building the Streamable HTTP transport.

The MCP spec defines two transports: stdio (local) and Streamable HTTP (remote). For the remote transport, the server needs to maintain session state — transport instances, in-flight requests, and (once we added OAuth) token state.

**Azure Functions are stateless.** Each invocation is independent. You can hack around this with Durable Functions or external state stores, but that's fighting the abstraction.

**Azure Container Apps** solved this cleanly:
- Long-running Node.js process maintains in-memory state
- Scale to zero when idle (same cost benefit as Functions)
- Instances stay alive during active connections
- HTTPS ingress built in
- Container-based = full runtime control

**What we lost:** The simplicity of `func azure functionapp publish`. We now needed:
- Dockerfiles for both backend (Python) and MCP server (Node.js)
- Azure Container Registry for images
- GitHub Actions for CI/CD
- Container App Environment configuration

**What we gained:** A production-grade deployment that correctly supports the MCP protocol. The added infrastructure complexity is justified — and it's a good talking point about choosing the right Azure service for the workload.

---

## Decision 4: Dual Transport Design

We implemented both transports because they serve different audiences:

**stdio** (`index.ts`) — for local development:
- Claude Desktop launches the MCP server as a subprocess
- `start.sh` auto-pulls from git and rebuilds on every connect
- No authentication (local trust)
- Includes extra demos: delayed tool registration, detailed resource descriptions, logging helper

**Streamable HTTP** (`http.ts`) — for remote production:
- Claude Desktop connects via URL
- OAuth 2.1 authentication (see above)
- API key forwarding via `X-GridStatus-API-Key` header
- All tools available immediately (no delayed registration — it would confuse remote users)

**Shared code:** Both transports register the same tools, resources, and prompts on the same `McpServer` instance pattern. The difference is transport-specific features (OAuth for HTTP, notifications for stdio).

**The `start.sh` wrapper** deserves mention. When Claude Desktop connects via stdio, it runs this script, which auto-pulls from git and rebuilds. This means the MCP server self-updates on every connect — the user always gets the latest version without manual steps.

---

## Decision 5: CI/CD with Self-Hosted Runner

**The problem:** We needed to deploy Docker containers to Azure Container Apps on every push to main.

**GitHub Actions was the obvious choice,** but the runner setup had a twist: the gridstatus-demo repo needed its own self-hosted runner. The existing Captain AI runner couldn't be shared (different repo, different credentials).

**What we built:**
- GitHub Actions workflow (`.github/workflows/deploy.yaml`)
- Two sequential jobs: `deploy-api` then `deploy-mcp`
- Each job: Docker build → push to ACR → update Container App → health poll
- Images tagged with both `latest` and commit SHA
- Self-hosted runner (v2.331.0) as a systemd service on the dev server

**Health verification:** After each deployment, the workflow polls the health endpoint until it returns 200. This catches deployment failures before they're discovered manually.

**One debugging note:** The first CI/CD runs queued indefinitely because no runner was registered for the repo. We had to download a fresh runner binary (not copy from an existing one — runners have unique registration state) and configure it with a repo-specific token.

---

## Decision 6: E2E Testing Strategy

Before writing formal tests, we did comprehensive end-to-end testing against the production deployment:

**Backend API testing (all passed):**
- `GET /health` — Azure OpenAI connectivity
- `GET /market/snapshot` — live CAISO data
- `GET /market/price-analysis` — baseline comparison
- `GET /market/explain` — AI synthesis (found and fixed a JSON parsing bug — LLM was wrapping response in markdown code fences)
- `GET /grid/fuel-mix` — original hello-world endpoint

**MCP server testing (all passed):**
- OAuth metadata discovery (`/.well-known/oauth-protected-resource`)
- Dynamic client registration (`POST /oauth/register`)
- Full OAuth flow: authorize → code exchange → access token → refresh
- MCP initialize handshake
- `tools/list` (3 tools returned)
- `tools/call` (market snapshot via MCP protocol)
- Unauthorized request → 401 with `WWW-Authenticate` header

**Bug found during testing:** The explain endpoint's LLM response was sometimes wrapped in markdown code fences (`` ```json ... ``` ``), causing `json.loads()` to fail. Fixed by stripping code fences before parsing.

---

## Decision 7: Interactive Tutorial Prompt

**The question:** How do we make the demo self-guided? The user shouldn't need a README to understand what the MCP server can do.

**The answer:** An MCP prompt that teaches the user about MCP by using MCP. The tutorial is a zero-arg prompt that, when selected from Claude Desktop's "+" menu, injects instructions telling Claude to run a 6-step guided walkthrough:

1. **Welcome & Orientation** — what's available, how the "+" menu works (prompts vs resources)
2. **Market Snapshot** — live grid data, no AI
3. **Price Analysis** — statistical comparison, still no AI
4. **AI Explanation** — LLM synthesis, two layers of AI
5. **Authentication** — how the OAuth flow works for remote users
6. **Explore on Your Own** — other prompts, resources, cross-tool chaining

**Key design choices:**
- **Audience-appropriate tone** — technically comfortable (uses Claude Desktop, works with energy data) but may be new to MCP
- **Step-by-step with pauses** — Claude waits for the user to respond before advancing
- **No developer jargon** — explains sigma as "how far from average," OAuth as "a browser window opens where you enter your API key"
- **Educational about the spectrum** — explicitly points out which tools use AI and which don't

The tutorial is the same prompt text in both transports (stdio and HTTP).

---

## Summary: What Phase 4 Added

| Component | Phase 3 State | Phase 4 Final |
|---|---|---|
| Backend | 1 endpoint (fuel-mix) on Function App | 5 endpoints on Container App |
| MCP Server | 1 tool, stdio only | 3 tools + resources + prompts + logging + progress + annotations + completions + notifications, dual transport |
| Authentication | None | Full OAuth 2.1 with token encryption |
| Deployment | `func start` locally | Docker + ACR + Container Apps + GitHub Actions CI/CD |
| Documentation | Phase 1-3 design specs | Full README, architecture doc, technical spec, roadmap |
| Onboarding | None | Interactive tutorial prompt |
