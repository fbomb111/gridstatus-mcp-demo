"""OpenMeteo weather client for grid condition correlation.

Free API, no key required. Returns current conditions for ISO load centers.
"""

import asyncio
import logging

import httpx

from services.cache import cache

logger = logging.getLogger(__name__)

# Major load centers per ISO (lat, lon, name)
ISO_LOCATIONS = {
    "CAISO": [
        (38.58, -121.49, "Sacramento"),
        (34.05, -118.24, "Los Angeles"),
        (37.77, -122.42, "San Francisco"),
    ],
}


async def _fetch_location(
    client: httpx.AsyncClient, lat: float, lon: float, name: str
) -> dict | None:
    """Fetch weather for a single location. Returns detail dict or None on failure."""
    try:
        resp = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,wind_speed_10m,relative_humidity_2m",
                "temperature_unit": "fahrenheit",
                "wind_speed_unit": "mph",
                "timezone": "auto",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        current = data["current"]

        return {
            "location": name,
            "temperature_f": current["temperature_2m"],
            "wind_speed_mph": current["wind_speed_10m"],
            "humidity_pct": current["relative_humidity_2m"],
        }
    except httpx.HTTPError as e:
        logger.warning("Weather fetch failed for %s: %s", name, e)
        return None


async def get_weather(iso: str = "CAISO") -> dict:
    """Get current weather conditions for an ISO's load centers."""
    cached = cache.get(f"weather:{iso}")
    if cached:
        return cached

    locations = ISO_LOCATIONS.get(iso.upper())
    if not locations:
        return {"error": f"No weather locations configured for {iso}"}

    async with httpx.AsyncClient(timeout=10) as client:
        results = await asyncio.gather(
            *[_fetch_location(client, lat, lon, name) for lat, lon, name in locations]
        )

    details = [r for r in results if r is not None]
    temps = [d["temperature_f"] for d in details]
    wind_speeds = [d["wind_speed_mph"] for d in details]

    result = {
        "iso": iso,
        "average_temperature_f": round(sum(temps) / len(temps), 1) if temps else None,
        "average_wind_speed_mph": round(sum(wind_speeds) / len(wind_speeds), 1) if wind_speeds else None,
        "locations": details,
    }
    cache.set(f"weather:{iso}", result, ttl_seconds=300)
    return result
