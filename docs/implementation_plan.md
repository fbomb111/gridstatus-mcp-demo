# Grid Status MCP Server — Implementation Plan

_Concrete build plan: what to build, in what order, and how to verify it works._

---

## Architecture

```
┌─────────────────┐         ┌──────────────────────────────────────┐
│  Claude Desktop │         │    Azure Function App (Python)       │
│                 │         │                                      │
│  ┌───────────┐  │  HTTP   │  function_app.py                    │
│  │ MCP Client│──┼────────►│    ├── /api/v1/market/snapshot      │
│  │ (TS, thin)│  │         │    ├── /api/v1/market/price-analysis│
│  └───────────┘  │         │    └── /api/v1/market/explain       │
│                 │         │                                      │
└─────────────────┘         │  services/                           │
                            │    ├── grid_data.py  (gridstatus)   │
                            │    ├── baselines.py  (stats)        │
                            │    ├── weather.py    (Open-Meteo)   │
                            │    └── synthesis.py  (Azure OpenAI) │
                            │                                      │
                            │  In-memory cache (TTL-based)         │
                            └──────────────────────────────────────┘
```

**Two deliverables:**
1. Python backend (Azure Function App) — all intelligence lives here
2. TypeScript MCP client — thin proxy, ~50 lines, published to npm

---

## Project Structure

```
gridstatus_demo/
├── docs/
│   ├── product_spec.md          # Product overview (exists)
│   ├── technical_spec.md        # Tool schemas, response models (exists)
│   ├── design_process.md        # Design reasoning (exists)
│   └── implementation_plan.md   # This file
├── backend/
│   ├── function_app.py          # Azure Function entry point (FastAPI via ASGI)
│   ├── routes/
│   │   └── market.py            # 3 API endpoints
│   ├── services/
│   │   ├── grid_data.py         # gridstatus library wrapper
│   │   ├── baselines.py         # Statistical baseline computation
│   │   ├── weather.py           # Open-Meteo API client
│   │   ├── synthesis.py         # Azure OpenAI synthesis (explain tool)
│   │   └── cache.py             # Simple TTL cache
│   ├── models/
│   │   └── schemas.py           # Pydantic response models
│   ├── requirements.txt
│   ├── host.json
│   └── local.settings.json
├── mcp-client/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── index.ts             # MCP server with 3 tool definitions
└── README.md                    # Setup instructions for demo recipient
```

---

## Dependencies

### Backend (Python)
```
azure-functions
fastapi
gridstatus
httpx              # Async HTTP for weather API
openai             # Azure OpenAI SDK
pydantic
numpy              # Baseline statistics
```

### MCP Client (TypeScript)
```
@modelcontextprotocol/sdk
```

---

## Infrastructure

| Resource | Config | Purpose |
|---|---|---|
| Azure Function App | Python 3.11, Consumption plan | Backend API |
| Azure OpenAI | GPT-4o-mini deployment | Synthesis for `explain_grid_conditions` |

**Environment Variables:**
```bash
AZURE_OPENAI_ENDPOINT=https://xxx.openai.azure.com/
AZURE_OPENAI_API_KEY=xxx
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
```

No database. No Redis. No container registry.

---

## Build Phases

### Phase 1: Backend Skeleton + Snapshot Tool

**Goal:** Function App running locally with first endpoint working.

**Tasks:**
- [ ] Initialize Function App project (`func init --python`)
- [ ] Add FastAPI with ASGI adapter
- [ ] Install gridstatus as editable dependency
- [ ] Implement `grid_data.py` — wrapper for gridstatus calls (prices, load, fuel mix)
- [ ] Implement `cache.py` — simple dict with TTL expiry
- [ ] Implement `GET /api/v1/market/snapshot` endpoint
- [ ] Implement Pydantic response models for snapshot
- [ ] Test locally: `func start` → `curl localhost:7071/api/v1/market/snapshot?iso=CAISO`

**Verify:**
- Returns JSON with prices, load, generation_mix, highlights
- Second call within 60s returns cached data (faster response)
- CAISO, ERCOT, PJM all work

---

### Phase 2: Baseline System + Price Analysis Tool

**Goal:** Historical baselines computed, price analysis endpoint working.

**Tasks:**
- [ ] Implement `baselines.py`:
  - Fetch 30 days of historical LMP data per ISO on startup
  - Compute hourly baselines (mean, std per hour-of-day)
  - Compute day-type baselines (weekday/weekend × season)
  - Compute rolling 7-day window (on-demand)
- [ ] Implement `GET /api/v1/market/price-analysis` endpoint
- [ ] Verdict generation via template (no LLM):
  - < 1 sigma → "Normal range"
  - 1-2 sigma → "Slightly elevated/depressed"
  - 2-3 sigma → "Notably unusual"
  - > 3 sigma → "Extreme anomaly"
- [ ] Response includes: current price, sigma, percentile, all baseline comparisons, verdict

**Verify:**
- Returns structured analysis with baselines
- Sigma calculation is mathematically correct
- Verdict changes appropriately for different price levels
- Works for all 3 ISOs

---

### Phase 3: Weather + AI Synthesis Tool

**Goal:** Multi-source data correlation with LLM explanation.

**Tasks:**
- [ ] Implement `weather.py`:
  - Open-Meteo API client (async, httpx)
  - Weighted-average temperature for ISO service territory
  - Compare to seasonal normals
- [ ] Implement `synthesis.py`:
  - Azure OpenAI client (non-streaming)
  - Prompt: energy analyst persona, structured data input, ranked factors output
  - Parse response into explanation + contributing_factors
- [ ] Implement `GET /api/v1/market/explain` endpoint:
  - Fetch grid data + weather in parallel
  - Pass to synthesis service
  - Cache full response for 5 minutes
- [ ] Support `focus` parameter: prices, reliability, renewables, general

**Verify:**
- Returns coherent explanation with specific numbers
- Contributing factors are ranked by impact
- Weather data is included and correlates sensibly
- Focus parameter changes the emphasis of the response
- Response cached (second call within 5 min is instant)

---

### Phase 4: MCP Client

**Goal:** Claude Desktop can call all 3 tools.

**Tasks:**
- [ ] Scaffold TypeScript MCP package
- [ ] Define 3 tools with descriptions and input schemas
- [ ] Tool execution: HTTP GET to backend, return JSON as text content
- [ ] Error handling: backend errors → MCP error responses
- [ ] `GRIDSTATUS_API_URL` env var for backend URL
- [ ] Test with Claude Desktop locally (point to localhost backend)

**Verify:**
- `npx` installs and runs the MCP server
- Claude Desktop shows 3 tools available
- Each tool returns data correctly
- Natural conversation flow works (see demo script in technical_spec.md)

---

### Phase 5: Deploy + Polish

**Goal:** Hosted backend, publishable MCP client, demo-ready.

**Tasks:**
- [ ] Deploy Function App to Azure (`func azure functionapp publish`)
- [ ] Verify all 3 endpoints work against deployed backend
- [ ] Update MCP client default URL to Azure endpoint
- [ ] Publish MCP client to npm (or provide direct install instructions)
- [ ] Write README.md with setup instructions for demo recipient
- [ ] Error handling polish (timeouts, API failures, graceful degradation)
- [ ] Test full demo script end-to-end
- [ ] Record or screenshot demo conversation for backup

**Verify:**
- Demo recipient can install with `npx gridstatus-mcp` and use immediately
- All 3 tools work against production backend
- Cold start is < 10 seconds
- Demo script conversation flows naturally

---

## Key Implementation Details

### gridstatus Library Usage

```python
from gridstatus import CAISO, ERCOT, PJM

ISO_MAP = {"CAISO": CAISO(), "ERCOT": ERCOT(), "PJM": PJM()}

# Current prices
df = iso.get_lmp(date="latest")

# Current load
df = iso.get_load(date="latest")

# Fuel mix
df = iso.get_fuel_mix(date="latest")

# Historical (for baselines)
df = iso.get_lmp(date="today", end="30 days ago")
```

### Baseline Computation

Pre-compute on first request (lazy init), refresh daily:
- 24 hourly baselines per ISO (mean + std from 30 days of same-hour data)
- 4 seasonal baselines per ISO (winter/spring/summer/fall weekday/weekend)
- Rolling 7-day baseline computed on demand

### Weather Locations

| ISO | Cities | Coordinates |
|---|---|---|
| CAISO | Sacramento, LA, SF | Weighted by population/load |
| ERCOT | Houston, Dallas, Austin | Weighted by population/load |
| PJM | Philadelphia, Chicago, DC | Weighted by population/load |

### Synthesis Prompt (explain tool)

LLM receives structured data, not raw text. The prompt provides:
- Current prices vs baseline
- Load vs forecast
- Generation mix with renewables percentage
- Weather vs seasonal normal
- Recent 24h price trend

Returns: 2-3 paragraph explanation + ranked contributing factors with impact levels.

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| gridstatus API rate limits | In-memory cache (60s TTL for current data, daily for baselines) |
| Azure OpenAI slow/down | explain tool returns partial data without synthesis if LLM fails |
| Cold start latency | Acceptable for demo; document as production improvement |
| gridstatus library changes | Pin version in requirements.txt |
| Demo recipient can't install MCP | Provide fallback: curl commands to hit backend directly |

---

_Last updated: 2026-01-28_
