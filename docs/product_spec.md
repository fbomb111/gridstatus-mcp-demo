# Grid Status MCP Server — Product Overview

_A demonstration project for Grid Status, showing AI-native tooling for energy grid data._

---

## Context

This project is a technical demonstration for a potential role at Grid Status. The goal is not just to build a working MCP server, but to demonstrate thoughtful AI product design — understanding when and why to use these tools, not just how.

Grid Status's mission is democratizing access to grid data. An MCP server extends this by making grid data accessible through conversational AI interfaces, but only where that genuinely adds value over existing approaches.

---

## What We're Not Building

**A wrapper around their API.** Claude with web search can already answer conceptual questions about the grid. Wrapping gridstatus in MCP tools without adding intelligence just competes with that — and loses.

**A showcase of MCP for its own sake.** MCP is an interface standard, not magic. Building MCP to show we can build MCP proves nothing.

---

## What We Are Building

**A demonstration of where server-side intelligence adds genuine value.**

The MCP server should answer questions that:

- Require real-time data (not available in published articles)
- Require computation or aggregation (not just retrieval)
- Require domain knowledge to interpret (not obvious to a generic LLM)
- Benefit from orchestrated data enrichment (multiple sources combined)

The demo should show thoughtful trade-offs: some tools are simple data pipes because that's all they need to be; others embed domain logic because interpretation requires expertise.

---

## Target Users (for Framing)

Grid Status serves energy traders, asset operators, utilities, developers, and data scientists. For this demo, we're framing around questions these users actually ask:

- "Is this price spike unusual, or normal for these conditions?"
- "What's driving the current grid state?"
- "How does this ISO compare to others right now?"

These questions require more than data retrieval — they require context, baselines, and interpretation.

---

## Core Design Principle

**Division of labor between client and server:**

| Layer          | Responsibility                                                        |
| -------------- | --------------------------------------------------------------------- |
| **Client LLM** | Parse user intent, choose tools, contextualize response for user      |
| **MCP Server** | Abstract data complexity, embed domain knowledge, synthesize insights |

The server doesn't know what the user asked — it just receives tool calls. So it returns structured data and insights. The client knows the user's context and presents appropriately.

---

## Two Approaches, Intentionally

The demo includes tools using two different approaches to show trade-off awareness:

**Approach A — Deterministic:**

- Server fetches, enriches, computes
- Returns structured data
- Client LLM narrates

_Example:_ "Is this price unusual?" → Server compares to baseline, returns `{value, baseline, sigma, is_anomalous}` → Client explains.

**Approach B — Synthesis:**

- Server fetches multiple sources, applies domain logic
- Server synthesizes contributing factors
- Returns structured insights + summary
- Client contextualizes

_Example:_ "Why are prices high?" → Server checks load, weather, supply, computes what matters → Returns ranked factors + explanation → Client presents based on user's tone.

Neither approach is universally better. The demo shows when to use which.

---

## Success Criteria

**For the demo itself:**

- A user can connect to Claude Desktop and have a useful conversation about grid data
- Common questions work reliably and demonstrate clear value over just asking Claude
- The conversation flow showcases both Approach A and B tools

**For the technical interview:**

- Can articulate _why_ each tool is designed the way it is
- Can discuss trade-offs: what we didn't build and why
- Shows understanding of MCP as an interface choice, not a capability unlock
- Demonstrates domain learning (energy grid basics) alongside AI tooling expertise

**For the broader narrative:**

- This isn't "I built an MCP server"
- This is "I can design AI systems that add real value, know when to use what, and make thoughtful trade-offs"

---

## Technical Approach (High Level)

**Data sources:**

- gridstatus open-source library (primary)
- Weather API for correlation (OpenMeteo, free)
- Pre-computed baselines for "is this normal?" comparisons

**Server-side LLM:**

- Used for Approach B tools (synthesis, explanation)
- Not used for Approach A tools (deterministic logic suffices)

**Hosting:**

- Azure (leveraging existing credits)
- Goal: they can interact with it without local setup

---

## What's Not in Scope (for MVP)

| Cut                        | Rationale                                                                 |
| -------------------------- | ------------------------------------------------------------------------- |
| RAG over historical events | Already demonstrated this skill elsewhere; adds scope without new insight |
| Full production database   | Demo doesn't need persistence at scale                                    |
| gridstatus.io hosted API   | Open-source library is sufficient and avoids auth complexity              |
| Forecasting / predictions  | Out of scope, different problem domain                                    |

---

## Decisions Made (Resolved from Initial Planning)

| Question | Resolution |
|----------|-----------|
| Tool definitions and parameters | 3 tools: `get_market_snapshot`, `is_price_unusual`, `explain_grid_conditions` — all CAISO-only with optional `focus` param on explain |
| Baseline computation | Hardcoded hourly baselines + rolling 7-day stats, computed on demand. No database. |
| Server-side LLM | Azure OpenAI (gpt-4.1) via Managed Identity. Used only for explain tool. ~$0 at demo scale. |
| Demo script | Interactive tutorial prompt built into the MCP server itself — user selects it from Claude Desktop's "+" menu |
| Hosting | Azure Container Apps (scale to zero). Custom OAuth 2.1 for remote access. |
| ISO coverage | CAISO only. Original plan included ERCOT and PJM — cut for depth over breadth. One ISO done well demonstrates the pattern; adding more is trivial. |

---

## Documentation

| Document | Purpose |
|----------|---------|
| `README.md` | Setup, demo script, capability coverage — the "what is it now" doc |
| `docs/architecture.md` | System diagrams, data flows, infrastructure, environment variables |
| `docs/product_spec.md` | This file — product thesis and design principles |
| `docs/technical_spec.md` | Tool schemas, backend endpoints, infrastructure details |
| `docs/grid_status_design_spec_phase_1.md` | Design reasoning — 10 threads showing how we arrived at the A/B framework |
| `docs/grid_status_design_spec_phase_2.md` | Architecture decisions — what we built, what we cut, and why |
| `docs/grid_status_design_spec_phase_3.md` | Implementation journal — the actual build process, debugging, and learnings |

---

_This project demonstrates not just technical capability, but product thinking: knowing what to build, what not to build, and why._
