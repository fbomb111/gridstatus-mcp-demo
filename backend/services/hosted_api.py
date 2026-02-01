"""GridStatus.io hosted API client — authenticated access to historical multi-ISO data.

Unlike the open-source gridstatus library (which scrapes public ISO websites),
this uses the gridstatus.io hosted API which requires an API key and provides
access to all US ISOs with historical data, filtering, and pagination.
"""

import logging

from gridstatusio import GridStatusClient

logger = logging.getLogger(__name__)

SUPPORTED_ISOS = {"CAISO", "ERCOT", "PJM", "MISO", "NYISO", "ISONE", "SPP"}

# Map user-friendly dataset names to gridstatusio dataset IDs
DATASET_MAP = {
    "CAISO": {"lmp": "caiso.lmp_real_time_15_min", "load": "caiso.system_demand", "fuel_mix": "caiso.fuel_mix"},
    "ERCOT": {"lmp": "ercot.spp", "load": "ercot.system_demand", "fuel_mix": "ercot.fuel_mix"},
    "PJM": {"lmp": "pjm.lmp_real_time_5_min", "load": "pjm.system_demand", "fuel_mix": "pjm.fuel_mix"},
    "MISO": {"lmp": "miso.lmp_real_time_5_min", "load": "miso.system_demand", "fuel_mix": "miso.fuel_mix"},
    "NYISO": {"lmp": "nyiso.lmp_real_time_5_min", "load": "nyiso.system_demand", "fuel_mix": "nyiso.fuel_mix"},
    "ISONE": {"lmp": "isone.lmp_real_time_5_min", "load": "isone.system_demand", "fuel_mix": "isone.fuel_mix"},
    "SPP": {"lmp": "spp.lmp_real_time_5_min", "load": "spp.system_demand", "fuel_mix": "spp.fuel_mix"},
}


def query_historical(
    api_key: str,
    iso: str,
    dataset: str,
    start: str | None = None,
    end: str | None = None,
    limit: int = 100,
) -> dict:
    """Query historical grid data via the gridstatusio hosted API.

    Args:
        api_key: GridStatus.io API key (per-request, from MCP OAuth token).
        iso: ISO identifier (CAISO, ERCOT, PJM, etc.).
        dataset: Dataset type (lmp, load, fuel_mix).
        start: Start date (YYYY-MM-DD). Optional.
        end: End date (YYYY-MM-DD). Optional.
        limit: Max rows to return (default 100, max 1000).

    Returns:
        Dict with _summary, records, metadata.
    """
    iso = iso.upper()
    if iso not in SUPPORTED_ISOS:
        raise ValueError(f"Unsupported ISO: {iso}. Supported: {sorted(SUPPORTED_ISOS)}")

    if dataset not in DATASET_MAP.get(iso, {}):
        available = list(DATASET_MAP.get(iso, {}).keys())
        raise ValueError(f"Unknown dataset '{dataset}' for {iso}. Available: {available}")

    dataset_id = DATASET_MAP[iso][dataset]
    limit = min(limit, 1000)

    client = GridStatusClient(api_key=api_key)

    kwargs: dict = {"dataset": dataset_id, "limit": limit, "verbose": False}
    if start:
        kwargs["start"] = start
    if end:
        kwargs["end"] = end

    logger.info("Querying gridstatusio: %s (limit=%d, start=%s, end=%s)", dataset_id, limit, start, end)
    df = client.get_dataset(**kwargs)

    # Convert DataFrame to records
    records = df.to_dict(orient="records")

    # Convert timestamps to strings for JSON serialization
    for record in records:
        for key, value in record.items():
            if hasattr(value, "isoformat"):
                record[key] = value.isoformat()

    row_count = len(records)
    date_range = ""
    if records:
        first = records[0]
        last = records[-1]
        # Find a timestamp-like column
        for col in ["interval_start_utc", "interval_start", "timestamp", "time"]:
            if col in first:
                date_range = f" from {first[col]} to {last[col]}"
                break

    _summary = f"{iso} {dataset} data: {row_count} records returned{date_range} (via gridstatus.io hosted API)"

    return {
        "_summary": _summary,
        "iso": iso,
        "dataset": dataset,
        "dataset_id": dataset_id,
        "record_count": row_count,
        "records": records,
    }
