"""OpenMeteo weather client for grid condition correlation.

Free API, no key required. Returns current conditions for ISO load centers.
"""

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


async def get_weather(iso: str = "CAISO") -> dict:
    """Get current weather conditions for an ISO's load centers."""
    cached = cache.get(f"weather:{iso}")
    if cached:
        return cached

    locations = ISO_LOCATIONS.get(iso.upper())
    if not locations:
        return {"error": f"No weather locations configured for {iso}"}

    temps = []
    wind_speeds = []
    details = []

    async with httpx.AsyncClient(timeout=10) as client:
        for lat, lon, name in locations:
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

                temp = current["temperature_2m"]
                wind = current["wind_speed_10m"]
                humidity = current["relative_humidity_2m"]

                temps.append(temp)
                wind_speeds.append(wind)
                details.append({
                    "location": name,
                    "temperature_f": temp,
                    "wind_speed_mph": wind,
                    "humidity_pct": humidity,
                })
            except Exception as e:
                logger.warning(f"Weather fetch failed for {name}: {e}")

    result = {
        "iso": iso,
        "average_temperature_f": round(sum(temps) / len(temps), 1) if temps else None,
        "average_wind_speed_mph": round(sum(wind_speeds) / len(wind_speeds), 1) if wind_speeds else None,
        "locations": details,
    }
    cache.set(f"weather:{iso}", result, ttl_seconds=300)
    return result
