/**
 * Shared MCP resource registrations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiFetch } from "./tools.js";

export function registerResources(
  server: McpServer,
  apiBase: string,
  getApiKey: () => string | undefined,
): void {
  // Resource 1: Static — CAISO Overview
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
            "Typical price patterns:",
            "- Overnight (00-06): $17-23/MWh (low demand, baseload)",
            "- Morning ramp (06-09): $28-33/MWh (demand rising)",
            "- Solar peak (10-15): $15-20/MWh (abundant solar drives prices down)",
            "- Evening peak (17-20): $45-52/MWh (solar drops, gas ramps up)",
            "- Duck curve trough (12-14): Prices can go negative during spring solar glut",
            "",
            "Notable features:",
            "- Battery storage: ~10 GW installed, charges midday, discharges evening",
            "- Solar: Can exceed 15 GW at peak, >40% of generation",
            "- Net demand peak shifted to 7-8 PM (after solar sunset)",
            "- Renewable curtailment common in spring (mild temps + high solar)",
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
            mimeType: "text/plain",
          },
        ],
      }),
      complete: { iso: () => ["CAISO"] },
    }),
    {
      title: "Live Grid Conditions",
      description: "Current grid conditions for an ISO (fetched live from API)",
      mimeType: "text/plain",
    },
    async (uri, { iso }) => {
      const resp = await apiFetch(apiBase, `/market/snapshot?iso=${iso}`, getApiKey());
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
}
