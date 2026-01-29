"""Health check route with Foundry connectivity test."""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from services.foundry_client import complete

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health():
    """Health check that verifies Foundry model connectivity."""
    result = {"status": "ok", "service": "gridstatus-api", "ai": "not_tested"}

    try:
        response = complete(
            messages=[{"role": "user", "content": "Say 'hello' and nothing else."}],
            max_tokens=10,
        )
        result["ai"] = "connected"
        result["ai_response"] = response.strip()
    except Exception as e:
        logger.exception("Foundry health check failed")
        result["ai"] = "error"
        result["ai_error"] = str(e)

    return result
