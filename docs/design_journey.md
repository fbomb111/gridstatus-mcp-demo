# GridStatus MCP Server — Design Journey

_This document captures the thinking behind the project — not what we built (see [architecture.md](architecture.md) for that), but the questions we asked, the tradeoffs we weighed, and the decisions we made. It's organized around the tensions that shaped the design._

---

## "Why MCP? Doesn't Claude already know about the grid?"

The initial spec said "wrap the gridstatus Python library in MCP tools." Before writing code, we tested the assumption: does this even need MCP?

We asked Claude (no MCP, just web search): _"What can you tell me about how California uses solar?"_ The answer was strong — synthesized across 10 sources, cited appropriately, framed for intent. For knowledge questions with published sources, web search handles it fine.

**So when does MCP actually win?**

| Category | Example | Why Web Search Fails |
|----------|---------|---------------------|
| Real-time specificity | "What's the fuel mix right now?" | Articles aren't live data |
| Computation | "What % of days had negative prices?" | Requires data + calculation |
| Baseline comparison | "Is today's solar penetration unusual?" | Needs historical context + current data |

We then stress-tested further: couldn't Claude with function-calling do the same thing? Honest answer: yes. MCP doesn't add capability — it adds standardized tool contracts, discoverability, and reliability. The value is operational, not magical. If we just wrap gridstatus in tools, we're competing with web search and losing.

**Landing:** Build tools that answer questions web search can't — real-time, computational, and baseline-comparative. Everything else is noise.

---

## "What should the tools do, and how much AI should they use?"

This was the most productive design thread. We started with 6 tools and a question: does each one need an LLM?

**The test:** Does the LLM need to reason _after_ seeing the data, or just _before_? If it only parses intent → calls API → renders result, that's just a natural language front-end. If it needs to decide what to do based on intermediate results, that's where tools earn their complexity.

This led to the **A/B framework** — two approaches, intentionally:

| Approach | When to use it | Example |
|----------|---------------|---------|
| **A: Deterministic** | Computation is well-defined, same input = same output | Price vs. baseline: compute sigma, percentile, verdict from template |
| **B: LLM synthesis** | Multiple sources need correlation, reasoning path can't be predetermined | "Why are prices high?" requires grid data + weather + causal reasoning |

We consolidated 6 tools to 3, each at a point on this spectrum. The tool descriptions guide Claude's chaining: _"If the price looks high, follow up with `is_price_unusual`"_ → _"If unusual, consider `explain_grid_conditions`."_ Three tools with chaining is more impressive than six standalone tools.

**The division of labor clarified itself:** The MCP server doesn't know what the user asked — it just gets tool calls. Server handles data complexity + domain synthesis. Client handles user context + presentation. Neither tries to do the other's job.

---

## "How much infrastructure for a demo that might go nowhere?"

This project could lead to a role or get abandoned after one conversation. Every infrastructure choice reflected that uncertainty.

**Thin client → hosted backend.** The MCP server is ~50 lines of TypeScript. All intelligence lives in a Python backend. This keeps the architecture legible — an interviewer sees domain logic in the backend, not buried in protocol plumbing.

**Function App first.** Single file, no container registry, ~$0 when idle. We chose it knowing cold starts were a tradeoff.

**Then we pivoted.** MCP's Streamable HTTP transport needs in-memory session state (transport instances, OAuth tokens). Azure Functions are stateless — each invocation is independent. Container Apps solved it: long-running process with scale-to-zero (same cost benefit), instances stay alive during connections. We lost `func publish` simplicity but gained correct protocol support.

**No Redis.** In-memory dict with TTL. Grid data changes every ~5 minutes, we're not handling concurrent users at scale.

**CAISO only.** Originally planned 3 ISOs (CAISO, ERCOT, PJM). Cut to one for depth over breadth — California's solar + batteries = richest data story. Adding more ISOs is trivial architecturally.

**Landing:** Start as minimal as possible, pivot only when the protocol demands it.

---

## "How much of the MCP protocol to implement?"

This is a demo for a company evaluating whether MCP is the right interface for their data. Showing just tools is 30% of the protocol.

We implemented: **Tools** (3), **Resources** (2 — static overview + dynamic live conditions), **Prompts** (3 — grid briefing, investigate price, interactive tutorial), **Logging**, **Progress** (5-stage on the explain tool), **Annotations** (`readOnlyHint`, `openWorldHint`), **Completions** (ISO autocomplete), and **Notifications** (delayed tool registration + `tools/list_changed`).

We skipped: Sampling, Elicitation, Roots, Tasks — no client support in Claude Desktop yet.

**Dual transport:** stdio for local dev (with extra demos like delayed registration), Streamable HTTP for remote production (with OAuth). Both share the same tool/resource/prompt definitions.

---

## "OAuth 2.1 — the biggest unplanned feature"

**Original plan:** No authentication. Public demo backend.

**What happened:** The MCP spec requires OAuth 2.1 for remote HTTP transport. Claude Desktop expects to discover metadata and run a full authorization flow before making requests. You can't skip it.

**The deeper realization:** OAuth isn't just spec compliance. It's the "user brings their own API key" pattern that makes MCP servers viable as products. GridStatus uses API keys. An MCP server that hardcodes one key is a toy. One that lets each user provide their own — and never stores it in plain text — is a real product pattern.

**What we built (< 500 lines):**
- **API key → OAuth bridge** — user pastes key in browser form → server encrypts it into an opaque token (AES-256-GCM) → Claude sends the token on every request → server decrypts and forwards the key. Raw key never stored.
- **PKCE required** (S256), refresh token rotation, 5-minute single-use authorization codes
- **"Skip for now" button** — anonymous users get a valid session but no API credentials. 3 public tools work; the 4th stays hidden. This enabled the tutorial to demonstrate the "unlock" experience.

The anonymous flow required threading a magic value (`__anonymous__`) through the entire token pipeline — encryption, storage, validation, middleware. But it completed the onboarding story: try free → see value → upgrade when ready.

What started as spec compliance became the most technically interesting part of the project.

---

## "How do you teach MCP by using MCP?"

The demo needed to be self-guided. We built an interactive tutorial as an MCP prompt — select it from Claude Desktop's "+" menu and Claude walks you through a 6-step exploration: market snapshot (no AI) → price analysis (statistics) → AI explanation (synthesis) → authentication → free exploration.

Three iterations refined the UX:

1. **Example questions were duplicates** — "What's happening on the grid?" vs "Show me current conditions" is the same question. Fixed: each option demonstrates a different query type (broad overview vs specific data point).

2. **Explanations were in the wrong place.** We designed a pattern: Context (create curiosity) → Ask (example questions) → Observe (walk through results) → Insight (NOW explain how it works — the user has context) → Transition (tease the next step). Always explain _after_ showing, not before.

3. **Developer jargon in a user tutorial** — "the unlock pattern," "no 403 errors." Reframed in product terms: "3 free tools → authenticate → 4th unlocks automatically."

We also built a Desktop Extension (`.mcpb`) — a zip archive with bundled server + manifest. Double-click to install, API key stored in OS keychain, zero runtime dependencies. This became the primary install path for non-developers.

---

## "Should agents see tools they can't use?"

Three public tools worked. We added a 4th requiring an API key. The question: how does the agent discover a tool that's only available after authentication?

**Take 1 — Always visible, auth-gated.** Register all tools; the 4th returns "authentication required" without credentials. The web-developer instinct: expose the endpoint, let auth handle access.

**Take 2 — Hidden, then revealed.** The pushback: in MCP, the tool list _is_ the agent's understanding of its capabilities. Listing a tool says "you can do this." Having the agent discover through trial and error that it can't is a poor experience. Better: register only usable tools, then add the 4th after authentication via `tools/list_changed`.

The distinction is philosophical:
- **API-first:** Tool list is documentation. Show everything, gate at runtime.
- **Agent-first:** Tool list is the capability set. Only show what works.

**We built Take 2.** Two-tier registration, OAuth callback triggers the 4th tool.

**Take 3 — Back to always visible.** After deploying, `tools/list_changed` notifications weren't reaching the client reliably. The OAuth callback fires during an HTTP response — outside the MCP transport context — so the notification was lost. Three attempts at dynamic registration, three different failure modes.

The 4th tool's handler already validates the key and returns a clear, actionable error. The tutorial checks for the tool to decide which path to take — which only works if it's always registered.

**The lesson:** Agent-first is the right north star for MCP design. But the ecosystem isn't there yet — `tools/list_changed` support is inconsistent, and the interaction between OAuth and MCP transport contexts is underspecified. When the protocol matures, dynamic tool sets will be the correct pattern. Today, upfront registration with clear error messages is the pragmatic choice.

Sometimes the first instinct is right for the wrong reasons.

---

## What I'd do differently

**Azure endpoint confusion was avoidable.** Microsoft has three endpoint patterns for AI services (`.services.ai.azure.com`, `.cognitiveservices.azure.com`, `.openai.azure.com`) and they're not interchangeable. We hit two 404s before finding the right one. Better docs would help, but so would verifying the endpoint with a curl before writing the client.

**Should have started with Container Apps.** The Function App → Container Apps pivot was predictable in hindsight — MCP's HTTP transport is inherently stateful. Starting with the right compute model would have saved a day.

**For production, the server needs:** Per-session tool registration (current `onAuthenticated` is per-server-lifecycle), Redis for shared caching across instances, rate limiting on the OAuth endpoints, and proper observability (currently just console.log).

**What worked well:** The A/B framework (deterministic vs synthesis) gave every design decision a clear test. The tutorial-as-prompt idea made the demo self-explanatory. And building the OAuth server from scratch — while unplanned — turned out to be the strongest technical showcase in the project.
