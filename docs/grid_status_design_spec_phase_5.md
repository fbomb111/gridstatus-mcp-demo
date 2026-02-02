# Grid Status MCP Server — Phase 5: Tutorial Polish & Anonymous OAuth

_The journey from "the tutorial works" to "the tutorial teaches well" — and the discovery that authentication UX is its own design challenge. Covers iterative prompt refinement, a UX pattern for interactive tutorials, and the anonymous OAuth flow that made the onboarding story complete._

---

## Starting Point

Phase 4 ended with a working interactive tutorial: 6 steps, step-by-step pacing, educational about the AI spectrum. It worked — Claude walked users through each tool, explained what was happening, and wrapped up with a recap.

But "it works" and "it teaches well" are different things. The tutorial text had problems that only became visible after running it repeatedly in Claude Desktop.

---

## Problem 1: Question Diversity

**The symptom:** Steps 2 and 3 each offered two example questions, but both options in each step were just restating the same fundamental question.

Step 2: "What's happening on the California grid?" vs "Show me current grid conditions" — same question, different words.

Step 3: "Is the current price unusual?" vs "Is that price normal?" — identical question.

**The fix:** Make each option genuinely different. Step 2 now offers a broad overview ("What's happening on the California grid?") vs a specific query ("How much solar is California generating right now?"). Step 3 offers a standalone check ("Is that price normal?") vs a comparative one ("How does the current price compare to yesterday?").

**The principle:** Example questions in a tutorial should demonstrate the range of what's possible, not just rephrase the same intent.

---

## Problem 2: Narrative Duplication

**The symptom:** Step 4 (the AI explanation tool) had a setup section that explained the weather data + AI synthesis pipeline, and then the post-results section also explained it. The user got the same information twice.

**The deeper question:** Where should "how it works" explanations go — before or after the user sees the data?

**The answer:** After. Always after. This led to a UX pattern we applied across all 6 steps.

---

## Decision 1: The Tutorial UX Pattern

We designed a consistent pattern for every tutorial step:

```
Context  → Brief setup. Creates curiosity, not explanation. ("So far we've seen
           the data and the stats. Now let's find out why.")
Ask      → Prompt the user with example questions.
Observe  → Walk through the results. Point out key metrics and structure.
Insight  → NOW explain how it works. The user has seen the data, so the
           explanation has context. ("This tool pulled in live weather data
           for three California cities, combined it with the grid data you
           already saw, and fed everything to an AI analyst.")
Transition → Tease the next step. ("We have the what. Now let's find out the why.")
```

**Why this works:** The setup creates a question ("why is the price what it is?"), the tool call provides the answer, and the insight explains the mechanism. The user is never told how something works before they've seen it work.

**Before:** "This tool fetches weather data and uses AI to synthesize an explanation. Try asking: Why are prices like this?" (User doesn't care yet — they haven't seen the data.)

**After:** "So far we've seen the data and the stats. Now let's find out why." → tool runs → "This tool pulled in live weather data for Sacramento, LA, and San Francisco, combined it with the grid data you already saw, and fed everything to an AI analyst. Then I added a second layer of interpretation — two AIs, one answer."

---

## Problem 3: MCP Jargon in a User Tutorial

**The symptom:** Step 5 (authentication) originally talked about "the unlock pattern" and how "the agent only sees what it can actually use — no 403 errors." This is MCP developer language. Most users don't know what MCP is, and they shouldn't need to.

**The fix:** Reframed in product terms: "You start with 3 free tools that work out of the box. Authenticate, and a 4th unlocks automatically — no restart, no configuration."

**The principle:** The tutorial is for people who use Claude Desktop, not people who build MCP servers.

---

## Problem 4: Step 5 Was Passive

**The symptom:** Step 5 detected whether the 4th tool was available and either demoed it or explained what it was. But it never offered the user a way to actually unlock it. The authentication step was informational, not actionable.

**The question that surfaced:** Can we make the unlock happen during the tutorial?

This question led to the biggest technical investigation of Phase 5.

---

## Decision 2: Understanding the Authentication Architecture

We traced the full OAuth flow to understand what was possible:

**HTTP transport (remote users):**
- Claude Desktop connects to `/mcp`
- Server returns 401 with `WWW-Authenticate` header
- Claude Desktop auto-initiates OAuth: discovers metadata, registers client, opens browser
- User pastes API key in browser form
- Server issues encrypted token
- `onAuthenticated()` callback fires → registers 4th tool → `sendToolListChanged()`
- Claude Desktop discovers the new tool

**Critical constraint:** OAuth only triggers at connection time. There is no `server.requestAuthorization()` in the MCP SDK. The server cannot ask the client to re-authenticate mid-session.

**stdio transport (local developers):**
- API key comes from `GRIDSTATUS_API_KEY` env var at startup
- If present, 4th tool is registered immediately
- If absent, no way to unlock mid-session

**What this means:** With the Phase 4 architecture (auth required on connect), HTTP users _always_ have all 4 tools before the tutorial starts. The "unlock" experience Step 5 described was impossible to demonstrate — the user already had everything.

---

## Decision 3: Anonymous OAuth — The Skip Button

**The insight:** The OAuth form could have a "Skip" button. Instead of requiring an API key, let users skip authentication and get an anonymous token. This anonymous token is valid for connection (passes the 401 check) but doesn't provide API credentials (so the 4th tool stays hidden).

**The user journey becomes:**

```
1. INSTALL:   Settings > Connectors > Add custom connector > paste server URL
2. CONNECT:   OAuth form opens in browser → click "Skip for now" → 3 tools
3. TUTORIAL:  Steps 1-4 explore live grid data with public tools
4. UNLOCK:    Step 5 → get a free key at gridstatus.io → restart Claude Desktop
              → OAuth form opens again → enter key this time → 4th tool appears
```

**Implementation details:**

1. **Anonymous token constant:** `ANONYMOUS_API_KEY = "__anonymous__"` — a magic value that flows through the entire token pipeline (encrypted, stored in refresh tokens, validated) but is recognized as "no real credentials."

2. **Skip button HTML:** `<button type="submit" name="action" value="skip" formnovalidate>` — the `formnovalidate` attribute bypasses the `required` validation on the API key input field.

3. **Conditional tool unlock:** `onAuthenticated()` callback only fires when `authCode.apiKey !== ANONYMOUS_API_KEY`. Anonymous users get a valid session but the 4th tool is never registered.

4. **HTTP middleware:** Anonymous tokens pass the 401 check (valid connection) but `currentApiKey` is set to `undefined`, so the 3 public tools work normally while the authenticated tool stays unavailable.

5. **Restart persistence:** Claude Desktop preserves conversations across restarts. The tutorial can tell users "restart and come back — this conversation will still be here."

**Files changed:**
- `oauth-server.ts` — Skip button, anonymous token handling, conditional callback
- `http.ts` — Anonymous token detection in auth middleware
- `prompts.ts` — Step 5 rewritten with actionable unlock instructions

---

## Decision 4: Installation UX — Connectors vs Config Files

**The discovery:** While designing the unlock flow, we realized the README's install instructions ("add to `claude_desktop_config.json`") were developer-centric. Non-technical users shouldn't edit JSON config files.

**What we found:** Claude Desktop has a built-in "Custom Connectors" UI: Settings → Connectors → "Add custom connector" → paste URL. This is the intended way to add remote MCP servers — the JSON config is for local/stdio servers.

Per [Claude Help Center](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers): "Claude Desktop will not connect to remote servers that are configured directly via `claude_desktop_config.json`."

**The README update:** Connectors became the primary install method. JSON config was moved to a "For developers" section for local stdio setup only.

---

## Decision 5: Tutorial Text — The Final Version

After all the changes, the tutorial follows a consistent structure:

**Step 1 (Welcome):** Lay of the land — 3 tools, 1 premium, 2 resources, 3 prompts. Point to the "+" menu.

**Step 2 (Market Snapshot):** First tool call. Note about Claude Desktop's "Allow" permission prompt. Walk through prices, demand, generation mix. Insight: raw data, no AI, same query always gives the same answer.

**Step 3 (Price Analysis):** Second tool call. Explain sigma, percentile, severity. Insight: still no AI — pure statistics against baselines. Important: do NOT speculate about why (that's Step 4).

**Step 4 (AI Explanation):** Third tool call. Insight (after results): this tool pulled weather data for three California cities, combined it with grid data, and fed it to an AI analyst. Then Claude added a second interpretation layer — two AIs, one answer.

**Step 5 (Unlock):** Check for 4th tool. If present: demo it. If absent: explain it's because they clicked Skip. Give unlock instructions (get key → restart → enter key). Graceful skip: "No rush — say Next to continue."

**Step 6 (Explore):** Other prompts, resources, natural language. Recap all 4 tools. "Have fun exploring the grid."

---

## Technical Note: Single-User Demo Server

The anonymous OAuth design has a simplification worth documenting. The `onAuthenticated` callback fires once per server lifecycle, not per client. After any user authenticates with a real key, the 4th tool is registered for all subsequent connections (including anonymous ones).

For a single-user demo, this is fine. For a multi-user production server, you'd need per-session tool registration. That's a future concern — the MCP spec's session management is still evolving.

---

## Decision 6: Desktop Extension (.mcpb) — The Real Answer

After building the anonymous OAuth skip flow, we discovered the right solution was one layer higher: **Desktop Extensions**.

**The problem with the OAuth path:** Even with the skip button, the install flow required users to navigate Settings → Connectors → paste URL → complete OAuth form. Workable, but not one-click.

**What Desktop Extensions provide:**
- `.mcpb` is a zip archive containing a bundled MCP server + manifest
- Double-click to install — Claude Desktop handles everything
- `user_config` fields with `sensitive: true` store API keys in the OS keychain
- Node.js ships with Claude Desktop — zero runtime dependencies for users

Per the [MCPB README](https://github.com/modelcontextprotocol/mcpb): "We recommend implementing MCP servers in Node.js rather than Python to reduce installation friction. Node.js ships with Claude for macOS and Windows."

**What we built:**

The `.mcpb` packages our existing stdio transport (`index.ts`) with a `manifest.json` that declares an optional API key:

```json
"user_config": {
  "api_key": {
    "type": "string",
    "title": "GridStatus API Key",
    "description": "Optional — unlocks historical data across all 7 US power markets",
    "sensitive": true,
    "required": false
  }
}
```

The manifest injects the key as an env var: `"GRIDSTATUS_API_KEY": "${user_config.api_key}"`. Our `index.ts` already reads this — no code changes needed for the core logic.

**The user journey becomes:**

```
1. Download gridstatus.mcpb → double-click → Install
2. Claude Desktop prompts "API Key (optional)" → skip or enter
3. 3 or 4 tools available immediately
4. Want to unlock later? Settings → Extensions → GridStatus → add key → restart
```

**What stays vs what's superseded:**
- ✅ `.mcpb` extension — primary install path for non-developers
- ✅ Remote HTTP + OAuth (with skip button) — alternative for Connectors users
- ✅ Local stdio with `start.sh` — developer iteration workflow
- ❌ JSON config with remote URL — removed from README (Connectors replaced it)

**Build process:** `bash scripts/build-mcpb.sh` compiles TypeScript, prunes to production deps, strips HTTP/auth files from dist, and zips as `.mcpb`. Output: ~4MB self-contained extension.

---

## Summary: What Phase 5 Added

| Aspect | Phase 4 State | Phase 5 Final |
|---|---|---|
| Tutorial questions | Duplicate phrasing per step | Diverse options showing query range |
| Tutorial structure | Inconsistent setup/payoff | Context → Ask → Observe → Insight → Transition |
| Tutorial language | MCP jargon in places | Product language throughout |
| Primary install | Edit JSON config file | Download .mcpb → double-click → Install |
| API key storage | Env var or OAuth token | OS keychain via Desktop Extension |
| Authentication UX | Required on connect (always 4 tools) | Optional at install; add later in settings |
| OAuth form | API key required | "Skip for now" button with anonymous tokens |
| Secondary install | N/A | Connectors + OAuth (with skip button) |
| Step 5 (tutorial) | Passive explanation | Actionable: get key → add in extension settings → restart |

---

_Last updated: 2026-02-02_
