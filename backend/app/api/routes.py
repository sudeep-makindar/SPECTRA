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
    from app.perception.workers import PerceptionManager
    from app.ai.copilot import Copilot
    from app.models.registry import ModelRegistry
    models = []
    for name in ("yolo", "motion", "audio"):
        m = ModelRegistry.instance().get(name)
        info = m.info() if m else None
        models.append({"key": name, "status": PerceptionManager.instance().model_status.get(name, "loading"),
                       **({"name": info.name, "version": info.version, "device": info.device} if info else {})})
    return {
        "status": "ok",
        "timestamp": time.time(),
        "version": "1.0.0",
        "device": device_info(),
        "sim_mode": config.sim_mode,
        "models": models,
        "copilot": Copilot.instance().status(),
        "face_blur": config.evidence.face_blur,
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

    elif req.adapter == "local_mic":
        from app.ingest.adapters import LocalMicSource
        kind = SourceKind.AUDIO
        sid_prefix = f"mic-{len(registry.all()) + 1}"
        adapter = LocalMicSource(
            source_id=sid_prefix,
            name=req.name,
            device=req.config.get("device") if req.config else None,
        )

    elif req.adapter == "browser_node":
        # No adapter needed — browser nodes connect via /ws/node
        sid_prefix = f"node-{len(registry.all()) + 1}"

    else:
        raise HTTPException(status_code=400, detail=f"Unknown adapter type: {req.adapter}")

    source_id = adapter.source_id if adapter else sid_prefix
    if source_id in {e.source_id for e in registry.all()}:
        import uuid
        source_id = f"{source_id}-{uuid.uuid4().hex[:4]}"
        if adapter:
            adapter.source_id = source_id

    from app.zones.manager import ZoneManager
    zone_id = req.zone_id if req.zone_id and ZoneManager.instance().get(req.zone_id) else ZoneManager.instance().default_zone_id()

    entry = registry.register(
        name=req.name,
        kind=kind,
        adapter_type=req.adapter,
        zone_id=zone_id,
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


# ── Source → zone assignment ──────────────────────────────────────────

@router.patch("/sources/{source_id}", tags=["sources"])
async def update_source(source_id: str, req: UpdateSourceRequest) -> dict:
    entry = SourceRegistry.instance().get(source_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Source not found")
    if req.name:
        entry.name = req.name
    if req.zone_id is not None:
        from app.zones.manager import ZoneManager
        if req.zone_id and not ZoneManager.instance().get(req.zone_id):
            raise HTTPException(status_code=400, detail="Unknown zone")
        entry.zone_id = req.zone_id or None
    return entry.to_dict()


# ── Zones ──────────────────────────────────────────────────────────────

class ZoneRequest(BaseModel):
    name: Optional[str] = None
    area_m2: Optional[float] = None
    capacity: Optional[int] = None
    kind: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None
    sop: Optional[list[str]] = None


@router.get("/zones", tags=["zones"])
async def list_zones() -> list[dict]:
    from app.zones.manager import ZoneManager
    return [z.to_dict() for z in ZoneManager.instance().all()]


@router.post("/zones", tags=["zones"])
async def create_zone(req: ZoneRequest) -> dict:
    from app.zones.manager import ZoneManager
    if not req.name:
        raise HTTPException(status_code=400, detail="name is required")
    fields = {k: v for k, v in req.model_dump().items() if v is not None and k != "name"}
    return ZoneManager.instance().create(req.name, **fields).to_dict()


@router.patch("/zones/{zone_id}", tags=["zones"])
async def update_zone(zone_id: str, req: ZoneRequest) -> dict:
    from app.zones.manager import ZoneManager
    cfg = ZoneManager.instance().update(zone_id, **req.model_dump())
    if not cfg:
        raise HTTPException(status_code=404, detail="Zone not found")
    return cfg.to_dict()


@router.delete("/zones/{zone_id}", tags=["zones"])
async def delete_zone(zone_id: str) -> dict:
    from app.zones.manager import ZoneManager
    if not ZoneManager.instance().delete(zone_id):
        raise HTTPException(status_code=400, detail="Cannot delete (unknown or last zone)")
    for e in SourceRegistry.instance().all():
        if e.zone_id == zone_id:
            e.zone_id = None
    return {"status": "deleted"}


@router.post("/zones/{zone_id}/acknowledge", tags=["zones"])
async def acknowledge_zone(zone_id: str) -> dict:
    from app.fusion.engine import FusionEngine
    FusionEngine.instance().acknowledge(zone_id)
    return {"status": "acknowledged"}


# ── Scenario director ─────────────────────────────────────────────────

class ScenarioRequest(BaseModel):
    scenario: str
    zone_id: str


@router.get("/scenarios", tags=["scenarios"])
async def list_scenarios() -> dict:
    from app.scenarios.director import ScenarioDirector
    d = ScenarioDirector.instance()
    return {"catalog": d.catalog(), "active": d.active()}


@router.post("/scenarios/start", tags=["scenarios"])
async def start_scenario(req: ScenarioRequest) -> dict:
    from app.scenarios.director import ScenarioDirector, SCENARIOS
    from app.fusion.engine import FusionEngine
    if req.scenario not in SCENARIOS:
        raise HTTPException(status_code=400, detail="Unknown scenario")
    if not FusionEngine.instance().get_zone(req.zone_id):
        raise HTTPException(status_code=400, detail="Unknown zone")
    ScenarioDirector.instance().start(req.scenario, req.zone_id)
    FusionEngine.instance().log_event(req.zone_id, "scenario", "notice",
                                      f"SIMULATION started: {SCENARIOS[req.scenario]['title']}")
    return {"status": "started"}


@router.post("/scenarios/stop", tags=["scenarios"])
async def stop_scenario(zone_id: Optional[str] = None) -> dict:
    from app.scenarios.director import ScenarioDirector
    d = ScenarioDirector.instance()
    d.stop(zone_id) if zone_id else d.stop_all()
    return {"status": "stopped"}


# ── AI co-pilot ───────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str


@router.post("/copilot/ask", tags=["copilot"])
async def copilot_ask(req: AskRequest) -> dict:
    from app.ai.copilot import Copilot
    return await Copilot.instance().ask(req.question[:500])


@router.get("/copilot/status", tags=["copilot"])
async def copilot_status() -> dict:
    from app.ai.copilot import Copilot
    return Copilot.instance().status()


# ── Network info (for phone pairing QR codes) ─────────────────────────

@router.get("/network", tags=["system"])
async def network_info() -> dict:
    import socket
    ips: list[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        import psutil
        for addrs in psutil.net_if_addrs().values():
            for a in addrs:
                if a.family == socket.AF_INET and not a.address.startswith("127.") and a.address not in ips:
                    ips.append(a.address)
    except Exception:
        pass
    return {"lan_ips": ips}


# ── Evaluation harness ────────────────────────────────────────────────

@router.get("/eval/latest", tags=["evaluation"])
async def eval_latest() -> dict:
    from app.evaluation.harness import load_report
    report = load_report()
    if not report:
        raise HTTPException(status_code=404, detail="No evaluation report yet")
    return report


@router.post("/eval/run", tags=["evaluation"])
async def eval_run(trials: int = 40) -> dict:
    import asyncio
    from app.evaluation.harness import run_evaluation, save_report
    report = await asyncio.to_thread(run_evaluation, min(max(trials, 5), 200))
    save_report(report)
    return report
