# GridStatus MCP Demo — Architecture

## System Overview

```
                                    +-----------------------+
                                    |   Claude Desktop      |
                                    |   (MCP Host)          |
                                    |                       |
                                    |  User asks: "What's   |
                                    |  happening on the     |
                                    |  California grid?"    |
                                    +----------+------------+
                                               |
                              stdio (local) or  |  HTTPS (remote)
                                               |
                    +----------v------------+
                    |   MCP Server          |
                    |   (TypeScript/Node)   |
                    |                       |
                    |   Transport:          |
                    |   - stdio (index.ts)  |
                    |   - HTTP  (http.ts)   |
                    |                       |
                    |   OAuth 2.1:          |
                    |   - Token encryption  |
                    |   - PKCE + refresh    |
                    +----------+------------+
                               |
                     REST API  |  + X-GridStatus-API-Key header
                               |
                    +----------v------------+
                    |   Backend API         |
                    |   (Python/FastAPI)    |
                    |                       |
                    |   /market/snapshot    |
                    |   /market/explain     |
                    |   /market/price-analysis
                    |   /grid/fuel-mix      |
                    |   /health             |
                    +----+------+------+----+
                         |      |      |
              +----------+  +---+--+  ++-----------+
              |             |      |   |            |
     +--------v---+  +-----v-+ +--v---v--+  +------v------+
     | gridstatus  |  | Open- | | Azure   |  | Hardcoded   |
     | SDK         |  | Meteo | | OpenAI  |  | Baselines   |
     | (CAISO data)|  | (wx)  | | (LLM)   |  | (stats)     |
     +-------------+  +-------+ +---------+  +-------------+
```

## Components

### 1. MCP Server (`mcp-server/`)

The protocol bridge between Claude and the backend API. Implements the full MCP specification.

**Two transports:**

| Transport | File | Entry Point | Use Case |
|-----------|------|-------------|----------|
| stdio | `src/index.ts` | `start.sh` | Claude Desktop (local) |
| Streamable HTTP | `src/http.ts` | `node dist/http.js` | Remote clients (Claude Desktop via URL) |

**MCP primitives implemented:**

| Primitive | What it does |
|-----------|-------------|
| **Tools** (3) | `get_market_snapshot`, `explain_grid_conditions`, `is_price_unusual` |
| **Resources** (2) | Static CAISO overview, live conditions template |
| **Prompts** (3) | Grid Briefing (zero-arg), Investigate Price (parameterized), Tutorial (interactive walkthrough) |
| **Logging** | Info/error messages during tool execution |
| **Progress** | 5-stage progress on explain tool |
| **Annotations** | `readOnlyHint`, `openWorldHint` on all tools |
| **Completions** | Autocomplete for ISO parameter |
| **Notifications** | Delayed tool registration + `tools/list_changed` |

**stdio vs HTTP differences:**

The stdio transport (`index.ts`) includes features specific to Claude Desktop's local experience:
- Delayed registration of `explain_grid_conditions` (appears 5s after connect) to demonstrate the `tools/list_changed` notification pattern
- More detailed resource descriptions
- Logging helper function

The HTTP transport (`http.ts`) adds:
- OAuth 2.1 middleware (Bearer token validation)
- API key forwarding via `X-GridStatus-API-Key` header
- Compact tool/resource/prompt definitions

### 2. OAuth 2.1 Server (`mcp-server/src/auth/`)

Custom OAuth server built into the HTTP transport. Bridges the gap between OAuth (what MCP spec requires) and API keys (what gridstatus.io uses).

```
Claude Desktop                    MCP Server                     User's Browser
     |                                |                                |
     |-- GET /.well-known/            |                                |
     |   oauth-protected-resource --->|                                |
     |<--- {authorization_servers}    |                                |
     |                                |                                |
     |-- POST /oauth/register ------->|                                |
     |<--- {client_id} (RFC 7591)     |                                |
     |                                |                                |
     |-- Open browser: /oauth/authorize?client_id=...&code_challenge=...|
     |                                |-------- HTML form ------------>|
     |                                |<--- POST: api_key=gsk_... -----|
     |                                |-------- 302 redirect -------->|
     |<--- callback?code=authcode_... |                                |
     |                                |                                |
     |-- POST /oauth/token            |                                |
     |   code + code_verifier ------->|                                |
     |<--- {access_token, refresh_token}                               |
     |                                |                                |
     |-- POST /mcp                    |                                |
     |   Authorization: Bearer gs_... |                                |
     |   (encrypted API key inside)   |                                |
```

**Key files:**

| File | Purpose |
|------|---------|
| `oauth-server.ts` | Metadata endpoints (RFC 9728, 8414), client registration (RFC 7591), authorize flow, token exchange |
| `token-store.ts` | AES-256-GCM token encryption/decryption, refresh token rotation with 7-day TTL |

**Security properties:**
- User's API key is encrypted into the access token using AES-256-GCM
- Server never stores the raw API key
- PKCE required (S256, verifier length 43-128)
- Refresh token rotation (old token invalidated on use)
- POST body size limited to 64KB
- Authorization codes expire in 5 minutes, single-use

### 3. Backend API (`backend/`)

FastAPI application serving 5 endpoints. Each endpoint demonstrates a different approach to data processing:

| Endpoint | Approach | External Services | AI? |
|----------|----------|-------------------|-----|
| `GET /health` | Connectivity check | Azure OpenAI | Probe only |
| `GET /market/snapshot` | **Rule-based** | gridstatus SDK | No |
| `GET /market/price-analysis` | **Statistical** | gridstatus SDK | No |
| `GET /market/explain` | **LLM synthesis** | gridstatus SDK, Open-Meteo, Azure OpenAI | Yes |
| `GET /grid/fuel-mix` | **LLM summary** | gridstatus SDK, Azure OpenAI | Yes |

**Service layer:**

| Service | File | Purpose |
|---------|------|---------|
| `grid_data.py` | gridstatus SDK wrapper | Fuel mix, load, prices, grid status (60s cache) |
| `weather.py` | Open-Meteo client | Async weather for Sacramento, LA, SF (5min cache) |
| `baselines.py` | Price statistics | Hourly baselines + 7-day rolling stats |
| `foundry_client.py` | Azure OpenAI | `complete()` function via Managed Identity |
| `cache.py` | In-memory TTL cache | Simple dict-based cache with expiration |

**Baseline computation** (`baselines.py`): Hardcoded hourly baselines (typical price per hour of day) plus a rolling 7-day statistical window. No database — baselines are in-memory constants derived from historical CAISO data. Output: sigma (std devs from mean), percentile (rank in 7-day distribution), severity (normal → elevated → high → extreme), and a template-generated verdict (no LLM).

### 4. Three Tool Approaches (Design Philosophy)

The three market tools intentionally demonstrate a spectrum of AI involvement:

```
+-------------------+    +---------------------+    +----------------------+
| Tool 1            |    | Tool 3              |    | Tool 2               |
| Market Snapshot   |    | Price Analysis      |    | Explain Conditions   |
|                   |    |                     |    |                      |
| Approach A:       |    | Approach A+:        |    | Approach B:          |
| No AI             |    | Deterministic       |    | LLM Synthesis        |
|                   |    | Baselines           |    |                      |
| Data + rules      |    | Data + statistics   |    | Data + weather + AI  |
| Fast, cheap       |    | Fast, reproducible  |    | Rich, variable       |
| Always consistent |    | Same input = same   |    | Contextual analysis  |
|                   |    | output              |    |                      |
+-------------------+    +---------------------+    +----------------------+
```

This shows GridStatus that not everything needs an LLM — most grid monitoring is better served by deterministic tools, with AI reserved for synthesis tasks.

## Infrastructure

### Azure Resources (all in `rg-gridstatus-demo`)

```
rg-gridstatus-demo (East US 2)
├── cae-gridstatus-demo          Container App Environment
│   ├── ca-gridstatus-api        Backend (FastAPI, port 8000)
│   └── ca-gridstatus-mcp        MCP Server (Node, port 3000)
├── id-gridstatus-demo           User-Assigned Managed Identity
│                                  └── Cognitive Services User role on OpenAI
└── (shared) prgptacr.azurecr.io Container Registry
```

**Container App configuration:**

| App | Image | Scale | Ingress |
|-----|-------|-------|---------|
| `ca-gridstatus-api` | `prgptacr.azurecr.io/gridstatus-api` | 0-1 | External, port 8000 |
| `ca-gridstatus-mcp` | `prgptacr.azurecr.io/gridstatus-mcp` | 0-1 | External, port 3000 |

Both scale to zero when idle (cost-efficient for demo).

### CI/CD (`.github/workflows/deploy.yaml`)

```
push to main
    │
    ▼
┌─────────────────────┐
│  deploy-api         │
│  1. Docker build    │
│  2. Push to ACR     │
│  3. Update CA       │
│  4. Health poll     │
│     GET /health     │
└─────────┬───────────┘
          │ depends on
          ▼
┌─────────────────────┐
│  deploy-mcp         │
│  1. Docker build    │
│  2. Push to ACR     │
│  3. Update CA       │
│  4. Health poll     │
│     GET /health     │
│  5. OAuth metadata  │
│     check           │
└─────────────────────┘
```

Runs on self-hosted Linux runner. Uses Managed Identity for Azure login. Tags images with both `latest` and commit SHA.

## Data Flow Examples

### "What's happening on the grid?" (no AI)

```
Claude Desktop
  → MCP: tools/call get_market_snapshot
    → MCP Server: GET /market/snapshot?iso=CAISO
      → Backend: grid_data.get_fuel_mix("CAISO")
        → gridstatus SDK: CAISO().get_fuel_mix("latest")
      → Backend: grid_data.get_load("CAISO")
      → Backend: grid_data.get_prices("CAISO")
      → Backend: grid_data.get_status("CAISO")
      → Backend: _generate_highlights() [rule-based]
    ← JSON: summary + prices + load + mix + highlights
  ← MCP: text content blocks
← Claude synthesizes natural language response
```

Total latency: ~2-5s (gridstatus API calls, cached after first request for 60s)

### "Why are prices so high?" (with AI)

```
Claude Desktop
  → MCP: tools/call explain_grid_conditions {focus: "prices"}
    → MCP Server: GET /market/explain?iso=CAISO&focus=prices
      → Backend (parallel):
        → gridstatus SDK: fuel mix, load, prices
        → Open-Meteo API: weather for Sacramento, LA, SF
      → Backend: Azure OpenAI completion
        (structured context + energy analyst prompt → JSON response)
    ← JSON: explanation + contributing_factors
  ← MCP: text content blocks
← Claude synthesizes final response (2nd layer of AI)
```

Total latency: ~5-10s (gridstatus + weather + OpenAI completion)

### OAuth-protected tool call (remote)

```
Claude Desktop
  → POST /mcp [Authorization: Bearer gs_...]
    → http.ts: oauth.validateBearerToken()
      → token-store.ts: AES-256-GCM decrypt
        → Extract API key from token payload
        → Check expiration
    → Set currentApiKey = decrypted key
    → Process MCP JSON-RPC request
      → apiFetch("/market/snapshot", currentApiKey)
        → Backend receives X-GridStatus-API-Key header
        → (Future: forward to gridstatus.io hosted API)
    ← SSE: event: message, data: {jsonrpc result}
```

## Environment Variables

### Backend

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MANAGED_IDENTITY_CLIENT_ID` | Yes (for AI) | — | Azure UAI for OpenAI auth |
| `FOUNDRY_ENDPOINT` | Yes (for AI) | — | Azure OpenAI endpoint |
| `FOUNDRY_MODEL_DEPLOYMENT` | No | `gpt-4.1` | Model deployment name |

### MCP Server

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GRIDSTATUS_API_URL` | No | `http://localhost:8000` | Backend API base URL |
| `MCP_HTTP_PORT` | No | `3000` | HTTP transport port |
| `MCP_ISSUER` | No | `http://localhost:3000` | OAuth issuer URL |
| `MCP_TOKEN_SECRET` | Yes (prod) | `dev-secret-...` | AES encryption key for tokens |
| `MCP_REQUIRE_AUTH` | No | `true` | Enable/disable OAuth |

## Key Design Decisions

1. **Custom OAuth server over Auth0**: Demonstrates deeper protocol understanding. The OAuth server is <500 lines and implements exactly what MCP needs — nothing more.

2. **API key → OAuth bridge**: gridstatus.io uses API keys, but MCP spec requires OAuth 2.1. The bridge encrypts the key into an opaque token, so the MCP server never stores it in plain text.

3. **Two transports, shared server**: Both stdio and HTTP use the same `McpServer` instance pattern but with transport-appropriate features. stdio gets delayed registration demo; HTTP gets OAuth.

4. **Three tool approaches**: Intentionally demonstrates that not everything needs AI. Rule-based (snapshot), statistical (price analysis), and LLM synthesis (explain) show judgment about when to use AI.

5. **Scale-to-zero Container Apps**: More cost-effective than App Service for a demo that isn't under constant load. MCP's stateful HTTP sessions work because Container Apps maintain instances during active connections.

6. **Separate containers for API and MCP**: Different runtimes (Python vs Node), different scaling needs, independent deployability. The MCP server can be updated without touching the data layer.
