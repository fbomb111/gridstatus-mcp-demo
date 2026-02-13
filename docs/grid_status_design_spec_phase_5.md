# Grid Status MCP Server — Phase 5: Tutorial UX & Desktop Extensions

_From "the tutorial works" to "the tutorial teaches well" — plus anonymous OAuth and Desktop Extension packaging._

---

## Tutorial Refinements

Three problems surfaced after repeated testing:

1. **Duplicate questions** — Step options were restating the same intent. Fixed: each option now demonstrates a different query type (broad overview vs specific data point).

2. **Narrative duplication** — "How it works" explanations appeared both before and after tool calls. Fixed with a consistent UX pattern:

   ```
   Context  → Brief setup, creates curiosity
   Ask      → Prompt with example questions
   Observe  → Walk through results
   Insight  → NOW explain how it works (user has context)
   Transition → Tease the next step
   ```

3. **MCP jargon** — Developer language ("the unlock pattern", "no 403 errors") in a user tutorial. Reframed in product terms: "3 free tools → authenticate → 4th unlocks automatically."

---

## Anonymous OAuth — The Skip Button

**Problem:** With OAuth required on connect, HTTP users always had all 4 tools before the tutorial started. The "unlock" experience was impossible to demonstrate.

**Solution:** OAuth form has a "Skip for now" button. Anonymous users get a valid session token (passes 401 check) but no API credentials — the 4th tool stays hidden.

**Implementation:** `ANONYMOUS_API_KEY = "__anonymous__"` flows through the entire token pipeline. The `onAuthenticated` callback only fires for real keys. `formnovalidate` on the skip button bypasses input validation.

**User journey:** Add connector → OAuth opens → Skip → 3 tools → tutorial → get API key at gridstatus.io → restart → enter key → 4th tool unlocks.

---

## Desktop Extension (.mcpb)

After building the OAuth skip flow, we discovered a better install path: **Desktop Extensions**.

- `.mcpb` is a zip archive with bundled MCP server + manifest
- Double-click to install — zero config
- `user_config` with `sensitive: true` stores API key in OS keychain
- Node.js ships with Claude Desktop — no runtime dependencies

The manifest declares an optional API key field and injects it as an env var. Our `index.ts` already reads it — no code changes needed.

**Install paths (final):**
- **Primary:** `.mcpb` double-click install (non-developers)
- **Alternative:** Connectors + OAuth with skip button (remote users)
- **Dev:** Local stdio with `start.sh` (developer iteration)

Build: `bash scripts/build-mcpb.sh` → ~4MB self-contained extension.
