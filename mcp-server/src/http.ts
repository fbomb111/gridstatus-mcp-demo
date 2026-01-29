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
