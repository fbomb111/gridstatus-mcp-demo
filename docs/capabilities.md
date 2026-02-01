# GridStatus MCP Demo — Capabilities & Future Directions

_Things we could build or explore beyond the current MVP. These are not planned work — they're documented possibilities, organized by category._

---

## MCP Protocol Primitives

Features from the MCP spec that aren't implemented because client support doesn't exist yet.

| Primitive | What It Would Do | Status |
|-----------|-----------------|--------|
| **Dynamic tool registration** | Register tools after startup, fire `tools/list_changed`. | **Now in production** — `query_grid_history` registers after OAuth authentication, firing `tools/list_changed`. The original timer-based approach was unreliable; the OAuth-triggered approach is deterministic. |
| **Sampling** | Server asks the client's LLM to process something (server → client LLM request). | No MCP client supports this yet. |
| **Elicitation** | Server prompts the user for input mid-flow (e.g., "Which ISO?"). | Added to MCP spec 2025-06-18. No client support. |
| **Tasks** | Durable execution — long-running operations with status tracking. | Spec draft, no client support. |

---

## Data & Coverage Expansion

Architectural decisions that were scoped down for the MVP demo but are trivially extensible.

| Feature | What It Would Add | Why We Cut It |
|---------|------------------|---------------|
| ~~**Multi-ISO support**~~ | ~~Same tools for Texas and Mid-Atlantic grids.~~ | **Built** — `query_grid_history` covers all 7 US ISOs via the gridstatusio hosted API. Gated behind API key authentication. |
| **Cross-ISO comparison** | "Compare California vs Texas prices" — dedicated comparison tool that queries multiple ISOs and presents side-by-side. | Could layer on top of `query_grid_history`. Users can already ask Claude to compare manually. |
| **Node-level pricing** | LMP at specific grid nodes instead of ISO averages. | Too granular for demo audience. ISO averages tell the story. |
| **Historical event lookup** | "What happened during Winter Storm Uri?" — RAG over grid event history. | Better answered by Claude + web search. Already demonstrated RAG skill elsewhere. |
| **Forecasting / predictions** | Price or load forecasts. | Different problem domain. Out of scope for a real-time data demo. |

---

## Infrastructure & Operations

Production hardening beyond what the demo needs.

| Feature | What It Would Add | Current State |
|---------|------------------|---------------|
| **Persistent OAuth state** | Redis or database-backed token store. Survives container restarts, supports multiple instances. | In-memory store. Tokens lost on restart (scale-to-zero, deploy). Acceptable for demo — users re-auth. |
| **Staging environment** | Pre-production deploy target for testing before main. | Direct to production. Fine for solo project. |
| **Infrastructure as code** | Bicep or Terraform for Container Apps, ACR, identity. | Configured via Azure CLI, not in code. |
| **Real-time alerts** | WebSocket push for price spikes, grid events. | Different paradigm than MCP request/response. Would need a separate notification channel. |

---

_These items are preserved here so we remember what's possible without cluttering the active [Roadmap](../ROADMAP.md)._
