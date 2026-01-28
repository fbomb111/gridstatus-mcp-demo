import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const API_BASE = process.env.GRIDSTATUS_API_URL || "http://localhost:7071/api";

const server = new McpServer({
  name: "gridstatus",
  version: "0.1.0",
});

server.tool(
  "get_fuel_mix",
  "Get the latest fuel mix from the CAISO grid (California), including an AI-generated summary of the current energy generation breakdown.",
  {},
  async () => {
    const resp = await fetch(`${API_BASE}/grid/fuel-mix`);
    if (!resp.ok) {
      return { content: [{ type: "text", text: `API error: ${resp.status} ${resp.statusText}` }], isError: true };
    }
    const data = await resp.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
