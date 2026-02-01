"""Health and readiness check routes."""

import logging

from fastapi import APIRouter

from config import settings
from services.foundry_client import complete

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/ready")
async def ready() -> dict:
    """Lightweight readiness check — no external calls."""
    return {"status": "ok", "service": "gridstatus-api", "commit": settings.git_sha}


@router.get("/health")
async def health() -> dict:
    """Deep health check that verifies Foundry model connectivity."""
    result = {"status": "ok", "service": "gridstatus-api", "commit": settings.git_sha, "ai": "not_tested"}

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
