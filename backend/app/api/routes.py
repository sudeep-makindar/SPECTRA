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


# ── Zone CRUD ──────────────────────────────────────────────────────────

class CreateZoneRequest(BaseModel):
    name: str
    capacity: Optional[int] = 50
    source_ids: Optional[list[str]] = None
    thresholds: Optional[dict] = None


@router.get("/zones", tags=["zones"])
async def list_zones() -> list[dict]:
    """List all configured zones with assigned sources and live states."""
    import uuid
    from sqlmodel import select
    from app.db.session import get_session
    from app.db.models import Zone as DbZone
    from app.fusion.engine import FusionEngine

    registry = SourceRegistry.instance()
    fusion = FusionEngine.instance()

    with get_session() as session:
        zones = session.exec(select(DbZone)).all()
        # If DB has no zones yet, seed a default zone so monitoring works immediately
        if not zones:
            default_zone = DbZone(id="zone-1", name="Main Gate & Plaza", capacity=50)
            session.add(default_zone)
            session.commit()
            session.refresh(default_zone)
            zones = [default_zone]

        result = []
        for z in zones:
            assigned = [
                s.to_dict() for s in registry.all() if s.zone_id == z.id
            ]
            live_state = fusion.get_or_create_zone(z.id, z.name)
            result.append({
                "id": z.id,
                "name": z.name,
                "capacity": z.capacity or 50,
                "sources": assigned,
                "source_count": len(assigned),
                "risk_score": round(live_state.risk_score, 3),
                "alert_level": live_state.alert_level,
                "vision_score": round(live_state.vision.score, 3),
                "motion_score": round(live_state.motion.score, 3),
                "audio_score": round(live_state.audio.score, 3),
                "created_at": z.created_at,
            })
        return result


@router.post("/zones", tags=["zones"])
async def create_zone(req: CreateZoneRequest) -> dict:
    """Create a new zone and optionally bind sources to it."""
    import uuid
    from app.db.session import get_session
    from app.db.models import Zone as DbZone
    from app.fusion.engine import FusionEngine

    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Zone name cannot be empty")

    registry = SourceRegistry.instance()
    fusion = FusionEngine.instance()
    zone_id = f"zone-{uuid.uuid4().hex[:6]}"

    with get_session() as session:
        db_zone = DbZone(
            id=zone_id,
            name=req.name.strip(),
            capacity=req.capacity or 50,
        )
        session.add(db_zone)
        session.commit()
        session.refresh(db_zone)

    live_state = fusion.get_or_create_zone(zone_id, db_zone.name)

    assigned = []
    if req.source_ids:
        for sid in req.source_ids:
            entry = registry.get(sid)
            if entry:
                entry.zone_id = zone_id
                assigned.append(entry.to_dict())

    return {
        "id": db_zone.id,
        "name": db_zone.name,
        "capacity": db_zone.capacity,
        "sources": assigned,
        "source_count": len(assigned),
        "risk_score": round(live_state.risk_score, 3),
        "alert_level": live_state.alert_level,
        "created_at": db_zone.created_at,
    }


@router.delete("/zones/{zone_id}", tags=["zones"])
async def delete_zone(zone_id: str) -> dict:
    """Delete a zone and unassign its sources."""
    from app.db.session import get_session
    from app.db.models import Zone as DbZone
    from app.fusion.engine import FusionEngine

    registry = SourceRegistry.instance()
    fusion = FusionEngine.instance()

    with get_session() as session:
        db_zone = session.get(DbZone, zone_id)
        if not db_zone:
            raise HTTPException(status_code=404, detail="Zone not found")
        session.delete(db_zone)
        session.commit()

    for s in registry.all():
        if s.zone_id == zone_id:
            s.zone_id = None

    if zone_id in fusion._zones:
        del fusion._zones[zone_id]

    return {"status": "deleted", "zone_id": zone_id}
