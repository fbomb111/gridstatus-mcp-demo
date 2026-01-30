# Grid Status MCP Server — Technical Specification

_Backend API and MCP server specification. Reflects the shipped implementation._

---

## Architecture Overview

```
Claude Desktop                    MCP Server (TypeScript)          Backend API (FastAPI)
     │                                 │                                │
     │  stdio (local)                  │                                │
     │  or HTTPS (remote + OAuth)      │   REST + API key header       │
     ├────────────────────────────────►├──────────────────────────────►│
     │                                 │                                │
     │                                 │  OAuth 2.1 (HTTP only):       │──► gridstatus SDK
     │                                 │  - PKCE + token encryption    │──► Open-Meteo (weather)
     │                                 │  - Dynamic Client Reg         │──► Azure OpenAI (explain)
     │                                 │  - Refresh token rotation     │──► Hardcoded baselines
     │                                 │                                │
```

**Design principles:**
- MCP server is a thin protocol adapter — tool definitions + HTTP calls
- Backend does all heavy lifting: data fetching, baseline computation, LLM synthesis
- Two transports serve different use cases: stdio for local dev, HTTP for remote production

---

## Tools

Three tools demonstrating a spectrum of approaches:

| Tool | Approach | Server-side AI? | What It Shows |
|------|----------|-----------------|---------------|
| `get_market_snapshot` | Data + rules | No | Orchestrated data retrieval with rule-based highlights |
| `is_price_unusual` | Data + statistics | No | Deterministic baseline comparison, same input = same output |
| `explain_grid_conditions` | Data + weather + AI | Yes | Multi-source correlation, LLM synthesis of contributing factors |

**ISO coverage:** CAISO only (California). The architecture supports additional ISOs trivially — CAISO was chosen for depth (solar + batteries = richest data story).

### Backend Endpoints

| Endpoint | Tool | External Services |
|----------|------|-------------------|
| `GET /market/snapshot?iso=CAISO` | `get_market_snapshot` | gridstatus SDK |
| `GET /market/price-analysis?iso=CAISO` | `is_price_unusual` | gridstatus SDK |
| `GET /market/explain?iso=CAISO&focus=general` | `explain_grid_conditions` | gridstatus SDK, Open-Meteo, Azure OpenAI |
| `GET /grid/fuel-mix` | _(original hello-world endpoint)_ | gridstatus SDK, Azure OpenAI |
| `GET /health` | _(health check)_ | Azure OpenAI (probe only) |

### Baseline Computation

Price analysis uses hardcoded hourly baselines (typical price for each hour of day) plus a rolling 7-day statistical window. No database — baselines are in-memory constants derived from historical CAISO data.

- **Sigma**: standard deviations from hourly mean
- **Percentile**: rank within rolling 7-day distribution
- **Severity**: normal → elevated → high → extreme (threshold-based)
- **Verdict**: template-generated from sigma + severity (no LLM)

### Explain Tool — LLM Synthesis

Fetches grid data and weather in parallel, then passes structured context to Azure OpenAI:
- Grid data: fuel mix, load, prices from gridstatus SDK
- Weather: temperatures and wind speeds for Sacramento, LA, SF from Open-Meteo
- Prompt: energy analyst persona, focused on the `focus` parameter (general/prices/reliability/renewables)
- Returns: explanation text + ranked contributing factors with impact levels

**Model:** gpt-4.1 via Managed Identity (no API keys stored anywhere)

---

## MCP Protocol Primitives

Beyond the three tools, the server implements the full MCP specification:

| Primitive | Implementation |
|-----------|---------------|
| **Resources** | Static CAISO overview + dynamic live conditions template (with autocomplete) |
| **Prompts** | Grid Briefing (chains all tools), Investigate Price (parameterized), Tutorial (interactive walkthrough) |
| **Logging** | Info/error messages during tool execution |
| **Progress** | 5-stage notifications on explain tool (stdio transport) |
| **Annotations** | `readOnlyHint` + `openWorldHint` on all tools |
| **Completions** | Autocomplete for ISO parameter on resource template |
| **Notifications** | Delayed tool registration + `tools/list_changed` (stdio transport) |

### Transport Differences

| Feature | stdio (`index.ts`) | HTTP (`http.ts`) |
|---------|--------------------|--------------------|
| Use case | Claude Desktop local dev | Remote production |
| Auth | None | OAuth 2.1 (PKCE + encrypted tokens) |
| Delayed tool registration | Yes (5s demo) | No (all tools immediately) |
| Progress notifications | Yes | No |
| API key forwarding | N/A | Via `X-GridStatus-API-Key` header |

---

## OAuth 2.1

The HTTP transport includes a custom OAuth server that bridges the gap between OAuth (what MCP spec requires) and API keys (what gridstatus.io uses).

**Flow:** Claude Desktop discovers metadata → dynamically registers → opens browser for API key entry → server encrypts key into opaque access token → Claude sends token on every request → server decrypts and forwards key to backend.

**Key files:**
- `mcp-server/src/auth/oauth-server.ts` — metadata (RFC 9728, 8414), registration (RFC 7591), authorize, token exchange
- `mcp-server/src/auth/token-store.ts` — AES-256-GCM encryption, refresh token rotation (7-day TTL)

**Security:** API key encrypted at rest in token, PKCE required (S256, verifier 43-128 chars), refresh token rotation, 64KB body size limit, authorization codes single-use with 5-minute expiry.

---

## Infrastructure

| Resource | Name | Purpose |
|----------|------|---------|
| Resource Group | `rg-gridstatus-demo` | East US 2, all resources |
| Container App Env | `cae-gridstatus-demo` | Shared environment |
| Backend Container App | `ca-gridstatus-api` | FastAPI + uvicorn, port 8000, scale 0-1 |
| MCP Container App | `ca-gridstatus-mcp` | Node.js + OAuth, port 3000, scale 0-1 |
| Managed Identity | `id-gridstatus-demo` | Cognitive Services User role for OpenAI |
| Container Registry | `prgptacr.azurecr.io` | Shared ACR (Docker images) |

**CI/CD:** GitHub Actions (`.github/workflows/deploy.yaml`) on push to main. Self-hosted runner. Builds Docker images, pushes to ACR, deploys to Container Apps, verifies health endpoints.

**Why Container Apps:** MCP Streamable HTTP needs in-memory session state. Azure Functions are stateless. Container Apps scale to zero (cost-efficient for demo) while maintaining instances during active connections.

### Environment Variables

**Backend:**
- `MANAGED_IDENTITY_CLIENT_ID` — Azure UAI for OpenAI auth
- `FOUNDRY_ENDPOINT` — Azure OpenAI endpoint
- `FOUNDRY_MODEL_DEPLOYMENT` — Model name (default: `gpt-4.1`)

**MCP Server:**
- `GRIDSTATUS_API_URL` — Backend base URL (default: `http://localhost:8000`)
- `MCP_HTTP_PORT` — HTTP transport port (default: `3000`)
- `MCP_ISSUER` — OAuth issuer URL
- `MCP_TOKEN_SECRET` — AES encryption key for tokens
- `MCP_REQUIRE_AUTH` — Enable/disable OAuth (default: `true`)
