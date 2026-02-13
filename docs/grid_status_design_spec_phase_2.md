# Grid Status MCP Server — Phase 2: Architecture Decisions

_Phase 1 established what to build and why. This phase covers how — concrete architecture and infrastructure choices._

---

## Decision 1: Research — What Does gridstatus Offer?

The library covers all 7 major US ISOs with rich data: LMP prices, load/forecasts, fuel mix, storage, curtailment, ancillary services. Rich enough for sophisticated analysis, not just retrieval.

**Key finding:** Our tools should _complement_ the gridstatus.io dashboard, not replicate it.

---

## Decision 2: Local vs. Hosted Backend

**Problem:** Local MCP server doing API calls, baseline computation, and LLM inference would be slow (10+ seconds per call).

**Solution:** Thin MCP client → Hosted backend API. MCP server is ~50 lines of TypeScript — all intelligence lives in the backend. This keeps the architecture legible: interviewer sees domain logic in the backend, not hidden in MCP plumbing.

---

## Decision 3: Azure Function App

We chose Function App over App Service (overkill) and Container Apps (more config). Single Python file, no container registry, FastAPI via ASGI adapter, ~$0 when idle.

**Cold start tradeoff:** Acceptable for a demo — easy talking point about production improvements.

_Note: We later pivoted to Container Apps in Phase 4 when the MCP HTTP transport needed in-memory session state._

---

## Decision 4: Skip Redis

In-memory dict with TTL is sufficient. Grid data changes every ~5 minutes, no concurrent users at scale. Redis would mean another resource to provision for no demo benefit.

---

## Decision 5: CAISO Only

Originally planned 3 ISOs (CAISO, ERCOT, PJM). Cut to CAISO only for depth over breadth — solar + batteries = richest data story. Architecture supports additional ISOs trivially.

---

## What We Cut

| Feature | Why |
|---------|-----|
| Node-level pricing | ISO averages tell the story for demo |
| Historical event lookup | Better answered by Claude + web search |
| Real-time alerts | Needs push infrastructure, out of scope for request/response |
| Cross-ISO arbitrage | Niche audience, save for v2 |
| Database persistence | No users to persist for |
| Authentication | Demo backend is public (added in Phase 4 for MCP spec compliance) |

---

## Design Philosophy

1. **Product judgment** — Every feature earns its place by answering a question Claude alone can't
2. **Trade-off awareness** — Spectrum of approaches (pipe → deterministic → LLM) with articulated reasoning
3. **Practical execution** — Scoped tight enough to ship in days, extensible enough to grow
