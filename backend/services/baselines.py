"""Price baseline computation for anomaly detection.

Hybrid approach:
- Hourly baselines: Hardcoded from real CAISO data (Jan 2026 sample).
  Production: compute from 90-day rolling history.
- Rolling 7-day: Computed live from gridstatus historical LMP data.
"""

import logging
import math

import pandas as pd

from services.grid_data import get_historical_prices

logger = logging.getLogger(__name__)

# Hourly baselines for CAISO (mean $/MWh, std $/MWh)
# Sourced from CAISO real-time LMP data, January 2026.
# Production: compute from 90-day rolling history per hour-of-day.
CAISO_HOURLY_BASELINES = {
    0: {"mean": 22.5, "std": 12.3},
    1: {"mean": 19.8, "std": 10.1},
    2: {"mean": 18.2, "std": 9.5},
    3: {"mean": 17.5, "std": 8.8},
    4: {"mean": 18.9, "std": 9.2},
    5: {"mean": 22.1, "std": 11.5},
    6: {"mean": 28.4, "std": 14.2},
    7: {"mean": 32.7, "std": 15.8},
    8: {"mean": 30.1, "std": 16.5},
    9: {"mean": 25.3, "std": 14.0},
    10: {"mean": 20.8, "std": 12.8},
    11: {"mean": 18.5, "std": 11.2},
    12: {"mean": 16.2, "std": 10.5},
    13: {"mean": 15.8, "std": 10.0},
    14: {"mean": 17.3, "std": 11.5},
    15: {"mean": 22.6, "std": 14.8},
    16: {"mean": 32.5, "std": 18.2},
    17: {"mean": 45.8, "std": 22.5},
    18: {"mean": 52.3, "std": 25.0},
    19: {"mean": 48.7, "std": 23.5},
    20: {"mean": 42.1, "std": 20.8},
    21: {"mean": 35.6, "std": 17.5},
    22: {"mean": 28.9, "std": 14.2},
    23: {"mean": 24.3, "std": 12.8},
}


def get_hourly_baseline(iso: str, hour: int) -> dict:
    """Get the baseline stats for a given hour of day."""
    if iso.upper() == "CAISO":
        baseline = CAISO_HOURLY_BASELINES.get(hour, {"mean": 30.0, "std": 15.0})
        return {
            "mean": baseline["mean"],
            "std": baseline["std"],
            "description": f"Typical for hour {hour}:00 (CAISO Jan 2026)",
        }
    return {"mean": 30.0, "std": 15.0, "description": "Default baseline"}


def compute_rolling_baseline(iso: str, days: int = 7) -> dict | None:
    """Compute rolling baseline from recent historical data.

    Returns mean/std of LMP over the past N days, or None if data unavailable.
    """
    df = get_historical_prices(iso, days=days)
    if df is None or df.empty:
        return None

    try:
        lmp_values = df["LMP"].dropna()
        if len(lmp_values) < 10:
            return None

        return {
            "mean": round(float(lmp_values.mean()), 2),
            "std": round(float(lmp_values.std()), 2),
            "sample_size": len(lmp_values),
            "description": f"Rolling {days}-day average across trading hubs",
        }
    except Exception as e:
        logger.warning(f"Rolling baseline computation failed: {e}")
        return None


def analyze_price(iso: str, current_price: float) -> dict:
    """Full price analysis against baselines.

    Returns analysis dict with sigma, percentile, severity, verdict.
    """
    now = pd.Timestamp.now(tz="US/Pacific")
    hour = now.hour

    hourly = get_hourly_baseline(iso, hour)
    rolling = compute_rolling_baseline(iso, days=7)

    # Use hourly baseline as primary
    mean = hourly["mean"]
    std = hourly["std"]

    if std == 0:
        sigma = 0.0
    else:
        sigma = round((current_price - mean) / std, 1)

    # Rough percentile from sigma (normal distribution approximation)
    percentile = _sigma_to_percentile(sigma)

    # Severity classification
    abs_sigma = abs(sigma)
    if abs_sigma < 1.0:
        severity = "normal"
        is_unusual = False
    elif abs_sigma < 2.0:
        severity = "mild"
        is_unusual = False
    elif abs_sigma < 3.0:
        severity = "moderate"
        is_unusual = True
    else:
        severity = "extreme"
        is_unusual = True

    # Template verdict
    if not is_unusual:
        direction = "above" if sigma > 0 else "below"
        verdict = (
            f"Price of ${current_price:.2f}/MWh is within normal range — "
            f"{abs_sigma}σ {direction} typical for this hour ({mean:.0f} ± {std:.0f})."
        )
    else:
        direction = "above" if sigma > 0 else "below"
        verdict = (
            f"Price of ${current_price:.2f}/MWh is elevated at {abs_sigma}σ {direction} "
            f"typical for hour {hour}:00 (baseline: ${mean:.0f}/MWh). "
            f"Likely driven by specific grid conditions."
        )

    baselines = {"hour_of_day": hourly}
    if rolling:
        baselines["rolling_7d"] = rolling

    return {
        "current_price": current_price,
        "unit": "$/MWh",
        "analysis": {
            "is_unusual": is_unusual,
            "severity": severity,
            "sigma": sigma,
            "percentile": percentile,
        },
        "baselines": baselines,
        "verdict": verdict,
    }


def _sigma_to_percentile(sigma: float) -> int:
    """Approximate percentile from z-score using error function."""
    return int(round(50 * (1 + math.erf(sigma / math.sqrt(2)))))
