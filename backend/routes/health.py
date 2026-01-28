"""Health check route with Foundry connectivity test."""

import json
import logging

import azure.functions as func

from services.foundry_client import complete

logger = logging.getLogger(__name__)

bp = func.Blueprint()


@bp.route(route="health", methods=["GET"])
async def health(req: func.HttpRequest) -> func.HttpResponse:
    """Health check that verifies Foundry model connectivity."""
    result = {"status": "ok", "ai": "not_tested"}

    try:
        response = await complete(
            messages=[{"role": "user", "content": "Say 'hello' and nothing else."}],
            max_tokens=10,
        )
        result["ai"] = "connected"
        result["ai_response"] = response.strip()
    except Exception as e:
        logger.exception("Foundry health check failed")
        result["ai"] = "error"
        result["ai_error"] = str(e)

    return func.HttpResponse(
        json.dumps(result),
        mimetype="application/json",
    )
