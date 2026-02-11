# Grid Status MCP Server — Phase 6: Premium Tool Unlock & Agent-First Design

_How should an MCP server handle premium features? A design debate about whether agents should see tools they can't use yet — and the practical reality that settled it._

---

## The Setup

We had a working MCP server with three tools — all using public California grid data, no auth needed. We wanted to add a 4th tool that hits the gridstatus.io hosted API (historical data, all US ISOs), which requires an API key provided through OAuth.

The question: how does the agent (Claude) discover and interact with a tool that's only available after authentication?

## Take 1: Always Visible, Auth-Gated (Claude's recommendation)

The initial recommendation was to register all 4 tools at startup, and have the 4th tool return a friendly "authentication required" message if no API key was present. The reasoning:

- It's how real APIs work — the endpoint exists, it just 401s without credentials.
- The tool being visible lets Claude tell users about it and explain how to unlock it.
- Simple to implement — no notification plumbing, no state tracking.
- Works in both transports (stdio could fall back to an env var).

This is a reasonable web-developer instinct. You expose the endpoint, document it, and let the auth layer handle access control.

## Take 2: Two Toolsets, Hidden Then Revealed (Human's pushback)

The response: "Think about MCP itself. You're telling the agent, here's all these tools you can use — and then you're like, just kidding, 403. You want the agent to know it can use Toolset A, but when it's premium, it gets Toolset B."

The key insight is about the agent's mental model. In MCP, the tool list isn't a REST API directory — it's the agent's understanding of its own capabilities. When you list a tool, you're saying "you can do this." Having the agent discover through trial and error that it actually can't is a poor experience for both the agent and the user watching it try.

The alternative: register only the tools the agent can actually use right now. After authentication succeeds, register the new tool and fire `tools/list_changed` to notify the client. The agent's capability set grows when the user upgrades — it never sees something it can't use.

## Why the Agent-First Perspective Matters

The difference comes down to who the tool list is for:

- **API-first thinking**: The tool list is documentation. Show everything, gate access at runtime. The consumer (agent) figures out what works through requests and responses.

- **Agent-first thinking**: The tool list is the agent's capability set. Only show what's actually available. The agent should never plan around a tool it can't execute.

In traditional REST, a 403 is normal — clients handle it, retry with auth, show a login prompt. But an LLM agent that sees a tool in its list will try to use it, potentially waste a turn explaining to the user why it failed, and create a confusing experience. The agent doesn't have a "retry with credentials" flow — it just has tools that work or don't.

## What We Built (First)

Two-tier registration:

- **Startup**: `registerTools()` — 3 public tools. The agent sees exactly what it can use.
- **After OAuth**: `registerAuthenticatedTools()` — adds the 4th tool + fires `tools/list_changed`. The agent's capabilities expand.
- **Stdio fallback**: If `GRIDSTATUS_API_KEY` env var is set, the 4th tool registers immediately at startup.

The OAuth server fires an `onAuthenticated` callback after the first successful token exchange, which triggers the tool registration. Deterministic — no timers, no polling.

## The Irony

We had actually built and removed delayed tool registration earlier in the project. The first attempt used a 5-second timer after startup to simulate "premium unlock" — but Claude Desktop didn't reliably handle the `tools/list_changed` notification, so we pulled it. The feature came back for the right reason: not as a demo of the protocol primitive, but because the actual product needed it.

The protocol feature (dynamic registration + notifications) found its purpose once we had a real use case for gated capabilities. The implementation was the same; the motivation made it work.

## Take 3: Back to Always Visible (Reality Wins)

After deploying the two-tier approach, we hit the same wall again: `tools/list_changed` notifications weren't reaching the client reliably. The `onAuthenticated` callback fired during the OAuth token exchange HTTP response — outside the MCP transport context — so the notification was lost. The 4th tool never appeared after authentication.

The root cause is a **timing mismatch**: OAuth completes on an HTTP request/response cycle, but MCP tool notifications travel through the MCP transport (a separate StreamableHTTP connection). Firing a transport-level notification from an HTTP handler doesn't have the right context.

We could have fixed the plumbing — queued the notification, waited for the next MCP request, piggybacked it. But we stepped back and asked: is the complexity worth it?

The 4th tool's handler already validates the API key at call time:

```typescript
const apiKey = getApiKey();
if (!apiKey) {
  return {
    content: [{ type: "text", text: "Authentication required: no gridstatus.io API key available." }],
    isError: true,
  };
}
```

This means:
- The tool is always visible → the tutorial prompt can reference it → Claude can explain how to unlock it
- Calling it without a key returns a clear, actionable error — not a cryptic 403
- After OAuth, the tool works immediately — no notification needed, no state tracking
- Stdio transport works identically (API key from env var or absent)

The agent-first argument was correct in theory: agents shouldn't see tools they can't use. But the practical tradeoff favored visibility. The error message is part of the UX — it tells the user exactly what to do. And the tutorial prompt (Step 5) checks for the tool's presence to decide which path to take, which only works if the tool is always registered.

## The Lesson

Three attempts at the same feature:

1. **Timer-based dynamic registration** — Pulled because `tools/list_changed` was unreliable in Claude Desktop
2. **OAuth callback dynamic registration** — Failed because the notification fired outside the transport context
3. **Always registered, auth-gated at call time** — Works everywhere, no transport coupling

The agent-first philosophy ("only show what works") is the right north star for MCP design. But the MCP ecosystem isn't there yet — `tools/list_changed` support is inconsistent across clients, and the interaction between OAuth and MCP transport contexts is underspecified. When the protocol matures, dynamic tool sets will be the correct pattern. Today, upfront registration with clear error messages is the pragmatic choice.

Sometimes the first instinct is right for the wrong reasons. Claude recommended "always visible" because it's simpler. We pushed back because the agent model demands better. We built the better version. It didn't work. We came back to "always visible" — but now we know *why* it's the right choice for the current state of MCP, not just the easy one.
