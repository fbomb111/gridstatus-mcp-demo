/**
 * Shared MCP prompt registrations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  // Prompt 1: Grid Briefing
  server.registerPrompt("grid_briefing", {
    title: "Grid Briefing",
    description: "Comprehensive California grid briefing — chains all tools automatically.",
  }, async () => ({
    messages: [{
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
    }],
  }));

  // Prompt 2: Investigate Price
  server.registerPrompt("investigate_price", {
    title: "Investigate Price",
    description: "Structured price investigation for a specific ISO.",
    argsSchema: {
      iso: z.string().default("CAISO").describe("ISO to investigate (e.g., CAISO)"),
    },
  }, async ({ iso }) => ({
    messages: [{
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
    }],
  }));

  // Prompt 3: Tutorial
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
          "- A 4th premium tool unlocked by authentication (historical data across all US ISOs)",
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
          "IMPORTANT: Do NOT speculate about why the price is what it is — that's what Step 4's AI tool is for. Just present the numbers and what they mean statistically.",
          "Then say: 'Now let's try the AI-powered tool that can explain the why. Say Next when ready.'",
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
          "STEP 5: UNLOCK — Authentication & Premium Tools",
          "Explain: Everything you've used so far works with public CAISO data — no account needed.",
          "But there's a 4th tool that requires a gridstatus.io API key to unlock.",
          "It gives you access to historical data across ALL major US power markets:",
          "ERCOT (Texas), PJM (Mid-Atlantic), MISO (Midwest), NYISO (New York), ISO-NE (New England), SPP (Great Plains).",
          "",
          "Check if query_grid_history is already available in your tool list.",
          "- If YES (the user has an API key configured): Great! Ask them to try:",
          "  'What were ERCOT prices last Tuesday?' or 'Show me PJM load data for the past week'",
          "  After showing results, point out: this data comes from the gridstatus.io hosted API,",
          "  authenticated with their personal API key. Different data source, broader coverage.",
          "- If NO (tool not in the list): Explain that connecting via the hosted URL",
          "  (OAuth flow) or setting a GRIDSTATUS_API_KEY env var will unlock it.",
          "  When authenticated, the server registers the new tool and notifies Claude,",
          "  so it appears in the tool list automatically.",
          "Either way, explain the unlock pattern: the server starts with 3 public tools.",
          "After authentication, a 4th tool becomes available. The agent only sees tools it can actually use.",
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
          "Recap the tools and when each is most useful:",
          "  • Market Snapshot — quick look at current conditions (instant, no AI)",
          "  • Price Analysis — is the price normal? (statistical comparison, no AI)",
          "  • Explain Conditions — what's causing this? (AI-powered, richer but slower)",
          "  • Historical Grid Data — query any US ISO's history (requires API key)",
          "End with: 'That's the tour! You've seen everything this server can do. Have fun exploring the grid!'",
        ].join("\n"),
      },
    }],
  }));
}
