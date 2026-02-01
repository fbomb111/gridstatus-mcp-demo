# GridStatus MCP Demo — Roadmap

## Completed

- [x] **Phase 1-2**: Backend API (FastAPI) — market snapshot, price analysis, AI explanation, fuel mix endpoints
- [x] **Phase 3**: MCP server with hello-world tool, Claude Desktop integration
- [x] **Phase 4**: Full MCP protocol showcase (tools, resources, prompts, logging, progress, annotations, completions, dual transport)
- [x] **Phase 6**: CI/CD + Azure Container Apps deployment (API + MCP as separate containers, GitHub Actions with self-hosted runner, rollback on failure)
- [x] **Phase 7**: OAuth 2.1 (custom server, PKCE, Dynamic Client Registration, API key encryption, refresh token rotation)
- [x] **Repo setup**: Standalone repo, auto-update `start.sh`, README, architecture docs
- [x] **Tutorial prompt**: Interactive guided walkthrough of all features (6-step, multi-turn)
- [x] **E2E testing**: All endpoints and OAuth flow verified against production
- [x] **Security hardening**: Token expiry, PKCE verifier validation, body size limits, refresh token TTL
- [x] **CI/CD hardening**: Rollback on failed deploy, `/ready` endpoint, commit SHA in health responses
- [x] **Authenticated tool unlock**: `query_grid_history` — multi-ISO historical data via gridstatusio hosted API, registered dynamically after OAuth (`tools/list_changed`)

## Next: Tests (Phase 5)

Unit and integration tests for both layers.

**MCP server** (`mcp-server/__tests__/`):
- Unit tests for each tool handler (mock backend API responses)
- Integration test: spin up server, send JSON-RPC messages, verify protocol responses
- Resource and prompt handler tests

**Backend** (`backend/tests/`):
- Unit tests for each route (mock gridstatus SDK responses)
- Baseline calculation tests (deterministic — easy to test)
- Integration test with live gridstatus API (optional, rate-limited)

## Next: Remaining Security (Phase 8)

- Rate limiting on HTTP endpoint
- Input validation on all parameters
- Audit OAuth implementation against MCP spec

## Next: Final Polish (Phase 9)

- Error handling improvements
- Logging cleanup
- Final code review pass
