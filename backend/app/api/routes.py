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

class Capabilities(BaseModel):
    video: bool = False
    audio: bool = False
    speaker: bool = False


class CreateSourceRequest(BaseModel):
    name: str
    kind: Optional[str] = None  # derived from adapter + capabilities when omitted
    adapter: str  # webcam | local_mic | browser_node | rtsp_http | http_audio | file_loop | simulated
    url: Optional[str] = None
    zone_id: Optional[str] = None
    config: Optional[dict] = None
    capabilities: Optional[Capabilities] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class UpdateSourceRequest(BaseModel):
    name: Optional[str] = None
    zone_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


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
    """Add a device and start it. The response carries the pairing token, which
    phones and laptops use to connect to /ws/node."""
    from app.ingest.factory import AdapterError, ID_PREFIX, build_adapter, kind_for, DEFAULT_CAPABILITIES
    from app.zones.manager import ZoneManager
    import uuid

    registry = SourceRegistry.instance()
    existing = {e.source_id for e in registry.all()}
    n = len(existing) + 1
    source_id = f"{ID_PREFIX.get(req.adapter, 'dev')}-{n}"
    if source_id in existing:
        source_id = f"{source_id}-{uuid.uuid4().hex[:4]}"

    try:
        adapter = build_adapter(req.adapter, source_id, req.name, req.url, req.config)
    except AdapterError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    caps = req.capabilities.model_dump() if req.capabilities else DEFAULT_CAPABILITIES.get(req.adapter, {})
    kind = SourceKind(req.kind) if req.kind in ("video", "audio") else kind_for(req.adapter, caps)
    zones = ZoneManager.instance()
    zone_id = req.zone_id if req.zone_id and zones.get(req.zone_id) else zones.default_zone_id()

    entry = registry.register(
        name=req.name, kind=kind, adapter_type=req.adapter, zone_id=zone_id, source_id=source_id,
        adapter=adapter, url=req.url, config=req.config, capabilities=caps, lat=req.lat, lng=req.lng,
    )
    await registry.start_source(source_id)

    result = entry.to_dict()
    result["token"] = entry.token  # only returned here and by /pairing
    return result


@router.get("/sources/{source_id}/pairing", tags=["sources"])
async def source_pairing(source_id: str) -> dict:
    """Token and addresses a phone needs to connect (to show its pairing link again)."""
    entry = SourceRegistry.instance().get(source_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Source not found")
    config = load_config()
    return {"token": entry.token, "port": config.server.port, "lan_ips": (await network_info())["lan_ips"]}


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
    if req.lat is not None and req.lng is not None:
        entry.lat, entry.lng = req.lat, req.lng
    SourceRegistry.instance().save()
    return entry.to_dict()


# ── Zones ──────────────────────────────────────────────────────────────

class ZoneRequest(BaseModel):
    name: Optional[str] = None
    area_m2: Optional[float] = None
    capacity: Optional[int] = None
    kind: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_m: Optional[float] = None
    sop: Optional[list[str]] = None


@router.get("/zones", tags=["zones"])
async def list_zones() -> list[dict]:
    from app.zones.manager import ZoneManager
    return [z.to_dict() for z in ZoneManager.instance().all()]


@router.post("/zones", tags=["zones"])
async def create_zone(req: ZoneRequest) -> dict:
    from app.zones.manager import ZoneManager
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="A zone needs a name")
    fields = {k: v for k, v in req.model_dump().items() if v is not None and k != "name"}
    return ZoneManager.instance().create(req.name.strip(), **fields).to_dict()


@router.delete("/zones/{zone_id}", tags=["zones"])
async def delete_zone(zone_id: str) -> dict:
    """Delete a zone; its devices move to the first remaining zone."""
    from app.zones.manager import ZoneManager
    zones = ZoneManager.instance()
    if not zones.delete(zone_id):
        raise HTTPException(status_code=400, detail="Can't delete: unknown zone, or it's the last one")
    registry = SourceRegistry.instance()
    for e in registry.all():
        if e.zone_id == zone_id:
            e.zone_id = zones.default_zone_id()
    registry.save()
    return {"status": "deleted"}


@router.patch("/zones/{zone_id}", tags=["zones"])
async def update_zone(zone_id: str, req: ZoneRequest) -> dict:
    from app.zones.manager import ZoneManager
    cfg = ZoneManager.instance().update(zone_id, **req.model_dump())
    if not cfg:
        raise HTTPException(status_code=404, detail="Zone not found")
    return cfg.to_dict()


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


# ── Announcements ─────────────────────────────────────────────────────

class AnnounceItem(BaseModel):
    lang: str
    text: str


class AnnounceRequest(BaseModel):
    zone_id: Optional[str] = None  # None = every zone
    items: list[AnnounceItem]


class TranslateRequest(BaseModel):
    text: str
    languages: list[str]


class SpeakerHeartbeat(BaseModel):
    id: str
    name: str = "Dashboard"
    zone_id: Optional[str] = None


@router.post("/announce", tags=["announce"])
async def announce(req: AnnounceRequest) -> dict:
    """Play an announcement on every speaker in a zone (or every zone)."""
    from app.announce import AnnouncementHub
    items = [i.model_dump() for i in req.items if i.text.strip()][:4]
    if not items:
        raise HTTPException(status_code=400, detail="The announcement is empty")
    for i in items:
        i["text"] = i["text"].strip()[:500]
    return await AnnouncementHub.instance().announce(req.zone_id or None, items)


@router.post("/announce/translate", tags=["announce"])
async def translate_announcement(req: TranslateRequest) -> dict:
    from app.ai.copilot import Copilot
    try:
        return {"translations": await Copilot.instance().translate(req.text.strip()[:500], req.languages)}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Translation failed: {type(exc).__name__}")


@router.post("/speakers/heartbeat", tags=["announce"])
async def speaker_heartbeat(req: SpeakerHeartbeat) -> dict:
    """A dashboard switched to "use this computer as a speaker" checks in here."""
    from app.announce import AnnouncementHub
    AnnouncementHub.instance().heartbeat(req.id, req.name, req.zone_id)
    return {"status": "ok"}


@router.delete("/speakers/{speaker_id}", tags=["announce"])
async def speaker_leave(speaker_id: str) -> dict:
    from app.announce import AnnouncementHub
    AnnouncementHub.instance().remove_dashboard(speaker_id)
    return {"status": "ok"}


# ── Telegram alerts ───────────────────────────────────────────────────

class TelegramChats(BaseModel):
    chat_ids: list[str]


@router.get("/notify/telegram", tags=["notify"])
async def telegram_status() -> dict:
    from app.notify.telegram import TelegramNotifier
    return TelegramNotifier.instance().status()


@router.post("/notify/telegram/find-chats", tags=["notify"])
async def telegram_find_chats() -> dict:
    """Groups and people that have messaged the bot recently, to pick where alerts go."""
    from app.notify.telegram import TelegramError, TelegramNotifier
    try:
        n = TelegramNotifier.instance()
        return {"bot_name": (await n.check())["bot_name"], "chats": await n.find_chats()}
    except TelegramError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.put("/notify/telegram/chats", tags=["notify"])
async def telegram_set_chats(req: TelegramChats) -> dict:
    from app.notify.telegram import TelegramNotifier
    n = TelegramNotifier.instance()
    n.set_chat_ids(req.chat_ids)
    return n.status()


@router.post("/notify/telegram/test", tags=["notify"])
async def telegram_test() -> dict:
    from app.notify.telegram import TelegramError, TelegramNotifier
    try:
        return {"sent_to": await TelegramNotifier.instance().send_test()}
    except TelegramError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


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
