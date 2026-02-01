"""Grid status route — fetch live data + AI summary."""

import json
import logging

from fastapi import APIRouter

from services import grid_data
from services.foundry_client import complete

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/grid/fuel-mix")
async def fuel_mix() -> dict:
    """Fetch latest CAISO fuel mix and return an AI-generated summary."""
    data = grid_data.get_fuel_mix("CAISO")

    ai_response = complete(
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
                    f"Here is the latest CAISO fuel mix as of {data['timestamp']} "
                    f"(values in MW):\n{json.dumps(data['sources'], indent=2)}"
                ),
            },
        ],
        max_tokens=200,
    )

    return {
        "timestamp": data["timestamp"],
        "fuel_mix_mw": data["sources"],
        "ai_summary": ai_response.strip(),
    }
