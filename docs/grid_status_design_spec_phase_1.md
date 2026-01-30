# Grid Status MCP Server — Design Process

_A running document capturing the reasoning journey from concept to implementation. This intentionally shows the messy back-and-forth, not just polished conclusions._

---

## Starting Point

**Context:** Building an MCP server for Grid Status as a technical demonstration for a potential role. The provided spec outlined wrapping their open-source `gridstatus` Python library in MCP tools.

**Initial spec scope:** Basic tools (get_fuel_mix, get_load, get_prices, etc.) that expose grid data to LLMs.

**Initial instinct:** Go beyond "competent MCP implementation" — show AI product thinking, not just technical execution.

---

## Reasoning Thread #1: What's actually different about MCP?

**Starting observation:** "A lot of the MCPs out there right now are just APIs wrapped up as a tool set for agents."

This prompted the question: what's the _actual_ value of MCP over a traditional API?

**First attempt at an answer — three levels:**

| Level | Description           | Value Add                                           |
| ----- | --------------------- | --------------------------------------------------- |
| 1     | API wrapper           | Natural language access (table stakes)              |
| 2     | LLM-optimized tools   | Tools designed for reasoning, smart summarization   |
| 3     | Emergent capabilities | Queries that neither API nor LLM could answer alone |

This felt right conceptually, but needed stress-testing.

---

## Reasoning Thread #2: Does Claude even need MCP for this?

**The challenge:** If we're claiming MCP enables special capabilities, we should test whether Claude can already do those things.

**The experiment:** Asked Claude (without MCP, just web search): _"I'm thinking about installing solar in California. What can you tell me about how the grid uses solar?"_

**Result:** Claude's response was strong:

- Recognized underlying intent (install decision, not just curiosity)
- Searched for current information
- Synthesized across 10 sources (duck curve, curtailment stats, battery growth, NEM 3.0)
- Framed for the user's use case
- Cited appropriately
- Offered relevant follow-ups

**The uncomfortable realization:** For _knowledge questions_ — conceptual understanding with supporting stats from published sources — web search handles it fine.

**Refined question:** What can MCP do that Claude + web search genuinely _can't_?

**Answer — MCP wins when:**

| Category               | Example                                          | Why Web Search Fails                       |
| ---------------------- | ------------------------------------------------ | ------------------------------------------ |
| Real-time specificity  | "What's the fuel mix RIGHT NOW?"                 | Articles aren't live data                  |
| Granular queries       | "What were prices at 3pm yesterday?"             | Too specific for any article               |
| Computation            | "What % of days this month had negative prices?" | Requires data + calculation                |
| Comparison to baseline | "Is today's renewable penetration unusual?"      | Requires historical context + current data |

**Key insight:** If we just wrap gridstatus in tools, we're competing with web search. We need to focus on questions web search _can't_ answer.

---

## Reasoning Thread #3: Who are we building for, and what do they actually ask?

Grid Status serves: energy traders, asset operators, utilities, developers, data scientists.

We tried to generate realistic questions for each persona that neither web search NOR raw API access could answer well.

**Example questions that passed the filter:**

| Persona   | Question                                          | Why It Needs More Than Raw Data         |
| --------- | ------------------------------------------------- | --------------------------------------- |
| Trader    | "Is this ERCOT price spike anomalous?"            | Needs baseline comparison + judgment    |
| Operator  | "Is the grid stressed? Should I expect dispatch?" | Needs multiple signals + interpretation |
| Developer | "Which ISO has best storage economics right now?" | Needs cross-ISO comparison + synthesis  |

**But then came the next pushback...**

---

## Reasoning Thread #4: Pushback on "MCP answers"

**The challenge:** For the question "Is there seasonality in forecast error for CAISO wind?", the proposed MCP answer was "Computed monthly/hourly patterns + visualization description."

**The pushback:** "I don't think you necessarily need MCP for that. You could have a natural language front end that just captures intent and calls an API and then surfaces the data in a widget."

**This was the right challenge.** It forced a sharper test:

**The Test:** Does the LLM need to reason AFTER seeing the data, or just BEFORE?

- If LLM only parses intent → calls API → renders result → that's just good UX with an NL front-end
- If LLM needs to decide what to do next based on intermediate results → that might need MCP

**Examples re-evaluated:**

| Question                                       | Needs MCP? | Why                                            |
| ---------------------------------------------- | ---------- | ---------------------------------------------- |
| "What's the fuel mix in CAISO?"                | **No**     | Predefined query → render                      |
| "Is there seasonality in wind forecast error?" | **No**     | Known computation path                         |
| "Why are prices negative right now?"           | **Yes**    | Multi-source synthesis, narrative construction |
| "Is this unusual?"                             | **Yes**    | Judgment about what to compare                 |
| "What's interesting about the grid today?"     | **Yes**    | Open-ended, LLM decides what matters           |

**Refined insight:** MCP adds value for questions where the reasoning path can't be predetermined.

---

## Reasoning Thread #5: But couldn't Claude + function-calling do the same thing?

**The challenge:** "I still don't see the difference between a FE chatbot and MCP. If I asked Claude a reasoning question, and it had access to a bunch of these APIs, it could reason on its own about 'unusual activity' before forming a response, right?"

**Honest answer:** Yes. Claude with function-calling to APIs can do identical reasoning. MCP doesn't add capability.

**So what IS MCP's value?**

**Answer:** Reliability and discoverability, not capability.

| Approach                  | How It Works                             | Downside                          |
| ------------------------- | ---------------------------------------- | --------------------------------- |
| Claude + raw API docs     | Claude reads docs, figures out endpoints | Error-prone, slow                 |
| Claude + function-calling | Pre-defined functions                    | Works, but custom per integration |
| Claude + MCP              | Standardized tool contracts              | Consistent interface              |

**Framing:** "MCP is just the interface. The 'exposure.' Claude doesn't have to know the API signatures beforehand. MCP standardizes this into agent-first contracts it can understand."

**Conclusion:** MCP's value is operational (less friction, fewer mistakes) not magical (new capabilities).

---

## Reasoning Thread #6: Where does domain reasoning live?

**The next thread:** "It has something to do with the implementation of the compute. If you just need compute, an API can do that. But if you need backend reasoning on how to execute the compute before it runs, that seems more MCP-ish."

**This is the interesting distinction:**

| Model                      | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| Smart client, dumb tools   | Generic LLM does all reasoning, tools just fetch/compute |
| Smart client, smart server | Domain expertise embedded in MCP tools themselves        |

**Example: `explain_anomaly(iso="ERCOT", metric="price")`**

_Dumb tool version:_
Client LLM must specify: "compare to 30-day rolling average, use 2σ threshold, check load, wind, temperature, gas prices..."

_Smart tool version:_
Server knows ERCOT: what "unusual" means, which factors matter, how to explain. Client just says "explain this anomaly."

**The implication:** The differentiation isn't MCP vs API. It's whether the _server_ contributes domain intelligence or just pipes data.

**This is the thread we're now pulling on.**

---

## Reasoning Thread #7: Three things MCP can do that client LLM + public APIs can't

We pushed further on _why_ MCP specifically, not just good tooling.

**1. Credentialed Access**

Claude in chat can't hold API keys. User would need to sign up for gridstatus.io, weather API, manage auth. MCP server holds credentials, user just asks questions.

**2. Pre-baked Orchestration**

Client LLM approach: User asks about prices → LLM reasons "should check weather" → calls weather → reasons "should check load" → calls load → synthesizes.

MCP approach: User asks about prices → Server _always_ enriches with weather, load, baseline because it knows that's what you need → returns enriched response.

Domain logic is embedded: "when someone asks about X, always fetch Y and Z too."

**3. Private Data / RAG**

Proprietary analysis, internal docs, curated "what happened during past events" corpus, customer-specific context. Claude can't access without tooling.

---

## Reasoning Thread #8: What's the goal of this project?

**Key reframe:** "The point isn't to show off MCP. The point is to show you know when to use what and why."

A demo with both approaches — and articulating the tradeoffs — is stronger than going all-in on either.

This led to the A/B framework:

| Approach | Description                                              |
| -------- | -------------------------------------------------------- |
| **A**    | Deterministic orchestration/logic — no server LLM        |
| **B**    | Server-side synthesis — LLM contributes domain reasoning |

**The story this tells:** "I built some tools as straightforward data enrichment because that's all they need — adding LLM overhead would be wasteful. But for tools like `explain_anomaly`, the reasoning can't be predetermined. That's where server-side intelligence earns its keep."

---

## Reasoning Thread #9: Stress-testing the tool set

We audited each proposed tool against: customer value, shows AI knowledge, shows tradeoff, MVP feasible.

**Problems identified:**

1. Too many "just data" tools (`get_fuel_mix`, `get_prices`, `get_load`) — necessary but don't differentiate
2. `whats_interesting` is a trap — high risk of being gimmicky, cut it
3. Missing the orchestration showcase — no tool demonstrates "always enrich with X"
4. No clear demo narrative — tools don't build toward a story

**Solution: Consolidate and focus**

Replace three separate data tools with one smart tool: `get_grid_snapshot(iso)` — returns fuel mix + load + prices + reserve margin + weather in ONE call. Shows orchestration pattern.

---

## Reasoning Thread #10: Refining the A/B distinction

**Initial framing:** Approach B = "needs server-side LLM for reasoning"

**Pushback:** "A client-side LLM could reason this if it has all the data. The point is you don't want to make the client scan X rows and 3 API calls to figure that out."

**The key insight:** MCP is abstraction of complexity + domain-aware synthesis.

**Critical realization:** The MCP server doesn't know what the user asked. It just gets `explain_anomaly("ERCOT", "price")`.

This clarifies the division of labor:

| Layer          | Responsibility                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| **MCP Server** | Data complexity + domain synthesis ("I scanned 3 APIs, computed baselines, here are the 3 factors explaining this") |
| **Client LLM** | User context + presentation ("User asked casually, so I'll present conversationally")                               |

**Example response from `explain_anomaly`:**

```json
{
  "anomaly": {
    "metric": "price",
    "current": 87,
    "baseline": 45,
    "sigma": 2.8
  },
  "contributing_factors": [
    {
      "factor": "temperature",
      "detail": "102°F, driving AC load to 68GW",
      "impact": "high"
    },
    {
      "factor": "wind_underperformance",
      "detail": "18% generation vs 26% forecast",
      "impact": "medium"
    },
    {
      "factor": "supply_outage",
      "detail": "2 gas plants on unplanned outage, -1.2GW",
      "impact": "medium"
    }
  ],
  "summary": "Price elevation driven primarily by heat-driven demand surge combined with wind underperformance and reduced supply."
}
```

Client LLM then contextualizes:

- Casual "why?" → conversational summary
- Analyst wanting detail → structured breakdown
- Follow-up question → client knows to probe further

**Refined framing:** MCP's value isn't "reasoning the client can't do." It's "abstraction of complexity + domain-aware synthesis." The server embeds domain knowledge about _which factors matter_ for this type of question.

---

## Final Tool Set: 6 Tools

| #   | Tool                           | Approach          | Purpose                           |
| --- | ------------------------------ | ----------------- | --------------------------------- |
| 1   | `list_isos()`                  | Utility           | Discovery                         |
| 2   | `get_grid_snapshot(iso)`       | A - Orchestration | "One call gets full picture"      |
| 3   | `check_anomaly(iso, metric)`   | A - Domain logic  | "I know what 'normal' looks like" |
| 4   | `compare_isos(metric)`         | A - Aggregation   | "Cross-market view, structured"   |
| 5   | `explain_conditions(iso)`      | B - Synthesis     | "I synthesize the 'so what'"      |
| 6   | `explain_anomaly(iso, metric)` | B - Synthesis     | "I diagnose the 'why'"            |

**Approach A tools:** Server does fetch + enrichment + domain logic. Returns structured data. Client LLM narrates.

**Approach B tools:** Server does fetch + compute + domain synthesis. Returns structured insights + summary. Client LLM contextualizes for user.

---

## Demo Conversation Flow

```
User: "What grids can you access?"
→ list_isos()
→ Setup context

User: "What's happening in ERCOT right now?"
→ get_grid_snapshot("ERCOT")
→ Structured data, client narrates
   [Shows Approach A: orchestration]

User: "Is that price unusual?"
→ check_anomaly("ERCOT", "price")
→ {value: 87, baseline: 45, sigma: 2.8, is_anomalous: true}
→ Client: "Yes, 2.8σ above typical for this hour."
   [Shows Approach A: deterministic domain logic]

User: "Why?"
→ explain_anomaly("ERCOT", "price")
→ Server synthesizes contributing factors + summary
→ Client contextualizes for casual question
   [Shows Approach B: domain synthesis]

User: "How does this compare to other grids?"
→ compare_isos("price")
→ Structured comparison
   [Shows Approach A for comparative queries]
```

This demonstrates: data access, orchestration, deterministic logic, server synthesis, and tradeoff awareness.

---

## MVP Feasibility

| Requirement          | Difficulty | Notes                                                       |
| -------------------- | ---------- | ----------------------------------------------------------- |
| gridstatus library   | Easy       | Well documented                                             |
| Weather API          | Easy       | OpenMeteo free, no key                                      |
| Baseline computation | Medium     | Store rolling averages                                      |
| Server-side LLM      | Medium     | Adds complexity                                             |
| RAG over events      | Hard       | **Cut for MVP** — already demonstrated this skill elsewhere |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Client LLM                             │
│              (Claude, via MCP protocol)                     │
│                                                             │
│   Responsibilities:                                         │
│   - Parse user intent                                       │
│   - Choose which tools to call                              │
│   - Contextualize responses for user's tone/needs           │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Protocol
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server                               │
│                                                             │
│   Responsibilities:                                         │
│   - Abstract data complexity (multiple APIs → one call)     │
│   - Embed domain knowledge (what's "normal", what matters)  │
│   - Synthesize insights (contributing factors, summaries)   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Orchestration Layer                       │ │
│  │  - "For snapshots, always include weather"            │ │
│  │  - "For anomalies, compute baseline first"            │ │
│  │  - "For explanations, check these N factors"          │ │
│  └───────────────────────────────────────────────────────┘ │
│                          │                                  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Data Sources (credentialed)              │ │
│  │  - gridstatus library / API                           │ │
│  │  - Weather API (OpenMeteo)                            │ │
│  │  - Stored baselines                                   │ │
│  └───────────────────────────────────────────────────────┘ │
│                          │                                  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │         Server-side LLM (for Approach B tools)        │ │
│  │  - Synthesize explanations from structured data       │ │
│  │  - Rank factor importance                             │ │
│  │  - Generate narrative summaries                       │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Open Questions

- [ ] Hosting: Azure Functions? Container? What's the demo experience?
- [ ] Baseline storage: Pre-compute and cache? Compute on-demand?
- [ ] Server-side LLM: Which model? How to keep costs reasonable?
- [ ] How much energy domain knowledge do we need to embed?

---

## Decision Log

| Date       | Decision                                                               | Rationale                                                      |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| 2025-01-23 | Focus on Level 2-3 capabilities over API wrapper                       | Differentiation; demonstrates AI product thinking              |
| 2025-01-23 | Position as "AI analyst" not "data access"                             | Competes on capability, not just convenience                   |
| 2025-01-23 | MCP value = reliability/discoverability, not capability                | Honest assessment after pushback                               |
| 2025-01-23 | Explore "domain-smart tools" as differentiation                        | Server-side intelligence, not just data pipes                  |
| 2025-01-23 | A/B framework: deterministic vs synthesis tools                        | Shows tradeoff awareness, not just one approach                |
| 2025-01-23 | Division of labor: server = complexity + domain, client = user context | Clearer mental model for what belongs where                    |
| 2025-01-23 | Cut RAG for MVP                                                        | Already demonstrated elsewhere, adds scope without new insight |
| 2025-01-23 | Consolidate data tools into `get_grid_snapshot`                        | One smart tool > three dumb tools                              |

---

---

## Epilogue: What Survived and What Changed

The reasoning in this document held up well through implementation. Key outcomes:

- **The A/B framework survived intact.** It became the core narrative of the demo — three tools showing a spectrum from "no AI" to "full LLM synthesis." This distinction resonated in every review.
- **6 tools became 3.** The proposed set (list_isos, get_grid_snapshot, check_anomaly, compare_isos, explain_conditions, explain_anomaly) was consolidated: snapshot + price analysis + explain. Fewer tools, each more polished.
- **`list_isos()` and `compare_isos()` were cut.** We scoped to CAISO only — depth over breadth. One ISO done well demonstrates the pattern; multi-ISO is just more of the same.
- **MCP's value = reliability + discoverability** (Thread #5) proved exactly right. The real differentiator ended up being OAuth 2.1 and the "user brings their own key" pattern — operational value, not magical capability.
- **Open questions were all resolved.** Tool definitions: see `technical_spec.md`. Baselines: hardcoded hourly + rolling 7-day. LLM: gpt-4.1 via Managed Identity. Demo script: built as an interactive tutorial prompt inside the MCP server itself. Hosting: Azure Container Apps.

_The design reasoning above reflects the thinking process at project start. It's preserved as-is because the journey matters as much as the destination._
