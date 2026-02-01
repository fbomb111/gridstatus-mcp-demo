"""Wrapper around the gridstatus library for CAISO data.

Provides clean dict responses from gridstatus DataFrame calls.
CAISO-only for MVP — ISO parameter exists for future expansion.
"""

import logging

import gridstatus
import pandas as pd

from services.cache import cache

logger = logging.getLogger(__name__)

# CAISO trading hubs for LMP queries
# NP15 = Northern CA, SP15 = Southern CA, ZP26 = Central CA
CAISO_HUBS = ["TH_NP15_GEN-APND", "TH_SP15_GEN-APND", "TH_ZP26_GEN-APND"]

_isos = {
    "CAISO": gridstatus.CAISO,
}


def _get_iso(iso: str):
    cls = _isos.get(iso.upper())
    if not cls:
        raise ValueError(f"Unsupported ISO: {iso}. Supported: {list(_isos.keys())}")
    return cls()


def get_fuel_mix(iso: str = "CAISO") -> dict:
    """Get latest fuel mix as {source: MW} dict."""
    cached = cache.get(f"fuel_mix:{iso}")
    if cached:
        return cached

    obj = _get_iso(iso)
    df = obj.get_fuel_mix("latest")
    if df.empty:
        raise ValueError(f"No fuel mix data returned from {iso}")
    row = df.iloc[0]

    result = {
        "timestamp": str(row["Interval Start"]),
        "sources": {
            col: int(row[col])
            for col in df.columns
            if col not in ("Time", "Interval Start", "Interval End")
        },
    }
    cache.set(f"fuel_mix:{iso}", result, ttl_seconds=60)
    return result


def get_load(iso: str = "CAISO") -> dict:
    """Get latest load in MW."""
    cached = cache.get(f"load:{iso}")
    if cached:
        return cached

    obj = _get_iso(iso)
    df = obj.get_load("latest")
    if df.empty:
        raise ValueError(f"No load data returned from {iso}")
    row = df.iloc[0]

    result = {
        "timestamp": str(row["Interval Start"]),
        "current_mw": int(row["Load"]),
    }
    cache.set(f"load:{iso}", result, ttl_seconds=60)
    return result


def get_prices(iso: str = "CAISO") -> dict:
    """Get latest LMP prices from trading hubs."""
    cached = cache.get(f"prices:{iso}")
    if cached:
        return cached

    obj = _get_iso(iso)
    df = obj.get_lmp(
        "latest",
        market="REAL_TIME_5_MIN",
        locations=CAISO_HUBS,
    )

    by_hub = {}
    for _, row in df.iterrows():
        by_hub[row["Location"]] = round(float(row["LMP"]), 2)

    avg = round(sum(by_hub.values()) / len(by_hub), 2) if by_hub else 0.0
    timestamp = str(df.iloc[0]["Interval Start"]) if len(df) > 0 else None

    result = {
        "timestamp": timestamp,
        "average_lmp": avg,
        "by_hub": by_hub,
        "unit": "$/MWh",
    }
    cache.set(f"prices:{iso}", result, ttl_seconds=60)
    return result


def get_status(iso: str = "CAISO") -> dict:
    """Get grid status (normal, alert, etc.)."""
    cached = cache.get(f"status:{iso}")
    if cached:
        return cached

    obj = _get_iso(iso)
    try:
        status = obj.get_status("latest")
        result = {
            "status": str(status.status),
            "reserves": str(status.reserves) if status.reserves else None,
            "time": str(status.time),
        }
    except Exception as e:
        logger.warning("Grid status unavailable: %s", e)
        result = {"status": "unavailable", "reserves": None, "time": None}

    cache.set(f"status:{iso}", result, ttl_seconds=60)
    return result


def get_historical_prices(
    iso: str = "CAISO", days: int = 7
) -> pd.DataFrame | None:
    """Fetch historical LMP data for baseline computation.

    Returns raw DataFrame or None if fetch fails.
    """
    cached = cache.get(f"hist_prices:{iso}:{days}")
    if cached is not None:
        return cached

    obj = _get_iso(iso)
    end = pd.Timestamp.now(tz="US/Pacific")
    start = end - pd.Timedelta(days=days)

    try:
        df = obj.get_lmp(
            date=start,
            end=end,
            market="REAL_TIME_5_MIN",
            locations=CAISO_HUBS,
        )
        # Cache historical data longer — it doesn't change
        cache.set(f"hist_prices:{iso}:{days}", df, ttl_seconds=3600)
        return df
    except Exception as e:
        logger.warning("Historical price fetch failed: %s", e)
        return None
