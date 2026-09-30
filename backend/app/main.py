"""
Spectra — FastAPI application entry point.

Starts the API server, mounts WebSocket endpoints, serves the frontend
in production, and manages lifecycle of worker processes.
"""

from __future__ import annotations

import time
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.core.config import load_config, DATA_DIR, PROJECT_ROOT
from app.core.logging import setup_logging
from app.core.metrics import MetricsCollector
from app.core.device import device_info
from app.api.routes import router as api_router

# ── Lifecycle ──────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle hook."""
    config = load_config()
    setup_logging(level=config.server.log_level)
    logger = logging.getLogger("spectra.main")

    logger.info("═══════════════════════════════════════════════")
    logger.info("  SPECTRA — Multimodal Crowd-Safety Platform")
    logger.info("═══════════════════════════════════════════════")
    logger.info("Device: %s", device_info())
    logger.info("Config: host=%s port=%d sim_mode=%s", config.server.host, config.server.port, config.sim_mode)

    # Ensure data directories
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "incidents").mkdir(exist_ok=True)

    # Initialize the DB (Phase 1+)
    from app.db.session import init_db
    init_db()

    logger.info("Startup complete — ready to accept connections")

    yield  # ── App runs here ──

    logger.info("Shutting down Spectra…")
    # Worker cleanup will go here in later phases


# ── App factory ────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    config = load_config()

    app = FastAPI(
        title="Spectra",
        description="Multimodal crowd-safety intelligence platform",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS — permissive for dev, lock down in production
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.server.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # API routes
    app.include_router(api_router, prefix="/api")

    # Serve incident clips with range support
    if DATA_DIR.exists():
        app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")

    # In production, serve the built frontend
    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    if frontend_dist.exists():
        app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

    return app


app = create_app()
