# GridStatus MCP Demo — Roadmap

## Completed

- [x] **Phase 1-2**: Backend API (FastAPI) with 3 endpoints
- [x] **Phase 3**: MCP server with hello world tool
- [x] **Phase 4**: Full MCP protocol showcase (tools, resources, prompts, logging, progress, annotations, completions, notifications, dual transport)
- [x] **Repo setup**: Standalone repo, auto-update `start.sh`, README with architecture docs

## Phase 5: Tests

Unit and integration tests for both layers.

**MCP server** (`mcp-server/__tests__/`):
- Unit tests for each tool handler (mock backend API responses)
- Integration test: spin up server, send JSON-RPC messages, verify protocol responses
- Resource and prompt handler tests

**Backend** (`backend/tests/`):
- Unit tests for each route (mock gridstatus SDK responses)
- Baseline calculation tests (deterministic — easy to test)
- Integration test with live gridstatus API (optional, rate-limited)

## Phase 6: CI/CD + Azure Deployment

Deploy as a fully remote service so users don't need to install anything locally.

**Deploy target**: Azure Container App
- Scales to zero (cost-efficient for demo)
- No cold start issues (unlike Functions)
- HTTPS + custom domain out of the box
- Container-based — full Node.js runtime control

**Why Container App over alternatives**:
- Functions: MCP Streamable HTTP needs in-memory session state. Functions are stateless.
- App Service: Doesn't scale to zero — pays for idle compute.

**GitHub Actions** (`.github/workflows/deploy.yaml`):
- On push to main: build TypeScript → run tests → build Docker image → push to ACR → deploy to Container App
- For local/stdio users: `start.sh` already auto-updates via `git pull` on connect

**Container structure**:
- `Dockerfile` in `mcp-server/` — Node.js image, copies dist/, runs `node dist/http.js`
- Backend API deployed as separate Container App (Python + FastAPI/uvicorn)

## Phase 7: OAuth 2.1 (User Brings Their Own API Key)

**Goal**: Users authenticate with their own gridstatus API key via OAuth. The MCP server never stores or sees the raw key.

**Why this matters**: Demonstrates a real multi-tenant MCP product pattern — your logic, their credentials. Users connect via Claude Desktop → Settings → Connectors → paste the hosted MCP URL. No local install needed.

**MCP spec requirements** ([authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)):
- OAuth 2.1 with PKCE (mandatory)
- Dynamic Client Registration — RFC 7591 (required by Claude Desktop)
- Protected Resource Metadata — RFC 9728
- Authorization Server Metadata — RFC 8414
- Resource parameter — RFC 8707

**How it works** (gridstatus uses API keys, not OAuth, so we bridge):
1. Claude Desktop discovers OAuth metadata at `/.well-known/oauth-protected-resource`
2. Claude dynamically registers via `POST /register` (RFC 7591)
3. User's browser opens `/authorize` — simple form to paste their gridstatus API key
4. Auth server issues an opaque access token (encrypted, contains user's API key)
5. Claude passes `Authorization: Bearer <token>` on every MCP request
6. MCP server decrypts token → extracts API key → forwards to backend
7. User's gridstatus tier/quota applies — server never stores the raw key

**Custom OAuth server** built into the MCP HTTP service (not Auth0 — shows deeper understanding):
- `mcp-server/src/auth/oauth-server.ts` — metadata, /register, /authorize, /token endpoints
- `mcp-server/src/auth/token-store.ts` — token issuance/validation (encrypted API key)
- `mcp-server/src/auth/templates/authorize.html` — authorization page

## Phase 8: Security Review

- Audit OAuth implementation against MCP spec
- No token passthrough (spec explicitly forbids it — confused deputy problem)
- HTTPS everywhere for remote transport
- Rate limiting on HTTP endpoint
- Input validation on all parameters
- No secrets in code or logs
- Token expiry and refresh support

## Phase 9: Final Polish

- README updates for remote deployment + OAuth setup
- Environment variable documentation
- Error handling improvements
- Logging cleanup
- Final code review pass
