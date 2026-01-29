"""FastAPI application entry point for gridstatus API."""

import logging

from fastapi import FastAPI

logging.basicConfig(level=logging.INFO)


def create_app() -> FastAPI:
    app = FastAPI(title="GridStatus API", version="1.0.0")

    from routes.health import router as health_router
    from routes.grid import router as grid_router
    from routes.market import router as market_router

    app.include_router(health_router)
    app.include_router(grid_router)
    app.include_router(market_router)

    return app


app = create_app()
