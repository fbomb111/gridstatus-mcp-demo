/**
 * GridStatus MCP Server — Streamable HTTP Transport with OAuth 2.1
 *
 * Serves the MCP protocol over HTTP with full OAuth authorization.
 * Users authenticate by providing their gridstatus.io API key via
 * a browser-based OAuth flow. The key is encrypted into an access
 * token and forwarded to the backend on each request.
 *
 * OAuth endpoints:
 *   GET  /.well-known/oauth-protected-resource  (RFC 9728)
 *   GET  /.well-known/oauth-authorization-server (RFC 8414)
 *   POST /oauth/register                        (RFC 7591 - Dynamic Client Registration)
 *   GET  /oauth/authorize                       (show form)
 *   POST /oauth/authorize                       (submit API key)
 *   POST /oauth/token                           (code exchange / refresh)
 *
 * MCP endpoint:
 *   POST/GET/DELETE /mcp                        (Streamable HTTP transport)
 *
 * Usage:
 *   node dist/http.js
 *   # Server listens on http://localhost:3000
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OAuthServer } from "./auth/oauth-server.js";

const API_BASE = process.env.GRIDSTATUS_API_URL || "http://localhost:8000";
const PORT = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
const ISSUER = process.env.MCP_ISSUER || `http://localhost:${PORT}`;
const TOKEN_SECRET = process.env.MCP_TOKEN_SECRET || "dev-secret-change-in-production";
const REQUIRE_AUTH = process.env.MCP_REQUIRE_AUTH !== "false"; // default: true

// --- OAuth Server ---

const oauth = new OAuthServer({
  issuer: ISSUER,
  tokenSecret: TOKEN_SECRET,
});

// --- MCP Server ---

const server = new McpServer({
  name: "gridstatus",
  version: "0.4.0",
});

// Helper: fetch from backend, optionally forwarding the user's API key
async function apiFetch(path: string, apiKey?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["X-GridStatus-API-Key"] = apiKey;
  }
  return fetch(`${API_BASE}${path}`, { headers });
}

// We'll store the current request's API key in an AsyncLocalStorage-like pattern.
// Since MCP SDK doesn't pass request context to tool handlers, we use a module-level
// variable set by the middleware before each request. This works because Node.js
// processes one request at a time per transport instance.
let currentApiKey: string | undefined;

// --- Resources ---

server.registerResource(
  "caiso_overview",
  "gridstatus://caiso/overview",
  {
    title: "CAISO Grid Overview",
    description: "Reference information about the California ISO electricity grid",
    mimeType: "text/plain",
  },
  async () => ({
    contents: [
      {
        uri: "gridstatus://caiso/overview",
        mimeType: "text/plain",
        text: [
          "California ISO (CAISO) manages ~80% of California's electricity grid, serving ~30 million people.",
          "",
          "Key facts:",
          "- Covers most of California plus small parts of Nevada",
          "- Three main trading hubs: NP15 (north), SP15 (south), ZP26 (central)",
          "- Peak demand: ~45-52 GW in summer",
          "- Significant solar (duck curve) and growing battery storage",
          "- Typical price range: $20-80/MWh, with spikes >$200 during heat events",
          "- Peak hours: 4-9 PM (after solar drops, before wind ramps)",
          "",
          "Data available via this server:",
          "- Real-time fuel mix (solar, wind, gas, nuclear, hydro, batteries, imports)",
          "- Current load (demand) in MW",
          "- LMP prices at three trading hubs (5-min real-time market)",
          "- Grid status alerts (normal, restricted, emergency)",
          "- Weather conditions at major load centers (Sacramento, LA, SF)",
          "- Historical price baselines for anomaly detection",
        ].join("\n"),
      },
    ],
  })
);

server.registerResource(
  "live_conditions",
  new ResourceTemplate("gridstatus://{iso}/conditions", {
    list: async () => ({
      resources: [
        {
          uri: "gridstatus://CAISO/conditions",
          name: "CAISO Live Conditions",
          mimeType: "text/plain",
        },
      ],
    }),
    complete: { iso: () => ["CAISO"] },
  }),
  {
    title: "Live Grid Conditions",
    description: "Current grid conditions for an ISO",
    mimeType: "text/plain",
  },
  async (uri, { iso }) => {
    const resp = await apiFetch(`/market/snapshot?iso=${iso}`, currentApiKey);
    const data = resp.ok ? await resp.json() : { _summary: `Error: ${resp.status}` };
    return {
      contents: [{ uri: uri.href, mimeType: "text/plain", text: data._summary }],
    };
  }
);

// --- Tools ---

server.registerTool("get_market_snapshot", {
  title: "Market Snapshot",
  description:
    "Get current electricity market conditions: prices, load, generation mix, and grid status. " +
    "Returns rule-based highlights (no AI). " +
    "If prices look unusual, follow up with is_price_unusual for statistical context.",
  inputSchema: { iso: z.enum(["CAISO"]).default("CAISO") },
  annotations: { title: "Market Snapshot", readOnlyHint: true, openWorldHint: true },
}, async ({ iso }) => {
  const resp = await apiFetch(`/market/snapshot?iso=${iso}`, currentApiKey);
  if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.status}` }], isError: true };
  const data = await resp.json();
  return {
    content: [
      { type: "text" as const, text: data._summary },
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
});

server.registerTool("explain_grid_conditions", {
  title: "Explain Grid Conditions",
  description:
    "AI-synthesized explanation of what's driving current grid conditions. " +
    "Combines grid data + weather → Azure OpenAI for analyst-grade explanation. " +
    "Use after get_market_snapshot when you need the 'why' behind the numbers.",
  inputSchema: {
    iso: z.enum(["CAISO"]).default("CAISO"),
    focus: z.enum(["general", "prices", "reliability", "renewables"]).default("general"),
  },
  annotations: { title: "Explain Conditions", readOnlyHint: true, openWorldHint: true },
}, async ({ iso, focus }) => {
  const resp = await apiFetch(`/market/explain?iso=${iso}&focus=${focus}`, currentApiKey);
  if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.status}` }], isError: true };
  const data = await resp.json();
  return {
    content: [
      { type: "text" as const, text: data._summary },
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
});

server.registerTool("is_price_unusual", {
  title: "Price Analysis",
  description:
    "Statistical price analysis: compares current LMP against hourly baselines and 7-day rolling stats. " +
    "Returns sigma (std devs from mean), percentile, severity, and a plain-language verdict. " +
    "Deterministic — no AI. Use after get_market_snapshot to contextualize prices.",
  inputSchema: { iso: z.enum(["CAISO"]).default("CAISO") },
  annotations: { title: "Price Analysis", readOnlyHint: true, openWorldHint: true },
}, async ({ iso }) => {
  const resp = await apiFetch(`/market/price-analysis?iso=${iso}`, currentApiKey);
  if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.status}` }], isError: true };
  const data = await resp.json();
  return {
    content: [
      { type: "text" as const, text: data._summary },
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
});

// --- Prompts ---

server.registerPrompt("grid_briefing", {
  title: "Grid Briefing",
  description: "Comprehensive California grid briefing — chains all tools automatically.",
}, async () => ({
  messages: [{
    role: "user" as const,
    content: {
      type: "text" as const,
      text: "Give me a current briefing on the California electricity grid. Get the market snapshot, check if the price is unusual, and if anything stands out, explain what's driving conditions.",
    },
  }],
}));

server.registerPrompt("investigate_price", {
  title: "Investigate Price",
  description: "Structured price investigation for a specific ISO.",
  argsSchema: {
    iso: z.string().default("CAISO").describe("ISO to investigate (e.g., CAISO)"),
  },
}, async ({ iso }) => ({
  messages: [
    {
      role: "user" as const,
      content: {
        type: "text" as const,
        text: `Investigate electricity prices for ${iso}. First get the market snapshot, then check if the price is unusual. If it's unusual (sigma > 1.5), explain what's driving conditions. If it's normal, give a brief summary of current grid state.`,
      },
    },
  ],
}));

server.registerPrompt("tutorial", {
  title: "GridStatus Tutorial",
  description: "Interactive guided walkthrough of all GridStatus MCP features. Start here if you're new!",
}, async () => ({
  messages: [{
    role: "user" as const,
    content: {
      type: "text" as const,
      text: [
        "I want to take the GridStatus MCP tutorial. Please guide me through it interactively.",
        "",
        "=== TUTORIAL INSTRUCTIONS FOR CLAUDE ===",
        "",
        "You are running a guided, interactive tutorial for the GridStatus MCP server.",
        "Walk the user through each step below, ONE AT A TIME. After each step, pause",
        "and wait for the user to respond before moving on. If they ask questions along",
        "the way, answer them and then resume where you left off.",
        "Keep your tone friendly and practical — the user is technically comfortable",
        "(they use Claude Desktop and work with energy data) but may be new to MCP.",
        "",
        "STEP 1: WELCOME & ORIENTATION",
        "Welcome the user! Give a quick overview of what this server connects them to:",
        "- 3 tools for California grid data (live snapshot, price analysis, AI-powered explanation)",
        "- 2 resources with background reference info",
        "- 3 prompts including this tutorial",
        "Explain what they'll see in the '+' menu in Claude Desktop:",
        "- Prompts are like shortcuts — they kick off a specific workflow (like this tutorial)",
        "- Resources are reference material you can pull in for extra context",
        "Tell the user: 'Try clicking the + button to browse what's available. When you're ready, just say Next.'",
        "",
        "STEP 2: MARKET SNAPSHOT — Live Grid Data",
        "Ask the user: 'Let's pull live data. Ask me something like: What's happening on the California grid?'",
        "When they do, call get_market_snapshot. After showing results, walk them through what they got:",
        "- Real-time prices at three California trading hubs",
        "- Current electricity demand (load) in megawatts",
        "- Generation mix — how much is coming from solar, wind, gas, batteries, etc.",
        "- Grid status and any notable conditions",
        "Mention: this data comes straight from CAISO with no AI involved — it's fast, reliable,",
        "and always consistent. I'm (Claude) interpreting it for you, but the numbers are raw data.",
        "Then say: 'Next up, we'll check if that price is normal or unusual. Say Next when ready.'",
        "",
        "STEP 3: PRICE ANALYSIS — Is This Normal?",
        "Ask: 'Now let's put that price in context. Ask me: Is the current price unusual?'",
        "When they do, call is_price_unusual. After showing results, explain what the numbers mean:",
        "- Sigma: how far the price is from the average for this time of day (higher = more unusual)",
        "- Percentile: where this price ranks historically (e.g., 95th percentile = higher than 95% of readings)",
        "- Severity: a plain-language rating from normal → elevated → high → extreme",
        "Mention: this is still no AI — it's comparing today's price against historical baselines.",
        "Same question at the same time of day will always give the same answer.",
        "Then say: 'Now let's try the AI-powered tool. Say Next when ready.'",
        "",
        "STEP 4: AI EXPLANATION — The 'Why' Behind the Numbers",
        "Ask: 'Now ask me: Why are grid conditions the way they are right now?'",
        "When they do, call explain_grid_conditions. After showing results, explain what's different:",
        "- This tool pulls in weather data alongside the grid data, then uses AI to connect the dots",
        "- It identifies contributing factors — things like a heat wave driving up demand,",
        "  or high solar output pushing prices down",
        "- Notice the difference: the first two tools gave you raw data and stats.",
        "  This one tells you the story behind the numbers.",
        "- Under the hood, the server's AI writes a structured analysis, and then I (Claude)",
        "  present it to you conversationally — so you're getting two layers of interpretation",
        "Then say: 'Almost done — one more topic. Say Next when ready.'",
        "",
        "STEP 5: HOW AUTHENTICATION WORKS",
        "Explain how connecting to the remote version of this server works:",
        "- If you're using the hosted version (connected via URL), Claude Desktop handles login automatically",
        "- The first time you connect, a browser window opens where you enter your gridstatus.io API key",
        "- After that, it's seamless — Claude Desktop manages the session for you",
        "- Your API key is encrypted and never stored in plain text on the server",
        "- This means your personal API quota and access level apply to every request",
        "- If you're running locally for development, authentication is skipped",
        "Then say: 'One last thing — let me show you what else you can do. Say Next when ready.'",
        "",
        "STEP 6: EXPLORE ON YOUR OWN",
        "Wrap up by pointing the user to what else they can try:",
        "- Click '+' and select 'Grid Briefing' — it automatically chains all three tools together",
        "  for a complete picture (snapshot → price check → explanation if needed)",
        "- 'Investigate Price' runs a focused price investigation with automatic follow-up",
        "- Under Resources, 'CAISO Overview' gives background context about the California grid",
        "- You can also just ask questions naturally — try 'Give me a full grid analysis'",
        "  or 'What's driving prices right now?' and I'll pick the right tools",
        "Recap the three tools and when each is most useful:",
        "  • Market Snapshot — quick look at current conditions (instant, no AI)",
        "  • Price Analysis — is the price normal? (statistical comparison, no AI)",
        "  • Explain Conditions — what's causing this? (AI-powered, richer but slower)",
        "End with: 'That's the tour! You've seen everything this server can do. Have fun exploring the grid!'",
      ].join("\n"),
    },
  }],
}));

// --- HTTP Server with OAuth ---

async function main() {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", ISSUER);

    // OAuth routes (always available, no auth required)
    const handled = await oauth.handleRequest(req, res);
    if (handled) return;

    // MCP routes — require auth if enabled
    if (url.pathname === "/mcp") {
      if (REQUIRE_AUTH) {
        const apiKey = oauth.validateBearerToken(req.headers.authorization);
        if (!apiKey) {
          // RFC 9728: include resource_metadata URL in WWW-Authenticate
          res.writeHead(401, {
            "WWW-Authenticate": `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ error: "unauthorized", error_description: "Valid Bearer token required" }));
          return;
        }
        currentApiKey = apiKey;
      }

      await transport.handleRequest(req, res);
      return;
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: "0.4.0", auth: REQUIRE_AUTH }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await server.connect(transport);

  httpServer.listen(PORT, () => {
    console.error(`GridStatus MCP HTTP server v0.4.0`);
    console.error(`  MCP endpoint: ${ISSUER}/mcp`);
    console.error(`  OAuth:        ${REQUIRE_AUTH ? "enabled" : "disabled"}`);
    console.error(`  Health:       ${ISSUER}/health`);
    if (REQUIRE_AUTH) {
      console.error(`  Metadata:     ${ISSUER}/.well-known/oauth-protected-resource`);
      console.error(`  Register:     POST ${ISSUER}/oauth/register`);
      console.error(`  Authorize:    ${ISSUER}/oauth/authorize`);
    }
  });
}

main().catch(console.error);
