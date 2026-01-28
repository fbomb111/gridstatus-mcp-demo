# Grid Status MCP Server — Technical Specification

_Backend API and MCP client specification for the Grid Status demo._

---

## Architecture Overview

```
┌─────────────────┐      ┌──────────────────────────────────────────────┐
│  Claude Desktop │      │           Azure Backend (FastAPI)            │
│                 │      │                                              │
│  ┌───────────┐  │      │  ┌─────────────┐  ┌─────────────────────┐   │
│  │ MCP Client│──┼─────►│  │   API       │  │   gridstatus lib    │   │
│  │ (thin)    │  │ HTTP │  │   Routes    │──│   (CAISO, ERCOT,    │   │
│  └───────────┘  │      │  └─────────────┘  │    PJM, etc.)       │   │
│                 │      │        │          └─────────────────────┘   │
└─────────────────┘      │        ▼                                    │
                         │  ┌─────────────┐  ┌─────────────────────┐   │
                         │  │  Services   │  │   Azure OpenAI      │   │
                         │  │  - Baseline │  │   (synthesis only)  │   │
                         │  │  - Weather  │  └─────────────────────┘   │
                         │  └─────────────┘                            │
                         │        │                                    │
                         │        ▼                                    │
                         │  ┌─────────────┐                            │
                         │  │  In-Memory  │  (MVP - no Redis)          │
                         │  │  Cache      │                            │
                         │  └─────────────┘                            │
                         └──────────────────────────────────────────────┘
```

**Design Principles:**
- MCP client is thin — just tool definitions and HTTP calls
- Backend does all heavy lifting: data fetching, baseline computation, LLM synthesis
- User gets fast, intelligent responses without waiting for multiple API round-trips

---

## Tools Overview

Three tools demonstrating a spectrum of approaches:

| Tool | Approach | What It Shows |
|------|----------|---------------|
| `get_market_snapshot` | Simple pipe | Data retrieval with light enrichment |
| `is_price_unusual` | Deterministic | Baseline comparison, structured analysis |
| `explain_grid_conditions` | LLM synthesis | Multi-source correlation, AI interpretation |

---

## Tool 1: `get_market_snapshot`

**Purpose:** Quick overview of current grid state for an ISO.

**Approach:** Simple data pipe with light enrichment. No LLM needed.

### MCP Tool Schema

```json
{
  "name": "get_market_snapshot",
  "description": "Get current market conditions for an electricity grid operator (ISO). Returns prices, load, generation mix, and key metrics. Use this for 'What's happening in [ISO] right now?' questions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "iso": {
        "type": "string",
        "enum": ["CAISO", "ERCOT", "PJM"],
        "description": "The ISO/grid operator to query"
      }
    },
    "required": ["iso"]
  }
}
```

### Backend Endpoint

```
GET /api/v1/market/snapshot?iso={iso}
```

### Response Schema

```json
{
  "iso": "CAISO",
  "timestamp": "2024-01-15T14:30:00-08:00",
  "prices": {
    "average_lmp": 45.23,
    "peak_node_lmp": 78.50,
    "peak_node": "LAPLMG1_7_B1",
    "min_node_lmp": 12.10,
    "unit": "$/MWh"
  },
  "load": {
    "current_mw": 28500,
    "forecast_mw": 29200,
    "peak_today_mw": 31000,
    "vs_forecast_pct": -2.4
  },
  "generation_mix": {
    "solar": 35.2,
    "wind": 8.1,
    "natural_gas": 38.5,
    "imports": 12.0,
    "hydro": 4.2,
    "nuclear": 2.0
  },
  "highlights": [
    "Solar generation at 35% — typical for mid-afternoon",
    "Load tracking 2.4% below forecast",
    "No congestion alerts active"
  ]
}
```

### Implementation Notes

- **Data sources:** `gridstatus` library calls to ISO-specific modules
- **Enrichment:** `highlights` array generated via simple rule-based logic (not LLM)
- **Caching:** 60-second TTL for all data
- **Latency target:** < 2 seconds

---

## Tool 2: `is_price_unusual`

**Purpose:** Determine if current prices are anomalous given historical context.

**Approach:** Deterministic baseline comparison. Returns structured analysis with statistical context.

### MCP Tool Schema

```json
{
  "name": "is_price_unusual",
  "description": "Analyze whether current electricity prices are unusual compared to historical patterns. Returns statistical comparison with baselines for same hour, day type, and season. Use for 'Is this price normal?' or 'Should I be concerned about this price?' questions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "iso": {
        "type": "string",
        "enum": ["CAISO", "ERCOT", "PJM"],
        "description": "The ISO/grid operator to analyze"
      },
      "node": {
        "type": "string",
        "description": "Optional: specific pricing node. Defaults to system average."
      }
    },
    "required": ["iso"]
  }
}
```

### Backend Endpoint

```
GET /api/v1/market/price-analysis?iso={iso}&node={node}
```

### Response Schema

```json
{
  "iso": "CAISO",
  "node": "TH_NP15_GEN-APND",
  "timestamp": "2024-01-15T14:30:00-08:00",
  "current_price": 78.50,
  "unit": "$/MWh",
  "analysis": {
    "is_unusual": true,
    "severity": "moderate",
    "sigma": 2.3,
    "percentile": 94
  },
  "baselines": {
    "hour_of_day": {
      "mean": 42.10,
      "std": 15.80,
      "sample_size": 365,
      "description": "Same hour (2-3 PM) over past year"
    },
    "day_type": {
      "mean": 38.50,
      "std": 12.20,
      "sample_size": 52,
      "description": "Weekday afternoons in winter"
    },
    "rolling_7d": {
      "mean": 35.20,
      "std": 18.40,
      "sample_size": 168,
      "description": "Past 7 days, all hours"
    }
  },
  "context": {
    "higher_than_hourly_baseline_by": "86%",
    "rank_in_past_30_days": "3rd highest",
    "last_similar_price": "2024-01-08 (cold snap)"
  },
  "verdict": "Price is elevated but not extreme. 2.3 standard deviations above typical for this hour. Likely driven by specific conditions rather than market dysfunction."
}
```

### Implementation Notes

- **Baseline computation:** Pre-compute daily aggregates, compute final stats on request
- **Baselines stored:**
  - Hourly means/stds by ISO (24 values per ISO)
  - Day-type means/stds (weekday/weekend × season)
  - Rolling 7-day window (computed live)
- **No LLM:** `verdict` generated via template based on sigma thresholds
- **Caching:** Baselines refreshed daily, current price cached 60s
- **Latency target:** < 3 seconds

### Baseline Computation Strategy

```python
# Pre-computed (stored in memory, refreshed daily at midnight)
HOURLY_BASELINES = {
    "CAISO": {
        0: {"mean": 28.5, "std": 12.3, "n": 365},
        1: {"mean": 25.2, "std": 10.1, "n": 365},
        # ... 24 hours
    }
}

# Computed on-demand
def get_rolling_baseline(iso: str, hours: int = 168) -> dict:
    """Fetch last N hours of prices, compute mean/std."""
    pass
```

---

## Tool 3: `explain_grid_conditions`

**Purpose:** Synthesize multiple data sources to explain current grid state.

**Approach:** LLM synthesis. Fetches load, prices, weather, generation mix; uses Azure OpenAI to produce coherent explanation.

### MCP Tool Schema

```json
{
  "name": "explain_grid_conditions",
  "description": "Get an AI-synthesized explanation of current grid conditions, including what's driving prices and load. Correlates weather, generation mix, demand patterns, and market dynamics. Use for 'Why are prices high?' or 'What's affecting the grid right now?' questions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "iso": {
        "type": "string",
        "enum": ["CAISO", "ERCOT", "PJM"],
        "description": "The ISO/grid operator to analyze"
      },
      "focus": {
        "type": "string",
        "enum": ["prices", "reliability", "renewables", "general"],
        "description": "Optional: area to focus the explanation on",
        "default": "general"
      }
    },
    "required": ["iso"]
  }
}
```

### Backend Endpoint

```
GET /api/v1/market/explain?iso={iso}&focus={focus}
```

### Response Schema

```json
{
  "iso": "CAISO",
  "timestamp": "2024-01-15T14:30:00-08:00",
  "focus": "prices",
  "explanation": "CAISO prices are elevated this afternoon due to a combination of factors:\n\n**Primary driver: Low wind generation.** Wind is currently at 8% of the mix, well below the 15% typical for January afternoons. This is forcing more expensive natural gas units online.\n\n**Secondary factor: Cold weather.** Temperatures across the Central Valley are 10°F below normal, pushing heating demand higher than forecast.\n\n**Mitigating factor: Strong solar.** Solar generation is performing well at 35% of mix, which is preventing prices from spiking further.\n\nPrices should moderate after 5 PM as solar ramps down and evening wind typically picks up.",
  "contributing_factors": [
    {
      "factor": "Low wind generation",
      "impact": "high",
      "current": "8% of mix",
      "typical": "15% of mix"
    },
    {
      "factor": "Cold weather",
      "impact": "medium",
      "current": "52°F average",
      "typical": "62°F average"
    },
    {
      "factor": "Strong solar",
      "impact": "mitigating",
      "current": "35% of mix",
      "typical": "30% of mix"
    }
  ],
  "data_sources": ["gridstatus.caiso", "openmeteo.forecast", "caiso.oasis"],
  "confidence": "high"
}
```

### Implementation Notes

- **Data fetched (parallel):**
  - Current LMP prices (gridstatus)
  - Load + forecast (gridstatus)
  - Generation mix (gridstatus)
  - Weather: current temp, forecast, comparison to normal (Open-Meteo API)
  - Recent price trend (last 24h)

- **LLM prompt strategy:**
  ```
  You are an energy market analyst. Given the following grid data,
  explain what's driving current conditions in plain language.

  Focus: {focus}

  Data:
  - Prices: {prices}
  - Load: {load}
  - Generation: {gen_mix}
  - Weather: {weather}
  - Recent trend: {trend}

  Provide:
  1. A 2-3 paragraph explanation suitable for a trader or analyst
  2. Ranked contributing factors with impact levels
  3. Brief forward outlook if relevant

  Be specific with numbers. Don't hedge excessively.
  ```

- **Model:** GPT-4o-mini (fast, cheap, good enough for synthesis)
- **Caching:** Full response cached 5 minutes (weather changes slowly)
- **Latency target:** < 5 seconds (LLM adds ~2s)

---

## Weather Integration

Using **Open-Meteo API** (free, no auth required).

### Data Points Needed

| ISO | Weather Location | Why |
|-----|-----------------|-----|
| CAISO | Sacramento, LA, SF | Central load centers |
| ERCOT | Houston, Dallas, Austin | Major demand centers |
| PJM | Philadelphia, Chicago, DC | Key metro areas |

### API Call

```python
# Open-Meteo example
import httpx

async def get_weather(lat: float, lon: float) -> dict:
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,wind_speed_10m",
        "hourly": "temperature_2m",
        "temperature_unit": "fahrenheit",
        "timezone": "auto"
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params=params)
        return resp.json()
```

---

## Infrastructure

### Azure Resources (MVP)

| Resource | SKU | Purpose | Est. Monthly Cost |
|----------|-----|---------|-------------------|
| App Service | B1 | Backend API | ~$13 |
| Azure OpenAI | Pay-as-you-go | GPT-4o-mini for synthesis | ~$5-10 |

**Total estimated:** ~$20/month for demo usage

### Environment Variables

```bash
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://xxx.openai.azure.com/
AZURE_OPENAI_API_KEY=xxx
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini

# Optional
LOG_LEVEL=INFO
CACHE_TTL_SECONDS=60
```

---

## MCP Client Package

Thin npm package for Claude Desktop integration.

### Package Structure

```
gridstatus-mcp/
├── package.json
├── src/
│   └── index.ts        # MCP server with 3 tools
└── README.md
```

### Core Implementation

```typescript
// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const BACKEND_URL = process.env.GRIDSTATUS_API_URL || "https://gridstatus-demo.azurewebsites.net";

const server = new Server({
  name: "gridstatus",
  version: "0.1.0",
}, {
  capabilities: { tools: {} }
});

// Tool definitions
server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "get_market_snapshot",
      description: "Get current market conditions for an electricity grid operator...",
      inputSchema: { /* ... */ }
    },
    {
      name: "is_price_unusual",
      description: "Analyze whether current electricity prices are unusual...",
      inputSchema: { /* ... */ }
    },
    {
      name: "explain_grid_conditions",
      description: "Get an AI-synthesized explanation of current grid conditions...",
      inputSchema: { /* ... */ }
    }
  ]
}));

// Tool execution - just HTTP calls to backend
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;

  const endpoints = {
    "get_market_snapshot": `/api/v1/market/snapshot`,
    "is_price_unusual": `/api/v1/market/price-analysis`,
    "explain_grid_conditions": `/api/v1/market/explain`
  };

  const url = new URL(endpoints[name], BACKEND_URL);
  Object.entries(args).forEach(([k, v]) => url.searchParams.set(k, v));

  const response = await fetch(url);
  const data = await response.json();

  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Installation

```bash
# For demo recipient
npx gridstatus-mcp

# Or add to Claude Desktop config:
{
  "mcpServers": {
    "gridstatus": {
      "command": "npx",
      "args": ["gridstatus-mcp"]
    }
  }
}
```

---

## Demo Script

Suggested conversation flow to showcase capabilities:

### Opening (Simple Query)

> **User:** What's happening in CAISO right now?
>
> **Claude:** [Calls `get_market_snapshot`] Let me check the current market conditions...
>
> The California grid is currently seeing moderate prices at $45/MWh average. Solar is strong at 35% of the generation mix...

### Price Investigation (Baseline Analysis)

> **User:** That seems higher than usual. Is $45 normal for this time?
>
> **Claude:** [Calls `is_price_unusual`] Let me compare to historical baselines...
>
> Actually, $45 is only slightly elevated. It's about 1.2 standard deviations above the typical price for 2 PM on a winter weekday. Not unusual enough to warrant concern.

### Deep Dive (AI Synthesis)

> **User:** What about ERCOT? I heard Texas prices have been crazy.
>
> **Claude:** [Calls `get_market_snapshot` then `explain_grid_conditions`]
>
> ERCOT is seeing elevated prices right now — $78/MWh, which is notably high. Here's what's driving it...
>
> [Synthesized explanation with weather correlation, generation mix issues, etc.]

### Comparative (Cross-ISO)

> **User:** How does that compare to PJM?
>
> **Claude:** [Calls relevant tools for both] Let me pull up PJM for comparison...
>
> PJM is running much calmer at $32/MWh — that's actually below their typical January afternoon price. The East Coast is seeing mild weather...

---

## Development Phases

### Phase 1: Backend Foundation (Day 1)
- [ ] FastAPI project setup
- [ ] gridstatus library integration
- [ ] `/api/v1/market/snapshot` endpoint
- [ ] Basic in-memory caching
- [ ] Deploy to Azure App Service

### Phase 2: Baseline System (Day 2)
- [ ] Baseline computation module
- [ ] `/api/v1/market/price-analysis` endpoint
- [ ] Historical data aggregation job

### Phase 3: AI Synthesis (Day 2-3)
- [ ] Open-Meteo weather integration
- [ ] Azure OpenAI integration
- [ ] `/api/v1/market/explain` endpoint
- [ ] Prompt refinement

### Phase 4: MCP Client (Day 3)
- [ ] MCP package scaffolding
- [ ] Tool definitions
- [ ] Backend integration
- [ ] Test with Claude Desktop

### Phase 5: Polish (Day 4)
- [ ] Error handling
- [ ] Response formatting
- [ ] Demo script rehearsal
- [ ] Documentation

---

## Open Questions

1. **Baseline history depth:** How much historical data to load on startup? (Suggest: 30 days, expand if needed)

2. **LLM fallback:** If Azure OpenAI is slow/down, should `explain_grid_conditions` fall back to template-based response?

3. **Rate limiting:** Add basic rate limiting to prevent abuse, or trust it's just for demo?

4. **Node-level data:** Should `is_price_unusual` support specific pricing nodes, or just ISO averages for MVP?

---

_Last updated: 2024-01-XX_
