/**
 * GridStatus MCP Server — Streamable HTTP Transport
 *
 * Same data layer as index.ts (stdio), but served over HTTP.
 * Demonstrates transport layer independence: the same MCP primitives
 * (tools, resources, prompts) work identically over both stdio and HTTP.
 *
 * Usage:
 *   node build/http.js
 *   # Server listens on http://localhost:3000/mcp
 *
 * Test with MCP Inspector or curl:
 *   curl -X POST http://localhost:3000/mcp \
 *     -H "Content-Type: application/json" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
 */

import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const API_BASE = process.env.GRIDSTATUS_API_URL || "http://localhost:7071/api";
const PORT = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);

// Create a fresh server instance (separate from stdio instance)
const server = new McpServer({
  name: "gridstatus",
  version: "0.3.0",
});

// --- Register the same primitives as index.ts ---

// Static resource
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
        text: "California ISO (CAISO) manages 80% of California's grid, serving ~30M people. See stdio server for full overview.",
      },
    ],
  })
);

// Dynamic resource template
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
    const resp = await fetch(`${API_BASE}/market/snapshot?iso=${iso}`);
    const data = resp.ok ? await resp.json() : { _summary: `Error: ${resp.status}` };
    return {
      contents: [{ uri: uri.href, mimeType: "text/plain", text: data._summary }],
    };
  }
);

// Tools (all three registered immediately for HTTP — no delayed registration demo)
server.registerTool("get_market_snapshot", {
  title: "Market Snapshot",
  description: "Get current market conditions for an ISO.",
  inputSchema: { iso: z.enum(["CAISO"]).default("CAISO") },
  annotations: { title: "Market Snapshot", readOnlyHint: true, openWorldHint: true },
}, async ({ iso }) => {
  const resp = await fetch(`${API_BASE}/market/snapshot?iso=${iso}`);
  if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.status}` }], isError: true };
  const data = await resp.json();
  return { content: [{ type: "text" as const, text: data._summary }, { type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("explain_grid_conditions", {
  title: "Explain Grid Conditions",
  description: "AI-synthesized explanation of current grid conditions.",
  inputSchema: {
    iso: z.enum(["CAISO"]).default("CAISO"),
    focus: z.enum(["general", "prices", "reliability", "renewables"]).default("general"),
  },
  annotations: { title: "Explain Conditions", readOnlyHint: true, openWorldHint: true },
}, async ({ iso, focus }) => {
  const resp = await fetch(`${API_BASE}/market/explain?iso=${iso}&focus=${focus}`);
  if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.status}` }], isError: true };
  const data = await resp.json();
  return { content: [{ type: "text" as const, text: data._summary }, { type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

server.registerTool("is_price_unusual", {
  title: "Price Analysis",
  description: "Statistical price analysis against historical baselines.",
  inputSchema: { iso: z.enum(["CAISO"]).default("CAISO") },
  annotations: { title: "Price Analysis", readOnlyHint: true, openWorldHint: true },
}, async ({ iso }) => {
  const resp = await fetch(`${API_BASE}/market/price-analysis?iso=${iso}`);
  if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.status}` }], isError: true };
  const data = await resp.json();
  return { content: [{ type: "text" as const, text: data._summary }, { type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

// Prompts
server.registerPrompt("grid_briefing", {
  title: "Grid Briefing",
  description: "Comprehensive California grid briefing.",
}, async () => ({
  messages: [{
    role: "user" as const,
    content: { type: "text" as const, text: "Give me a current briefing on the California electricity grid. Get the snapshot, check if price is unusual, and explain if needed." },
  }],
}));

// --- HTTP Server ---

async function main() {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const httpServer = createServer(async (req, res) => {
    if (req.url === "/mcp" && req.method === "POST") {
      await transport.handleRequest(req, res);
    } else if (req.url === "/mcp" && req.method === "GET") {
      // SSE endpoint for server-to-client notifications
      await transport.handleRequest(req, res);
    } else if (req.url === "/mcp" && req.method === "DELETE") {
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found. Use POST /mcp for MCP requests." }));
    }
  });

  await server.connect(transport);

  httpServer.listen(PORT, () => {
    console.error(`GridStatus MCP HTTP server listening on http://localhost:${PORT}/mcp`);
    console.error("Transport: Streamable HTTP (POST /mcp for requests, GET /mcp for SSE)");
  });
}

main().catch(console.error);
