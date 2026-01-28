# Grid Status MCP Server — Design Process

_How we arrived at each decision, and the reasoning behind what we built (and didn't)._

---

## Starting Point: What Problem Are We Solving?

Grid Status's mission is democratizing access to grid data. They have a powerful open-source library (`gridstatus`) and a live dashboard at gridstatus.io. The question isn't "can we build an MCP server?" — it's "should we, and if so, what should it do?"

The first instinct — wrapping gridstatus in MCP tools so Claude can call it — is the wrong answer. Claude with web search can already answer conceptual grid questions. A thin wrapper just competes with that and loses. We need to add intelligence that Claude alone can't provide.

---

## Decision 1: What NOT to Build

Before figuring out what to build, we eliminated what wouldn't work:

| Rejected Approach | Why |
|---|---|
| API wrapper around gridstatus | Claude + web search already handles conceptual questions. A wrapper adds plumbing, not value. |
| MCP for its own sake | MCP is an interface standard, not a capability. Building MCP to show we can build MCP proves nothing. |
| RAG over historical grid events | Already demonstrated this skill elsewhere. Adds scope without new insight for the demo. |
| Forecasting / predictions | Different problem domain entirely. Out of scope. |

**Key insight:** The demo needs to show questions that _only work_ with server-side intelligence — real-time data + computation + domain knowledge that a generic LLM doesn't have.

---

## Decision 2: Research — What Does gridstatus Actually Offer?

We studied the gridstatus library to understand the data landscape:

**ISOs supported:** CAISO, ERCOT, PJM, MISO, ISONE, NYISO, SPP — all major US grid operators.

**Data types available:**
- **LMP prices** — Locational Marginal Pricing (real-time and day-ahead)
- **Load** — Current demand and forecasts
- **Fuel/generation mix** — Solar, wind, gas, nuclear, hydro, imports breakdown
- **Supply** — Generation capacity online
- **Storage** — Battery charge/discharge (CAISO especially)
- **Curtailment** — Renewable energy wasted due to oversupply
- **Ancillary services** — Reserves, regulation markets

**Key finding:** The library is rich enough to support sophisticated analysis, not just data retrieval. This matters because it means our server-side intelligence can actually do meaningful computation.

We also studied the gridstatus.io live dashboard to understand what they already surface: LMP price maps, fuel mix charts, load curves, renewables tracking. Our tools should _complement_ this dashboard, not replicate it.

---

## Decision 3: MCP Server vs. Chat App

Two viable approaches:

**Option A: Standalone chat app** — Build a web UI that talks to grid data, does all processing internally.

**Option B: MCP server** — Build tools that Claude Desktop (or any MCP client) can call.

**We chose MCP.** Rationale:

1. **Shows protocol thinking.** Grid Status is building data infrastructure. Understanding how to make data accessible through emerging AI interfaces is directly relevant to their product direction.

2. **Lower scope, higher signal.** A chat app needs UI, auth, hosting, session management. MCP lets us focus on the intelligence layer — which is the actual demo.

3. **They can try it themselves.** With MCP, the recipient can `npx gridstatus-mcp` and immediately use it in Claude Desktop. No URL to visit, no account to create.

4. **Differentiating.** Most applicants would build a Streamlit app or a chatbot. MCP shows awareness of where AI tooling is heading.

---

## Decision 4: Architecture — Local vs. Hosted Backend

Initial thought: MCP server runs locally, calls gridstatus APIs directly.

**Problem:** A local MCP server doing all the heavy lifting — calling multiple APIs, computing baselines from historical data, running LLM inference — would be slow and complex. The user would wait 10+ seconds for each tool call while the local process fetches data, crunches numbers, and calls OpenAI.

**Revised architecture:** Thin local MCP client → Hosted backend API.

```
Claude Desktop → MCP Client (thin, just HTTP calls) → Backend API (does everything)
```

The MCP client is ~50 lines of TypeScript. All intelligence lives in the backend:
- gridstatus library calls
- Baseline computation
- Weather correlation
- LLM synthesis (for Approach B tools)
- In-memory caching

**Why this is better:**
- User gets fast responses (backend is warm, data is cached)
- Backend can pre-compute baselines
- LLM calls happen server-side (no API key exposure in MCP client)
- Interviewer can see the backend code — the intelligence is visible, not hidden in prompts

---

## Decision 5: Infrastructure — Function App

Options considered:

| Option | Pros | Cons |
|---|---|---|
| Azure App Service | Familiar, always-on | Overkill for 3 endpoints, costs even when idle |
| Azure Container App | Scalable, modern | Container registry overhead, more config |
| Azure Function App | Simplest deploy, pay-per-use | Cold starts possible |

**We chose Function App.** This demo might lead nowhere — we don't want to maintain infrastructure for a project that could be abandoned after one interview. Function App is:
- Single Python file deployable with `func azure functionapp publish`
- No container registry, no App Service Plan
- FastAPI works via ASGI adapter
- ~$0 when not in use (Consumption plan)

**Cold start tradeoff:** First request after idle may take 5-10 seconds. Acceptable for a demo — and an easy talking point about what we'd change for production (always-warm instances, Flex Consumption plan).

---

## Decision 6: Skip Redis for MVP

No external caching layer. In-memory dict with TTL is sufficient:
- Grid data changes every 5 minutes at most
- We're not handling concurrent users at scale
- Adding Redis means another Azure resource to provision, configure, and pay for

**What we'd say in the interview:** "For production, I'd add Redis for shared caching across Function App instances and to survive cold starts. For demo, in-memory TTL cache keeps it simple and the latency penalty is a few extra seconds on cache misses — acceptable."

---

## Decision 7: Three Tools Showing a Spectrum

We intentionally designed three tools that demonstrate different approaches to server-side intelligence:

### Tool 1: `get_market_snapshot` — Simple Pipe (Approach A)

**What it does:** Returns current prices, load, generation mix for an ISO.

**Why this approach:** Sometimes data retrieval with light enrichment is all you need. The `highlights` array adds rule-based observations ("Solar at 35% — typical for afternoon"), but no LLM. This tool is fast, deterministic, and predictable.

**What it demonstrates:** Not everything needs AI. Knowing when a simple pipe is the right answer is itself a design skill.

### Tool 2: `is_price_unusual` — Deterministic Analysis (Approach A+)

**What it does:** Compares current price to historical baselines, returns statistical analysis.

**Why this approach:** "Is this price normal?" requires baselines — hourly averages, seasonal patterns, rolling windows. A generic LLM doesn't have these. But the analysis itself is deterministic: compute sigma, compute percentile, apply threshold rules, generate verdict from template.

**What it demonstrates:** Domain knowledge embedded in computation, not in prompts. The baselines are the intelligence — the rest is math.

### Tool 3: `explain_grid_conditions` — LLM Synthesis (Approach B)

**What it does:** Fetches prices, load, generation mix, AND weather; uses an LLM to synthesize a coherent explanation of what's driving current conditions.

**Why this approach:** "Why are prices high?" requires correlating multiple data sources and reasoning about causation. Rule-based logic would need hundreds of conditions. An LLM, given structured data, can synthesize a plausible explanation that reads like an analyst wrote it.

**What it demonstrates:** When server-side LLM adds genuine value — not because we can, but because the alternative (hand-coding every causal relationship in the energy market) is impractical.

### The Spectrum

```
get_market_snapshot          is_price_unusual           explain_grid_conditions
     │                            │                            │
  Simple pipe              Deterministic +              LLM synthesis
  No AI needed             domain baselines             Multi-source correlation
  Fast, cheap              Moderate complexity           More latency, more value
```

The interviewer should see: "This person knows when to use AI and when not to. They don't reach for the LLM by default."

---

## Decision 8: ISO Coverage

We cover three ISOs: **CAISO** (California), **ERCOT** (Texas), **PJM** (Mid-Atlantic/Midwest).

**Why these three:**
- Represent West, Texas, and East — geographically diverse
- Three largest by load
- Different market structures (ERCOT is uniquely isolated)
- Enough to show cross-ISO comparison without overwhelming scope

More ISOs can be added trivially — the architecture supports it. But three is enough to demonstrate the concept.

---

## What We Cut (and Why)

| Feature | Why We Cut It |
|---|---|
| Node-level pricing (MVP) | ISO averages tell the story for demo. Node-level adds complexity without demo value. |
| Historical event lookup | "What happened during Winter Storm Uri?" is better answered by Claude + web search. |
| Real-time alerts | Would need WebSocket/push infrastructure. Out of scope for request/response MCP. |
| Cross-ISO arbitrage | Interesting feature, but niche audience. Save for v2 if the demo lands. |
| Database persistence | No users to persist for. In-memory baselines refresh on startup. |
| Authentication | Demo backend is public. If it gets abused, we'll add a simple API key. |

---

## Summary: The Design Philosophy

This project demonstrates three things:

1. **Product judgment** — We started with "what's the right thing to build?" not "what's technically cool?" Every feature earns its place by answering a question Claude alone can't.

2. **Trade-off awareness** — We show a spectrum of approaches (pipe → deterministic → LLM) and can articulate why each tool uses the approach it does.

3. **Practical execution** — Function App, in-memory cache, three ISOs. Scoped tight enough to ship in days, extensible enough to grow if needed.

The demo isn't "I built an MCP server." It's "I can design AI systems that add real value, know when to use what, and make thoughtful trade-offs."

---

_Last updated: 2026-01-28_
