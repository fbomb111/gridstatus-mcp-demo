/**
 * GridStatus MCP Server — Streamable HTTP Transport with OAuth 2.1
 *
 * Same tools, resources, and prompts as stdio — definitions shared via src/shared/.
 * Adds OAuth authorization for API key management.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OAuthServer } from "./auth/oauth-server.js";
import { registerTools, registerAuthenticatedTools } from "./shared/tools.js";
import { registerResources } from "./shared/resources.js";
import { registerPrompts } from "./shared/prompts.js";

const VERSION = "0.4.0";
const API_BASE = process.env.GRIDSTATUS_API_URL || "http://localhost:8000";
const PORT = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
const ISSUER = process.env.MCP_ISSUER || `http://localhost:${PORT}`;
const TOKEN_SECRET = process.env.MCP_TOKEN_SECRET;
const REQUIRE_AUTH = process.env.MCP_REQUIRE_AUTH !== "false"; // default: true
const DEBUG = process.env.NODE_ENV !== "production";

function debug(msg: string): void {
  if (DEBUG) console.error(`[debug] ${msg}`);
}

// --- Production guards ---
if (process.env.NODE_ENV === "production") {
  if (!TOKEN_SECRET) {
    console.error("FATAL: MCP_TOKEN_SECRET is required in production");
    process.exit(1);
  }
  if (ISSUER.startsWith("http://") && !ISSUER.includes("localhost")) {
    console.error("FATAL: MCP_ISSUER must use HTTPS in production");
    process.exit(1);
  }
}

const tokenSecret = TOKEN_SECRET || "dev-secret-change-in-production";

// --- OAuth Server ---
const oauth = new OAuthServer({
  issuer: ISSUER,
  tokenSecret,
});

// --- MCP Server ---
const server = new McpServer({
  name: "gridstatus",
  version: VERSION,
});

// Module-level API key for the current request.
// Node.js processes one request at a time per transport instance,
// so this is safe for single-transport servers.
let currentApiKey: string | undefined;

// Register shared definitions (Toolset A: public, no API key needed)
registerTools(server, API_BASE, () => currentApiKey);
registerResources(server, API_BASE, () => currentApiKey);
registerPrompts(server);

// After first OAuth authentication, register authenticated tools (Toolset B)
oauth.onAuthenticated(() => {
  debug("First OAuth authentication — registering authenticated tools");
  registerAuthenticatedTools(server, API_BASE, () => currentApiKey);
});

// --- HTTP Server with OAuth ---

async function main() {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", ISSUER);
    debug(`${req.method} ${url.pathname}`);

    // OAuth routes (always available, no auth required)
    const handled = await oauth.handleRequest(req, res);
    if (handled) return;

    // MCP routes — require auth if enabled
    if (url.pathname === "/mcp") {
      if (REQUIRE_AUTH) {
        const apiKey = oauth.validateBearerToken(req.headers.authorization);
        if (!apiKey) {
          res.writeHead(401, {
            "WWW-Authenticate": `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ error: "unauthorized", error_description: "Valid Bearer token required" }));
          return;
        }
        currentApiKey = apiKey;
      }

      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error("MCP transport error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error", error_description: "MCP transport failure" }));
        }
      }
      return;
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        version: VERSION,
        commit: process.env.GIT_SHA || "unknown",
        auth: REQUIRE_AUTH,
      }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await server.connect(transport);
  oauth.startTokenCleanup();

  httpServer.listen(PORT, () => {
    console.error(`GridStatus MCP HTTP server v${VERSION}`);
    console.error(`  MCP endpoint: ${ISSUER}/mcp`);
    console.error(`  OAuth:        ${REQUIRE_AUTH ? "enabled" : "disabled"}`);
    console.error(`  Health:       ${ISSUER}/health`);
    console.error(`  Debug:        ${DEBUG ? "on" : "off"}`);
    if (REQUIRE_AUTH) {
      console.error(`  Metadata:     ${ISSUER}/.well-known/oauth-protected-resource`);
      console.error(`  Register:     POST ${ISSUER}/oauth/register`);
      console.error(`  Authorize:    ${ISSUER}/oauth/authorize`);
    }
  });
}

main().catch(console.error);
