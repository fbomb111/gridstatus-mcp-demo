/**
 * GridStatus MCP Server — stdio transport
 *
 * Connects to Claude Desktop via stdio. Same tools, resources, and prompts
 * as the HTTP transport — definitions are shared via src/shared/.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, registerAuthenticatedTools } from "./shared/tools.js";
import { registerResources } from "./shared/resources.js";
import { registerPrompts } from "./shared/prompts.js";

const API_BASE = process.env.GRIDSTATUS_API_URL || "http://localhost:8000";

const server = new McpServer({
  name: "gridstatus",
  version: "0.4.0",
});

// stdio has no OAuth — API key comes from env var (if set)
const envApiKey = process.env.GRIDSTATUS_API_KEY;
registerTools(server, API_BASE, () => envApiKey);

// Authenticated tools require an API key; sendToolListChanged() is buffered pre-connect
if (envApiKey) {
  registerAuthenticatedTools(server, API_BASE, () => envApiKey);
}
registerResources(server, API_BASE, () => undefined);
registerPrompts(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
