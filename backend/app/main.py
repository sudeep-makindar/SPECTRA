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


def _load_dotenv() -> None:
    """Minimal .env loader (project root) so ANTHROPIC_API_KEY can live in .env."""
    import os
    env = PROJECT_ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()
from app.core.logging import setup_logging
from app.core.metrics import MetricsCollector
from app.core.device import device_info
from app.api.routes import router as api_router
from app.ws.handlers import router as ws_router
from app.ingest.registry import SourceRegistry
from app.perception.workers import PerceptionManager
from app.fusion.engine import FusionEngine
from app.evidence.manager import EvidenceManager
from app.api.incidents import router as incidents_router

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

    # Initialize the DB
    from app.db.session import init_db
    init_db()

    # Start source staleness monitor
    registry = SourceRegistry.instance()
    await registry.start_staleness_monitor()

    # If sim_mode, auto-create simulated sources for demo
    if config.sim_mode:
        logger.info("SIM MODE: creating simulated sources for demo")
        from app.ingest.adapters import SimulatedSource

        for i, name in enumerate(["Gate Cam 1", "Gate Cam 2", "Stage Cam"]):
            adapter = SimulatedSource(
                source_id=f"sim-{i+1}",
                name=name,
                target_fps=5,
            )
            from app.ingest.base import SourceKind
            entry = registry.register(
                name=name,
                kind=SourceKind.VIDEO,
                adapter_type="simulated",
                source_id=f"sim-{i+1}",
                adapter=adapter,
            )
            await registry.start_source(f"sim-{i+1}")

    # Zones + incident history
    from app.zones.manager import ZoneManager
    from app.incidents.store import IncidentStore
    ZoneManager.instance()
    IncidentStore.instance()

    # Evaluation report (fast, ~2 s) so the System page always has numbers
    from app.evaluation.harness import load_report, run_evaluation, save_report
    import asyncio
    if not load_report():
        async def _eval():
            save_report(await asyncio.to_thread(run_evaluation, 40))
            logger.info("Initial evaluation report generated")
        asyncio.create_task(_eval())

    from app.ai.copilot import Copilot
    logger.info("Claude co-pilot: %s", Copilot.instance().status()["model"])

    # Start Evidence Manager (Phase 4)
    evidence = EvidenceManager.instance()
    await evidence.start()

    # Start Fusion Engine
    fusion = FusionEngine.instance()
    await fusion.start()

    # Start Perception Manager
    perception = PerceptionManager.instance()
    perception.on_sample = fusion.on_sample_received
    await perception.start()

    logger.info("Startup complete — ready to accept connections")

    yield  # ── App runs here ──

    logger.info("Shutting down Spectra…")
    
    await perception.stop()
    await fusion.stop()
    await evidence.stop()
    
    await registry.stop_all()
    logger.info("All sources stopped. Goodbye.")


# ── App factory ────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    config = load_config()

    app = FastAPI(
        title="Spectra",
        description="Multimodal crowd-safety intelligence platform",
        version="1.0.0",
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
    app.include_router(incidents_router)

    # WebSocket routes
    app.include_router(ws_router)

    # Serve incident clips with range support
    if DATA_DIR.exists():
        app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")

    # In production, serve the built frontend
    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    if frontend_dist.exists():
        app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

    return app


app = create_app()
