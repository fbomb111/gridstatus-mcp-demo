"""Market data routes — the core MCP-backed tools.

Tool 1: get_market_snapshot     → GET /market/snapshot        (Approach A: no AI)
Tool 2: explain_grid_conditions → GET /market/explain         (Approach B: LLM synthesis)
Tool 3: is_price_unusual        → GET /market/price-analysis  (Approach A+: baselines)
Tool 4: query_grid_history      → GET /market/history         (Authenticated: hosted API)
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Header, Query
from fastapi.responses import JSONResponse

from errors import UnsupportedISOError
from services import grid_data
from services.baselines import analyze_price
from services.foundry_client import complete
from services.hosted_api import query_historical
from services.weather import get_weather

logger = logging.getLogger(__name__)

router = APIRouter()

# ISOs with real-time data via the open-source gridstatus library (public scraping).
# The hosted API (Tool 4) supports all US ISOs — see services/hosted_api.py.
REALTIME_ISOS = {"CAISO"}


def _validate_iso(iso: str) -> str:
    """Normalize and validate ISO identifier."""
    iso = iso.upper()
    if iso not in REALTIME_ISOS:
        raise UnsupportedISOError(iso, REALTIME_ISOS)
    return iso


# ---------------------------------------------------------------------------
# Tool 1: Market Snapshot (Approach A — No AI)
# ---------------------------------------------------------------------------

@router.get("/market/snapshot")
async def market_snapshot(iso: str = Query("CAISO")) -> dict:
    """Current market conditions with rule-based highlights. No LLM."""
    iso = _validate_iso(iso)

    fuel_mix = grid_data.get_fuel_mix(iso)
    load = grid_data.get_load(iso)
    prices = grid_data.get_prices(iso)
    status = grid_data.get_status(iso)

    highlights = _generate_highlights(fuel_mix, load, prices)

    # Build human-readable summary for MCP clients
    avg = prices.get("average_lmp", 0)
    load_mw = load.get("current_mw", 0)
    top_source = max(fuel_mix["sources"].items(), key=lambda x: x[1]) if fuel_mix["sources"] else ("N/A", 0)
    total_gen = sum(v for v in fuel_mix["sources"].values() if v > 0)
    top_pct = (top_source[1] / total_gen * 100) if total_gen > 0 else 0
    _summary = (
        f"{iso} grid at {fuel_mix['timestamp']}: "
        f"{load_mw:,} MW load, ${avg:.2f}/MWh avg price, "
        f"{top_source[0]} leading at {top_pct:.0f}% of generation"
    )

    return {
        "_summary": _summary,
        "iso": iso,
        "timestamp": fuel_mix["timestamp"],
        "prices": prices,
        "load": load,
        "generation_mix": fuel_mix["sources"],
        "grid_status": status,
        "highlights": highlights,
    }


def _generate_highlights(fuel_mix: dict, load: dict, prices: dict) -> list[str]:
    """Rule-based highlights — domain knowledge without AI overhead."""
    highlights = []
    sources = fuel_mix.get("sources", {})
    total_gen = sum(v for v in sources.values() if v > 0)

    if total_gen == 0:
        return ["Generation data unavailable"]

    # Solar dominance
    solar = sources.get("Solar", 0)
    if solar > 0 and total_gen > 0:
        solar_pct = solar / total_gen * 100
        if solar_pct > 30:
            highlights.append(f"Solar dominant at {solar_pct:.0f}% of generation ({solar:,} MW)")
        elif solar_pct < 5:
            highlights.append(f"Minimal solar generation ({solar_pct:.0f}%)")

    # Battery behavior
    batteries = sources.get("Batteries", 0)
    if batteries < -1000:
        highlights.append(f"Batteries charging at {batteries:,} MW (absorbing excess generation)")
    elif batteries > 1000:
        highlights.append(f"Batteries discharging {batteries:,} MW (supporting evening demand)")

    # Wind
    wind = sources.get("Wind", 0)
    if wind > 0 and total_gen > 0:
        wind_pct = wind / total_gen * 100
        if wind_pct < 5:
            highlights.append(f"Low wind generation at {wind_pct:.0f}% ({wind:,} MW)")
        elif wind_pct > 20:
            highlights.append(f"Strong wind at {wind_pct:.0f}% of generation ({wind:,} MW)")

    # Gas reliance
    gas = sources.get("Natural Gas", 0)
    if gas > 0 and total_gen > 0:
        gas_pct = gas / total_gen * 100
        if gas_pct > 40:
            highlights.append(f"Heavy gas reliance at {gas_pct:.0f}% ({gas:,} MW)")

    # Price
    avg_price = prices.get("average_lmp", 0)
    if avg_price > 80:
        highlights.append(f"Elevated prices at ${avg_price:.2f}/MWh")
    elif avg_price < 0:
        highlights.append(f"Negative prices at ${avg_price:.2f}/MWh (oversupply)")

    if not highlights:
        highlights.append("Grid operating within normal parameters")

    return highlights


# ---------------------------------------------------------------------------
# Tool 2: Explain Grid Conditions (Approach B — LLM Synthesis)
# ---------------------------------------------------------------------------

@router.get("/market/explain")
async def explain_conditions(
    iso: str = Query("CAISO"),
    focus: str = Query("general"),
) -> dict:
    """AI-synthesized explanation of current grid conditions."""
    iso = _validate_iso(iso)

    fuel_mix = grid_data.get_fuel_mix(iso)
    load = grid_data.get_load(iso)
    prices = grid_data.get_prices(iso)
    weather = await get_weather(iso)

    # Build structured data for the LLM
    data_context = (
        f"ISO: {iso}\n"
        f"Timestamp: {fuel_mix['timestamp']}\n\n"
        f"Generation Mix (MW):\n{json.dumps(fuel_mix['sources'], indent=2)}\n\n"
        f"Load: {load['current_mw']:,} MW\n\n"
        f"Prices ($/MWh):\n"
        f"  Average LMP: ${prices['average_lmp']}\n"
        f"  By hub: {json.dumps(prices['by_hub'], indent=2)}\n\n"
        f"Weather:\n"
        f"  Average temp: {weather.get('average_temperature_f')}°F\n"
        f"  Average wind: {weather.get('average_wind_speed_mph')} mph\n"
        f"  Locations: {json.dumps(weather.get('locations', []), indent=2)}"
    )

    system_prompt = (
        "You are an energy market analyst. Given the following grid data, "
        "explain what's driving current conditions in plain language.\n\n"
        f"Focus: {focus}\n\n"
        "Respond in JSON with this exact structure:\n"
        "{\n"
        '  "explanation": "2-3 paragraph explanation suitable for a trader or analyst. '
        'Be specific with numbers. Don\'t hedge excessively.",\n'
        '  "contributing_factors": [\n'
        '    {"factor": "name", "impact": "high|medium|low|mitigating", "detail": "specifics"}\n'
        "  ]\n"
        "}"
    )

    ai_response = await asyncio.to_thread(
        complete,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": data_context},
        ],
        max_tokens=800,
    )

    # Parse the JSON response from the LLM (strip markdown fences if present)
    try:
        clean = ai_response.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(clean)
    except (json.JSONDecodeError, IndexError):
        parsed = {
            "explanation": ai_response.strip(),
            "contributing_factors": [],
        }

    explanation_text = parsed.get("explanation", "")
    factors = parsed.get("contributing_factors", [])
    top_factors = ", ".join(f["factor"] for f in factors[:3]) if factors else "unknown"
    _summary = (
        f"{iso} grid analysis (focus: {focus}): "
        f"Key drivers — {top_factors}. "
        f"See full explanation for details."
    )

    return {
        "_summary": _summary,
        "iso": iso,
        "timestamp": fuel_mix["timestamp"],
        "focus": focus,
        "explanation": explanation_text,
        "contributing_factors": factors,
        "data_sources": ["gridstatus", "openmeteo"],
    }


# ---------------------------------------------------------------------------
# Tool 3: Is Price Unusual (Approach A+ — Deterministic Baselines)
# ---------------------------------------------------------------------------

@router.get("/market/price-analysis")
async def price_analysis(iso: str = Query("CAISO")) -> dict:
    """Statistical price analysis against historical baselines. No LLM."""
    iso = _validate_iso(iso)

    prices = grid_data.get_prices(iso)
    current_price = prices["average_lmp"]

    analysis = analyze_price(iso, current_price)
    analysis["_summary"] = analysis["verdict"]
    analysis["iso"] = iso
    analysis["timestamp"] = prices["timestamp"]

    return analysis


# ---------------------------------------------------------------------------
# Tool 4: Query Grid History (Authenticated — Hosted API)
# ---------------------------------------------------------------------------

@router.get("/market/history")
async def market_history(
    iso: str = Query("CAISO"),
    dataset: str = Query("lmp"),
    start: str | None = Query(None),
    end: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    x_gridstatus_api_key: str | None = Header(None),
) -> dict:
    """Historical grid data via gridstatus.io hosted API. Requires API key."""
    if not x_gridstatus_api_key:
        return JSONResponse(
            {"error": "API key required. Pass X-GridStatus-API-Key header."},
            status_code=401,
        )

    try:
        return query_historical(
            api_key=x_gridstatus_api_key,
            iso=iso,
            dataset=dataset,
            start=start,
            end=end,
            limit=limit,
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=502)
