"""FastAPI application entry point for gridstatus API."""

import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from errors import register_error_handlers

# Structured logging: JSON for production, human-readable for local
if settings.is_production:
    logging.basicConfig(
        level=logging.INFO,
        format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
        stream=sys.stdout,
    )
else:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(title="GridStatus API", version="1.0.0")

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Centralized error handlers
    register_error_handlers(app)

    from routes.health import router as health_router
    from routes.grid import router as grid_router
    from routes.market import router as market_router

    app.include_router(health_router)
    app.include_router(grid_router)
    app.include_router(market_router)

    @app.on_event("startup")
    async def _validate_config() -> None:
        missing = settings.validate()
        if missing:
            logger.warning("Missing env vars (AI features may fail): %s", ", ".join(missing))

    return app


app = create_app()
