# Grid Status MCP Server — Phase 6: Premium Tool Unlock & Agent-First Design

_How should an MCP server handle premium features? A design debate about whether agents should see tools they can't use yet — and the practical reality that settled it._

---

## The Setup

Three public tools working, we wanted a 4th requiring an API key. The question: how does the agent discover a tool that's only available after authentication?

## Take 1: Always Visible, Auth-Gated

Register all 4 tools at startup; 4th returns "authentication required" without credentials. Simple, works in both transports. This is the web-developer instinct: expose the endpoint, let auth handle access control.

## Take 2: Hidden Then Revealed (Agent-First)

**The pushback:** In MCP, the tool list is the agent's understanding of its capabilities. Listing a tool says "you can do this." Having the agent discover through trial and error that it can't is a poor experience. Better: register only usable tools, then add the 4th via `tools/list_changed` after authentication.

**The distinction:**
- **API-first thinking:** Tool list is documentation. Show everything, gate at runtime.
- **Agent-first thinking:** Tool list is the capability set. Only show what works.

## What We Built

Two-tier registration: 3 tools at startup → 4th added after OAuth → `tools/list_changed`. The agent's capabilities expand when the user upgrades.

## Take 3: Back to Always Visible (Reality Wins)

After deploying, `tools/list_changed` notifications weren't reaching the client reliably. The OAuth callback fires during an HTTP response — outside the MCP transport context — so the notification was lost.

We could have fixed the plumbing, but stepped back: the 4th tool's handler already validates the API key and returns a clear, actionable error message. The tutorial prompt checks for the tool to decide which path to take — which only works if it's always registered.

## The Lesson

Three attempts at the same feature:
1. **Timer-based dynamic registration** — Pulled; `tools/list_changed` unreliable in Claude Desktop
2. **OAuth callback registration** — Failed; notification fired outside transport context
3. **Always registered, auth-gated** — Works everywhere, no transport coupling

The agent-first philosophy is the right north star. But the MCP ecosystem isn't there yet — `tools/list_changed` support is inconsistent, and OAuth/transport interaction is underspecified. When the protocol matures, dynamic tool sets will be correct. Today, upfront registration with clear errors is the pragmatic choice.

Sometimes the first instinct is right for the wrong reasons. We came back to "always visible" — but now we know *why*, not just that it's easier.
