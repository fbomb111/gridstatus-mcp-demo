"""Grid status route — fetch live data + AI summary."""

import json
import logging

import azure.functions as func
import gridstatus

from services.foundry_client import complete

logger = logging.getLogger(__name__)

bp = func.Blueprint()


@bp.route(route="grid/fuel-mix", methods=["GET"])
async def fuel_mix(req: func.HttpRequest) -> func.HttpResponse:
    """Fetch latest CAISO fuel mix and return an AI-generated summary."""
    try:
        caiso = gridstatus.CAISO()
        df = caiso.get_fuel_mix("latest")

        # Build a simple dict of source → MW
        row = df.iloc[0]
        fuel_data = {
            col: int(row[col])
            for col in df.columns
            if col not in ("Time", "Interval Start", "Interval End")
        }
        timestamp = str(row["Interval Start"])

        ai_response = await complete(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an energy grid analyst. Summarize the fuel mix data "
                        "in 2-3 sentences. Note anything interesting about the current "
                        "generation mix. Be concise."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Here is the latest CAISO fuel mix as of {timestamp} "
                        f"(values in MW):\n{json.dumps(fuel_data, indent=2)}"
                    ),
                },
            ],
            max_tokens=200,
        )

        result = {
            "timestamp": timestamp,
            "fuel_mix_mw": fuel_data,
            "ai_summary": ai_response.strip(),
        }

    except Exception as e:
        logger.exception("Fuel mix endpoint failed")
        result = {"error": str(e)}
        return func.HttpResponse(
            json.dumps(result), mimetype="application/json", status_code=500
        )

    return func.HttpResponse(json.dumps(result), mimetype="application/json")
