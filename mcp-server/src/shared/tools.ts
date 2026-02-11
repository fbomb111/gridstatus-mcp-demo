/**
 * Shared MCP tool registrations.
 * Used by both stdio (index.ts) and HTTP (http.ts) transports.
 *
 * Two registration tiers:
 * - registerTools(): 3 public tools (no API key needed)
 * - registerAuthenticatedTools(): 1 premium tool (requires gridstatus.io API key)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const FETCH_TIMEOUT_MS = 30_000;

/** Fetch helper — optionally forwards API key header, with timeout */
export async function apiFetch(
  apiBase: string,
  path: string,
  apiKey?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["X-GridStatus-API-Key"] = apiKey;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${apiBase}${path}`, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Send a best-effort logging message */
async function log(
  server: McpServer,
  level: "debug" | "info" | "warning" | "error",
  data: string,
): Promise<void> {
  try {
    await server.sendLoggingMessage({ level, data });
  } catch {
    // Logging is best-effort
  }
}

export function registerTools(
  server: McpServer,
  apiBase: string,
  getApiKey: () => string | undefined,
): void {
  // Tool 1: Market Snapshot (no AI)
  server.registerTool("get_market_snapshot", {
    title: "Market Snapshot",
    description:
      "Get current electricity market conditions: prices, load, generation mix, and grid status. " +
      "Returns rule-based highlights (no AI). " +
      "If prices look unusual, follow up with is_price_unusual for statistical context.",
    inputSchema: { iso: z.enum(["CAISO"]).default("CAISO") },
    annotations: { title: "Market Snapshot", readOnlyHint: true, openWorldHint: true },
  }, async ({ iso }) => {
    await log(server, "info", `Fetching market snapshot for ${iso}...`);
    const resp = await apiFetch(apiBase, `/market/snapshot?iso=${iso}`, getApiKey());
    if (!resp.ok) {
      await log(server, "error", `Market snapshot API error: ${resp.status}`);
      return { content: [{ type: "text" as const, text: `API error: ${resp.status} ${resp.statusText}` }], isError: true };
    }
    const data = await resp.json();
    await log(server, "info", `Market snapshot retrieved: ${data._summary}`);
    return {
      content: [
        { type: "text" as const, text: data._summary },
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ],
    };
  });

  // Tool 2: Explain Grid Conditions (LLM synthesis)
  server.registerTool("explain_grid_conditions", {
    title: "Explain Grid Conditions",
    description:
      "AI-synthesized explanation of what's driving current grid conditions. " +
      "Combines grid data + weather via Azure OpenAI for analyst-grade explanation. " +
      "Use after get_market_snapshot when you need the 'why' behind the numbers.",
    inputSchema: {
      iso: z.enum(["CAISO"]).default("CAISO"),
      focus: z.enum(["general", "prices", "reliability", "renewables"]).default("general"),
    },
    annotations: { title: "Explain Conditions", readOnlyHint: true, openWorldHint: true },
  }, async ({ iso, focus }, extra) => {
    const progressToken = extra?._meta?.progressToken;
    const steps = 5;

    async function progress(step: number, message: string) {
      await log(server, "info", message);
      if (progressToken !== undefined) {
        try {
          await server.server.notification({
            method: "notifications/progress",
            params: { progressToken, progress: step, total: steps, message },
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

    const resp = await apiFetch(apiBase, `/market/explain?iso=${iso}&focus=${focus}`, getApiKey());
    if (!resp.ok) {
      await log(server, "error", `Explain conditions API error: ${resp.status}`);
      return { content: [{ type: "text" as const, text: `API error: ${resp.status} ${resp.statusText}` }], isError: true };
    }
    const data = await resp.json();
    await progress(5, "Analysis complete.");
    return {
      content: [
        { type: "text" as const, text: data._summary },
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ],
    };
  });

  // Tool 3: Is Price Unusual (deterministic baselines)
  server.registerTool("is_price_unusual", {
    title: "Price Analysis",
    description:
      "Statistical price analysis: compares current LMP against hourly baselines and 7-day rolling stats. " +
      "Returns sigma (std devs from mean), percentile, severity, and a plain-language verdict. " +
      "Deterministic — no AI. Use after get_market_snapshot to contextualize prices.",
    inputSchema: { iso: z.enum(["CAISO"]).default("CAISO") },
    annotations: { title: "Price Analysis", readOnlyHint: true, openWorldHint: true },
  }, async ({ iso }) => {
    await log(server, "info", `Analyzing price for ${iso} against historical baselines...`);
    const resp = await apiFetch(apiBase, `/market/price-analysis?iso=${iso}`, getApiKey());
    if (!resp.ok) {
      await log(server, "error", `Price analysis API error: ${resp.status}`);
      return { content: [{ type: "text" as const, text: `API error: ${resp.status} ${resp.statusText}` }], isError: true };
    }
    const data = await resp.json();
    await log(server, "info", `Price analysis complete: ${data.analysis?.severity || "unknown"} (${data.analysis?.sigma || "?"}σ)`);
    return {
      content: [
        { type: "text" as const, text: data._summary },
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ],
    };
  });
}

/**
 * Register authenticated tools (Toolset B).
 * Called after OAuth completes (HTTP) or at startup if API key env var is set (stdio).
 * Fires tools/list_changed so the client discovers the new tool.
 */
export function registerAuthenticatedTools(
  server: McpServer,
  apiBase: string,
  getApiKey: () => string | undefined,
): void {
  // Tool 4: Query Grid History (authenticated — hosted API)
  server.registerTool("query_grid_history", {
    title: "Historical Grid Data",
    description:
      "Query historical electricity grid data across any US ISO (CAISO, ERCOT, PJM, MISO, NYISO, ISONE, SPP) " +
      "using the gridstatus.io hosted API. Returns price, load, or fuel mix data for a date range. " +
      "This tool is only available after authenticating with a gridstatus.io API key.",
    inputSchema: {
      iso: z.enum(["CAISO", "ERCOT", "PJM", "MISO", "NYISO", "ISONE", "SPP"]).default("CAISO")
        .describe("The ISO/grid operator to query."),
      dataset: z.enum(["lmp", "load", "fuel_mix"]).default("lmp")
        .describe("Type of data to retrieve."),
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid date" })
        .optional()
        .describe("Start date (YYYY-MM-DD). Defaults to recent data if omitted."),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid date" })
        .optional()
        .describe("End date (YYYY-MM-DD). Defaults to now if omitted."),
      limit: z.number().min(1).max(1000).default(100)
        .describe("Maximum number of records to return (1-1000)."),
    },
    annotations: { title: "Historical Grid Data", readOnlyHint: true, openWorldHint: true },
  }, async ({ iso, dataset, start, end, limit }) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      await log(server, "error", "query_grid_history called without API key");
      return {
        content: [{ type: "text" as const, text: "Authentication required: no gridstatus.io API key available." }],
        isError: true,
      };
    }

    await log(server, "info", `Querying ${iso} ${dataset} history (${start || "recent"} to ${end || "now"}, limit ${limit})...`);

    const params = new URLSearchParams({ iso, dataset, limit: String(limit) });
    if (start) params.set("start", start);
    if (end) params.set("end", end);

    const resp = await apiFetch(apiBase, `/market/history?${params}`, apiKey);
    if (!resp.ok) {
      const body = await resp.text();
      await log(server, "error", `History API error: ${resp.status} — ${body}`);
      if (resp.status === 401 || resp.status === 403) {
        return {
          content: [{ type: "text" as const, text: "API key was rejected by gridstatus.io. It may be invalid, expired, or revoked. Check your key at gridstatus.io/api." }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: `API error: ${resp.status} ${resp.statusText}` }], isError: true };
    }
    const data = await resp.json();

    await log(server, "info", `History query complete: ${data.record_count} records`);
    return {
      content: [
        { type: "text" as const, text: data._summary },
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ],
    };
  });

}
