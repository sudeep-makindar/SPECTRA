"""
API routes for Spectra.

Phase 0: health + metrics + config endpoints.
Phase 1: source CRUD with token generation, source lifecycle.
"""

from __future__ import annotations

import time
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import load_config
from app.core.device import device_info
from app.core.metrics import MetricsCollector
from app.ingest.registry import SourceRegistry
from app.ingest.base import SourceKind

logger = logging.getLogger("spectra.api")
router = APIRouter()


# ── Request/Response models ────────────────────────────────────────────

class CreateSourceRequest(BaseModel):
    name: str
    kind: str  # "video" | "audio"
    adapter: str  # "file_loop" | "webcam" | "rtsp_http" | "browser_node" | "simulated"
    url: Optional[str] = None
    zone_id: Optional[str] = None
    config: Optional[dict] = None


class UpdateSourceRequest(BaseModel):
    name: Optional[str] = None
    zone_id: Optional[str] = None


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


# ── Source CRUD ────────────────────────────────────────────────────────

@router.get("/sources", tags=["sources"])
async def list_sources() -> list[dict]:
    """List all registered sources with their status."""
    return SourceRegistry.instance().to_list()


@router.post("/sources", tags=["sources"])
async def create_source(req: CreateSourceRequest) -> dict:
    """Register a new source. Returns the source entry with its auth token.

    For browser nodes, the token must be used when connecting via /ws/node.
    For other adapters, the source is started automatically.
    """
    registry = SourceRegistry.instance()

    kind = SourceKind.VIDEO if req.kind == "video" else SourceKind.AUDIO

    # Create adapter instance based on type
    adapter = None
    if req.adapter == "file_loop":
        if not req.url:
            raise HTTPException(status_code=400, detail="file_loop adapter requires a 'url' (file path)")
        from app.ingest.adapters import FileLoopSource
        sid_prefix = f"file-{len(registry.all()) + 1}"
        adapter = FileLoopSource(
            source_id=sid_prefix,
            name=req.name,
            file_path=req.url,
            target_fps=req.config.get("fps", 5) if req.config else 5,
        )

    elif req.adapter == "simulated":
        from app.ingest.adapters import SimulatedSource
        sid_prefix = f"sim-{len(registry.all()) + 1}"
        adapter = SimulatedSource(
            source_id=sid_prefix,
            name=req.name,
            target_fps=req.config.get("fps", 5) if req.config else 5,
        )

    elif req.adapter == "webcam":
        from app.ingest.adapters import LocalWebcamSource
        sid_prefix = f"cam-{len(registry.all()) + 1}"
        adapter = LocalWebcamSource(
            source_id=sid_prefix,
            name=req.name,
            device_index=req.config.get("device_index", 0) if req.config else 0,
            target_fps=req.config.get("fps", 5) if req.config else 5,
        )

    elif req.adapter == "rtsp_http":
        if not req.url:
            raise HTTPException(status_code=400, detail="rtsp_http adapter requires a 'url'")
        from app.ingest.adapters import RtspHttpVideoSource
        sid_prefix = f"rtsp-{len(registry.all()) + 1}"
        adapter = RtspHttpVideoSource(
            source_id=sid_prefix,
            name=req.name,
            url=req.url,
            target_fps=req.config.get("fps", 5) if req.config else 5,
        )

    elif req.adapter == "browser_node":
        # No adapter needed — browser nodes connect via /ws/node
        sid_prefix = f"node-{len(registry.all()) + 1}"

    else:
        raise HTTPException(status_code=400, detail=f"Unknown adapter type: {req.adapter}")

    source_id = adapter.source_id if adapter else sid_prefix

    entry = registry.register(
        name=req.name,
        kind=kind,
        adapter_type=req.adapter,
        zone_id=req.zone_id,
        source_id=source_id,
        adapter=adapter,
    )

    # Auto-start non-browser adapters
    if adapter:
        import asyncio
        asyncio.create_task(_start_source(source_id))

    result = entry.to_dict()
    result["token"] = entry.token  # Include token only in creation response
    return result


async def _start_source(source_id: str) -> None:
    """Start a source adapter (runs as a background task)."""
    await SourceRegistry.instance().start_source(source_id)


@router.delete("/sources/{source_id}", tags=["sources"])
async def delete_source(source_id: str) -> dict:
    """Stop and remove a source."""
    registry = SourceRegistry.instance()
    entry = registry.get(source_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Source not found")

    await registry.stop_source(source_id)
    registry.unregister(source_id)
    return {"status": "deleted", "source_id": source_id}


@router.post("/sources/{source_id}/start", tags=["sources"])
async def start_source(source_id: str) -> dict:
    """Start a source adapter."""
    registry = SourceRegistry.instance()
    entry = registry.get(source_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Source not found")

    await registry.start_source(source_id)
    return {"status": "started", "source_id": source_id}


@router.post("/sources/{source_id}/stop", tags=["sources"])
async def stop_source(source_id: str) -> dict:
    """Stop a source adapter."""
    registry = SourceRegistry.instance()
    entry = registry.get(source_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Source not found")

    await registry.stop_source(source_id)
    return {"status": "stopped", "source_id": source_id}


# ── Zone CRUD (stub for Phase 3) ──────────────────────────────────────

@router.get("/zones", tags=["zones"])
async def list_zones() -> list[dict]:
    """List all zones. Implemented in Phase 3."""
    return []


# ── Incident list (stub for Phase 4) ──────────────────────────────────

@router.get("/incidents", tags=["incidents"])
async def list_incidents() -> list[dict]:
    """List all incidents. Implemented in Phase 4."""
    return []
