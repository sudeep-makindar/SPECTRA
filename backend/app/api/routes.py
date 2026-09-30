"""
API routes for Spectra.

Phase 0: health + metrics + config endpoints.
Phase 1+: source CRUD, zone CRUD, incidents, etc.
"""

from __future__ import annotations

import time
import logging
from typing import Any

from fastapi import APIRouter

from app.core.config import load_config
from app.core.device import device_info
from app.core.metrics import MetricsCollector

logger = logging.getLogger("spectra.api")
router = APIRouter()


# ── Health ─────────────────────────────────────────────────────────────

@router.get("/health", tags=["system"])
async def health() -> dict[str, Any]:
    """Liveness check. Returns system status and device info.

    A dead health endpoint is never acceptable — this must always respond,
    even if workers are down. That's why it doesn't touch inference or DB.
    """
    config = load_config()
    return {
        "status": "ok",
        "timestamp": time.time(),
        "version": "0.1.0",
        "device": device_info(),
        "sim_mode": config.sim_mode,
    }


@router.get("/metrics", tags=["system"])
async def metrics() -> dict[str, Any]:
    """Full metrics snapshot for the System page."""
    return MetricsCollector.instance().snapshot()


@router.get("/config", tags=["system"])
async def get_config() -> dict[str, Any]:
    """Return current configuration (sanitized — no API keys)."""
    config = load_config()
    data = config.model_dump()
    # Redact sensitive fields
    if "llm" in data and "api_key" in data["llm"]:
        data["llm"]["api_key"] = "***" if data["llm"]["api_key"] else ""
    return data


# ── Source CRUD (stub for Phase 1) ─────────────────────────────────────

@router.get("/sources", tags=["sources"])
async def list_sources() -> list[dict]:
    """List all registered sources. Implemented in Phase 1."""
    return []


@router.get("/zones", tags=["zones"])
async def list_zones() -> list[dict]:
    """List all zones. Implemented in Phase 3."""
    return []


@router.get("/incidents", tags=["incidents"])
async def list_incidents() -> list[dict]:
    """List all incidents. Implemented in Phase 4."""
    return []
