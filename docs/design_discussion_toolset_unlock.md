# Design Discussion: How Should an MCP Server Handle Premium Features?

_Context: Building a GridStatus MCP server for Claude Desktop. Three public tools work without authentication. We wanted to add a 4th tool requiring an API key, unlocked after OAuth. The question was how to present this to the agent._

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

## What We Built

Two-tier registration:

- **Startup**: `registerTools()` — 3 public tools. The agent sees exactly what it can use.
- **After OAuth**: `registerAuthenticatedTools()` — adds the 4th tool + fires `tools/list_changed`. The agent's capabilities expand.
- **Stdio fallback**: If `GRIDSTATUS_API_KEY` env var is set, the 4th tool registers immediately at startup.

The OAuth server fires an `onAuthenticated` callback after the first successful token exchange, which triggers the tool registration. Deterministic — no timers, no polling.

## The Irony

We had actually built and removed delayed tool registration earlier in the project. The first attempt used a 5-second timer after startup to simulate "premium unlock" — but Claude Desktop didn't reliably handle the `tools/list_changed` notification, so we pulled it. The feature came back for the right reason: not as a demo of the protocol primitive, but because the actual product needed it.

The protocol feature (dynamic registration + notifications) found its purpose once we had a real use case for gated capabilities. The implementation was the same; the motivation made it work.
