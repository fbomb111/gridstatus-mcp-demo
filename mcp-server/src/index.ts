/**
 * GridStatus MCP Server v0.3.0 — Full Protocol Showcase
 *
 * Demonstrates every MCP primitive:
 *   Server Features:  Tools, Resources, Prompts
 *   Utilities:        Logging, Progress, Completions, Annotations, Notifications
 *   Experimental:     Tasks (durable execution)
 *   Transport:        stdio (this file), Streamable HTTP (http.ts)
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.GRIDSTATUS_API_URL || "http://localhost:7071/api";

const server = new McpServer({
  name: "gridstatus",
  version: "0.3.0",
});

// ============================================================================
// RESOURCES — Read-only context data (App-controlled)
// ============================================================================

// Resource 1: Static — CAISO Overview (always available context)
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
          "=== California ISO (CAISO) — Grid Overview ===",
          "",
          "The California Independent System Operator manages the flow of electricity",
          "across 80% of California's power grid, serving ~30 million people.",
          "",
          "KEY DATA POINTS AVAILABLE:",
          "• Generation mix: Solar, Wind, Natural Gas, Batteries, Nuclear, Imports, etc.",
          "• Load: Current demand in MW (typically 20,000–45,000 MW)",
          "• Prices: Locational Marginal Prices (LMP) in $/MWh from trading hubs:",
          "  - TH_NP15_GEN-APND (Northern California)",
          "  - TH_SP15_GEN-APND (Southern California)",
          "  - TH_ZP26_GEN-APND (Central California / ZP26)",
          "• Grid status: Normal, Alert, Warning, Emergency stages",
          "",
          "TYPICAL PRICE PATTERNS:",
          "• Overnight (00-06): $17–23/MWh (low demand, baseload)",
          "• Morning ramp (06-09): $28–33/MWh (demand rising)",
          "• Solar peak (10-15): $15–20/MWh (abundant solar drives prices down)",
          "• Evening peak (17-20): $45–52/MWh (solar drops, gas ramps up)",
          "• Duck curve trough (12-14): Prices can go NEGATIVE during spring solar glut",
          "",
          "NOTABLE FEATURES:",
          "• Battery storage: ~10 GW installed, charges midday, discharges evening",
          "• Solar: Can exceed 15 GW at peak, >40% of generation",
          "• Net demand peak shifted to 7-8 PM (after solar sunset)",
          "• Renewable curtailment common in spring (mild temps + high solar)",
        ].join("\n"),
      },
    ],
  })
);

// Resource 2: Dynamic Template — Live conditions for any ISO
server.registerResource(
  "live_conditions",
  new ResourceTemplate("gridstatus://{iso}/conditions", {
    list: async () => ({
      resources: [
        {
          uri: "gridstatus://CAISO/conditions",
          name: "CAISO Live Conditions",
          description: "Current grid conditions for California ISO",
          mimeType: "text/plain",
        },
      ],
    }),
    complete: {
      iso: () => ["CAISO"],
    },
  }),
  {
    title: "Live Grid Conditions",
    description: "Current grid conditions for an ISO (fetched live from API)",
    mimeType: "text/plain",
  },
  async (uri, { iso }) => {
    const resp = await fetch(`${API_BASE}/market/snapshot?iso=${iso}`);
    if (!resp.ok) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `Failed to fetch conditions for ${iso}: ${resp.status} ${resp.statusText}`,
          },
        ],
      };
    }
    const data = await resp.json();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: data._summary || JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// PROMPTS — Interaction templates (User-controlled)
// ============================================================================

// Prompt 1: Grid Briefing — zero-arg quick start
server.registerPrompt(
  "grid_briefing",
  {
    title: "Grid Briefing",
    description: "Get a comprehensive briefing on current California grid conditions. Calls multiple tools to build a complete picture.",
  },
  async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Give me a current briefing on the California electricity grid.",
            "",
            "Please:",
            "1. First get the current market snapshot to see prices, load, and generation mix",
            "2. Then check if the current price is unusual compared to historical patterns",
            "3. If anything looks noteworthy, explain what's driving those conditions",
            "",
            "Present your findings as a concise analyst briefing.",
          ].join("\n"),
        },
      },
    ],
  })
);

// Prompt 2: Investigate Price — parameterized
server.registerPrompt(
  "investigate_price",
  {
    title: "Investigate Price",
    description: "Investigate whether current electricity prices are unusual and what's driving them.",
    argsSchema: {
      iso: z
        .string()
        .default("CAISO")
        .describe("The ISO to investigate (currently only CAISO supported)"),
    },
  },
  async ({ iso }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `I want to understand what's happening with electricity prices on the ${iso} grid right now.`,
            "",
            "Please follow this investigation flow:",
            "1. Check if the current price is unusual (use is_price_unusual)",
            "2. If the price IS unusual (sigma > 2), get an AI explanation of what's driving it (use explain_grid_conditions with focus on 'prices')",
            "3. If the price is NOT unusual, just get the market snapshot and summarize conditions",
            "",
            "Walk me through your findings step by step.",
          ].join("\n"),
        },
      },
    ],
  })
);

// ============================================================================
// TOOLS — Executable functions (Model-controlled)
// ============================================================================

// Helper: send logging message
async function log(level: "debug" | "info" | "warning" | "error", data: string) {
  try {
    await server.sendLoggingMessage({ level, data });
  } catch {
    // Logging is best-effort; don't fail tool execution
  }
}

// Tool 1: Market Snapshot (Approach A — no AI)
server.registerTool(
  "get_market_snapshot",
  {
    title: "Market Snapshot",
    description:
      "Get current market conditions for an electricity grid operator (ISO). " +
      "Returns prices, load, generation mix, grid status, and key highlights in a single call. " +
      "Use for 'What's happening on the grid?' or 'Show me current conditions' questions. " +
      "Tip: If the price looks high, follow up with is_price_unusual to check against baselines.",
    inputSchema: {
      iso: z
        .enum(["CAISO"])
        .default("CAISO")
        .describe("The ISO/grid operator to query. Currently supports CAISO (California)."),
    },
    annotations: {
      title: "Market Snapshot",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ iso }) => {
    await log("info", `Fetching market snapshot for ${iso}...`);

    const resp = await fetch(`${API_BASE}/market/snapshot?iso=${iso}`);
    if (!resp.ok) {
      await log("error", `Market snapshot API error: ${resp.status}`);
      return {
        content: [{ type: "text" as const, text: `API error: ${resp.status} ${resp.statusText}` }],
        isError: true,
      };
    }
    const data = await resp.json();

    await log("info", `Market snapshot retrieved: ${data._summary}`);

    // Return summary as first content block, full data as second
    return {
      content: [
        { type: "text" as const, text: data._summary },
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

// Tool 2: Explain Grid Conditions (Approach B — LLM synthesis)
// This tool is registered dynamically after a delay (Step 9: Notifications demo)
function registerExplainTool() {
  server.registerTool(
    "explain_grid_conditions",
    {
      title: "Explain Grid Conditions",
      description:
        "Get an AI-synthesized explanation of current grid conditions, including what's driving prices and load. " +
        "Correlates weather, generation mix, demand patterns, and market dynamics. " +
        "Use for 'Why are prices high?' or 'What's affecting the grid?' questions. " +
        "This is the most comprehensive analysis tool — use it after checking raw data with get_market_snapshot.",
      inputSchema: {
        iso: z
          .enum(["CAISO"])
          .default("CAISO")
          .describe("The ISO/grid operator to analyze."),
        focus: z
          .enum(["general", "prices", "reliability", "renewables"])
          .default("general")
          .describe("Area to focus the explanation on."),
      },
      annotations: {
        title: "Explain Grid Conditions",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ iso, focus }, extra) => {
      // Progress notifications — demonstrate progress tracking
      const progressToken = extra?._meta?.progressToken;
      const steps = 5;

      async function progress(step: number, message: string) {
        await log("info", message);
        if (progressToken !== undefined) {
          try {
            await server.server.notification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: step,
                total: steps,
                message,
              },
            });
          } catch {
            // Progress is best-effort
          }
        }
      }

      await progress(0, `Fetching generation mix for ${iso}...`);
      await progress(1, `Fetching load data for ${iso}...`);
      await progress(2, `Fetching price data for ${iso}...`);
      await progress(3, `Fetching weather for ${iso} load centers...`);
      await progress(4, `Synthesizing analysis with AI (focus: ${focus})...`);

      const resp = await fetch(`${API_BASE}/market/explain?iso=${iso}&focus=${focus}`);
      if (!resp.ok) {
        await log("error", `Explain conditions API error: ${resp.status}`);
        return {
          content: [{ type: "text" as const, text: `API error: ${resp.status} ${resp.statusText}` }],
          isError: true,
        };
      }
      const data = await resp.json();

      await progress(5, "Analysis complete.");

      return {
        content: [
          { type: "text" as const, text: data._summary },
          { type: "text" as const, text: JSON.stringify(data, null, 2) },
        ],
      };
    }
  );
}

// Tool 3: Is Price Unusual (Approach A+ — deterministic baselines)
server.registerTool(
  "is_price_unusual",
  {
    title: "Price Analysis",
    description:
      "Analyze whether current electricity prices are unusual compared to historical patterns. " +
      "Returns statistical comparison with baselines for same hour and rolling 7-day window. " +
      "Use for 'Is this price normal?' or 'Should I be concerned about this price?' questions. " +
      "If the result shows the price IS unusual (sigma > 2), consider calling explain_grid_conditions to understand why.",
    inputSchema: {
      iso: z
        .enum(["CAISO"])
        .default("CAISO")
        .describe("The ISO/grid operator to analyze."),
    },
    annotations: {
      title: "Price Analysis",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ iso }) => {
    await log("info", `Analyzing price for ${iso} against historical baselines...`);

    const resp = await fetch(`${API_BASE}/market/price-analysis?iso=${iso}`);
    if (!resp.ok) {
      await log("error", `Price analysis API error: ${resp.status}`);
      return {
        content: [{ type: "text" as const, text: `API error: ${resp.status} ${resp.statusText}` }],
        isError: true,
      };
    }
    const data = await resp.json();

    await log("info", `Price analysis complete: ${data.analysis?.severity || "unknown"} (${data.analysis?.sigma || "?"}σ)`);

    return {
      content: [
        { type: "text" as const, text: data._summary },
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

// ============================================================================
// NOTIFICATIONS — Dynamic tool registration demo
// ============================================================================

// Demonstrate list_changed: register explain_grid_conditions after a delay
// This simulates a "premium feature unlock" or "lazy loading" pattern.
// On startup, only snapshot + price tools are available.
// After 5 seconds, the AI-powered explain tool becomes available.

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Register the explain tool after a delay to demonstrate notifications
  setTimeout(() => {
    registerExplainTool();
    server.sendToolListChanged();
    log("info", "explain_grid_conditions tool is now available (delayed registration demo).");
  }, 5000);
}

main().catch(console.error);
