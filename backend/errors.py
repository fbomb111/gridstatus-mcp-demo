"""Custom exceptions and centralized FastAPI error handlers."""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class GridStatusError(Exception):
    """Base exception with HTTP status code."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class UnsupportedISOError(GridStatusError):
    def __init__(self, iso: str, supported: set[str]):
        super().__init__(
            f"Unsupported ISO: {iso}. Supported: {sorted(supported)}",
            status_code=400,
        )


def register_error_handlers(app: FastAPI) -> None:
    """Register centralized exception handlers on the FastAPI app."""

    @app.exception_handler(GridStatusError)
    async def handle_gridstatus_error(_request: Request, exc: GridStatusError):
        return JSONResponse({"error": str(exc)}, status_code=exc.status_code)

    @app.exception_handler(ValueError)
    async def handle_value_error(_request: Request, exc: ValueError):
        return JSONResponse({"error": str(exc)}, status_code=400)

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception):
        logger.exception("Unhandled error: %s", exc)
        return JSONResponse(
            {"error": "Internal server error"},
            status_code=500,
        )
