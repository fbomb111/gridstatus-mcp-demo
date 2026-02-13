# Grid Status MCP Server — Design Process

_Reasoning journey from concept to implementation. 10 threads challenging assumptions about MCP's value, arriving at the A/B framework._

---

## Starting Point

Building an MCP server for Grid Status as a technical demonstration. The initial spec outlined wrapping their `gridstatus` Python library in MCP tools. Our instinct: go beyond "competent MCP implementation" — show AI product thinking, not just technical execution.

---

## Thread 1: What's different about MCP?

Most MCPs are just API wrappers. We identified three levels of value:

| Level | Description | Value Add |
|-------|-------------|-----------|
| 1 | API wrapper | Natural language access (table stakes) |
| 2 | LLM-optimized tools | Tools designed for reasoning, smart summarization |
| 3 | Emergent capabilities | Queries that neither API nor LLM could answer alone |

## Thread 2: Does Claude even need MCP?

We tested Claude (without MCP, just web search) on grid questions. It performed well on knowledge questions — synthesized across 10 sources, cited appropriately, framed for user intent.

**Key insight:** For knowledge questions with published sources, web search handles it fine. MCP wins only when real-time data, computation, or baseline comparisons are needed.

## Thread 3: What questions pass the filter?

We identified questions that neither web search NOR raw API access could answer well:

| Persona | Question | Why It Needs More Than Raw Data |
|---------|----------|--------------------------------|
| Trader | "Is this price spike anomalous?" | Needs baseline comparison + judgment |
| Operator | "Is the grid stressed?" | Needs multiple signals + interpretation |
| Developer | "Which ISO has best storage economics?" | Needs cross-ISO comparison + synthesis |

## Thread 4: Pushback — does this actually need MCP?

**The test:** Does the LLM need to reason AFTER seeing the data, or just BEFORE?
- If LLM only parses intent → calls API → renders result → that's just a NL front-end
- If LLM needs to decide what to do based on intermediate results → that's MCP territory

**Refined insight:** MCP adds value for questions where the reasoning path can't be predetermined.

## Thread 5: Couldn't Claude + function-calling do the same?

**Honest answer:** Yes. MCP doesn't add capability — it adds reliability and discoverability. Standardized tool contracts mean less friction, fewer mistakes. The value is operational, not magical.

## Thread 6: Where does domain reasoning live?

The interesting distinction: smart client + dumb tools vs smart client + smart server.

**Example:** `explain_anomaly("ERCOT", "price")`
- **Dumb tool:** Client must specify "compare to 30-day rolling average, use 2-sigma, check load, wind, temp..."
- **Smart tool:** Server knows ERCOT — what "unusual" means, which factors matter. Client just says "explain."

The differentiation isn't MCP vs API — it's whether the server contributes domain intelligence.

## Thread 7: Three things MCP specifically enables

1. **Credentialed access** — User doesn't manage API keys; MCP server holds credentials
2. **Pre-baked orchestration** — Server always enriches with weather + load because it knows that's needed
3. **Private data / RAG** — Proprietary analysis, internal docs, customer-specific context

## Thread 8: What's the actual goal?

**Reframe:** "The point isn't to show off MCP. It's to show you know when to use what and why."

This led to the **A/B framework**:

| Approach | Description |
|----------|-------------|
| **A** | Deterministic orchestration/logic — no server LLM |
| **B** | Server-side synthesis — LLM contributes domain reasoning |

## Thread 9: Stress-testing the tool set

Problems identified: too many "just data" tools, no orchestration showcase, no demo narrative.

**Solution:** Consolidate — replace three separate data tools with one smart `get_grid_snapshot` that returns fuel mix + load + prices + highlights in one call.

## Thread 10: Refining the A/B distinction

**Critical realization:** The MCP server doesn't know what the user asked. It just gets tool calls.

**Division of labor:**

| Layer | Responsibility |
|-------|---------------|
| **MCP Server** | Data complexity + domain synthesis |
| **Client LLM** | User context + presentation |

MCP's value is abstraction of complexity + domain-aware synthesis. The server embeds knowledge about _which factors matter_ for each type of question.
