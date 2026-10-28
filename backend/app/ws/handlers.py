"""
WebSocket endpoints for Spectra.

/ws/live — pushes live state (per-zone risk, per-source status, events, metrics) to the dashboard.
/ws/node — ingestion from browser-based source nodes (getUserMedia).
/ws/preview/<source_id> — streams annotated JPEG frames for camera preview tiles.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.core.metrics import MetricsCollector
from app.fusion.engine import FusionEngine
from app.ingest.base import SourcePacket, SourceKind
from app.ingest.registry import SourceRegistry

logger = logging.getLogger("spectra.ws")
router = APIRouter()

_live_clients: set[WebSocket] = set()


def live_payload() -> dict:
    from app.announce import AnnouncementHub
    from app.incidents.store import IncidentStore
    from app.scenarios.director import ScenarioDirector
    from app.zones.manager import ZoneManager

    registry = SourceRegistry.instance()
    fusion = FusionEngine.instance()
    sources = registry.to_list()
    active = sum(1 for s in sources if s.get("status") == "online")
    payload = fusion.get_system_state(active, len(sources)).to_dict()
    payload["sources"] = sources
    payload["zone_configs"] = [z.to_dict() for z in ZoneManager.instance().all()]
    payload["events"] = fusion.events(60)
    payload["incidents"] = IncidentStore.instance().summaries(20)
    payload["scenarios"] = ScenarioDirector.instance().active()
    hub = AnnouncementHub.instance()
    payload["announcements"] = hub.recent(10)
    payload["speakers"] = hub.speakers()
    payload["metrics"] = MetricsCollector.instance().snapshot()
    return {"type": "state", "ts": time.time(), **payload}


# ── /ws/live — Dashboard live feed ─────────────────────────────────────

@router.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    _live_clients.add(ws)
    logger.info("Dashboard client connected (%d total)", len(_live_clients))
    try:
        while True:
            await ws.send_json(live_payload())
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Dashboard client error: %s", exc)
    finally:
        _live_clients.discard(ws)
        logger.info("Dashboard client disconnected (%d remaining)", len(_live_clients))


# ── /ws/node — Browser source ingestion ────────────────────────────────

@router.websocket("/ws/node")
async def ws_node(ws: WebSocket, token: str = Query(...)):
    """Ingestion WebSocket for browser-based source nodes (phones, laptops).

    Binary protocol: [uint32 BE header length][JSON header][payload]
    - video: JPEG frame
    - audio: PCM16 mono, header carries sample_rate
    """
    from app.perception.workers import PerceptionManager

    registry = SourceRegistry.instance()
    entry = registry.get_by_token(token)
    if not entry:
        await ws.close(code=4001, reason="Invalid token")
        logger.warning("Node connection rejected: invalid token")
        return

    await ws.accept()
    logger.info("Node connected: %s (%s)", entry.name, entry.source_id)
    entry.status = "online"
    entry.last_seen = time.time()
    from app.announce import AnnouncementHub
    AnnouncementHub.instance().attach_node(entry.source_id, ws)
    perception = PerceptionManager.instance()

    try:
        while True:
            data = await ws.receive()
            if data.get("type") == "websocket.disconnect":
                break

            if data.get("bytes"):
                raw = data["bytes"]
                if len(raw) < 4:
                    continue
                header_len = int.from_bytes(raw[:4], "big")
                if len(raw) < 4 + header_len:
                    continue
                try:
                    header = json.loads(raw[4:4 + header_len])
                except json.JSONDecodeError:
                    continue
                payload_bytes = raw[4 + header_len:]
                # Phone clocks drift; stamp with server time for consistent latency metrics.
                ts = time.time()

                if header.get("type") == "video":
                    frame = cv2.imdecode(np.frombuffer(payload_bytes, np.uint8), cv2.IMREAD_COLOR)
                    if frame is None:
                        continue
                    await entry.enqueue(SourcePacket(
                        source_id=entry.source_id, kind=SourceKind.VIDEO, ts_capture=ts,
                        payload=frame, frame_jpeg=payload_bytes,
                        metadata={"source_type": "browser_node"},
                    ))
                elif header.get("type") == "audio":
                    audio = np.frombuffer(payload_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                    # Audio bypasses the latest-wins video queue: dropping audio chunks would leave gaps.
                    entry.last_seen = time.time()
                    await perception.process_packet(SourcePacket(
                        source_id=entry.source_id, kind=SourceKind.AUDIO, ts_capture=ts, payload=audio,
                        metadata={"source_type": "browser_node", "sample_rate": header.get("sample_rate", 16000)},
                    ))

            elif data.get("text"):
                try:
                    msg = json.loads(data["text"])
                    if msg.get("type") == "ping":
                        entry.last_seen = time.time()  # keeps speaker-only devices online
                        zone = FusionEngine.instance().get_zone(FusionEngine.instance().zone_of_source(entry.source_id))
                        await ws.send_json({"type": "pong", "ts": time.time(),
                                            "zone": zone.name if zone else None,
                                            "level": zone.alert_level if zone else None})
                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Node %s error: %s", entry.source_id, exc)
    finally:
        AnnouncementHub.instance().detach_node(entry.source_id, ws)
        entry.status = "offline"
        logger.info("Node disconnected: %s (%s)", entry.name, entry.source_id)


# ── /ws/inspect/<source_id> — Model outputs for the camera focus view ──

@router.websocket("/ws/inspect/{source_id}")
async def ws_inspect(ws: WebSocket, source_id: str):
    """Twice a second: this camera's detections and motion, and the sound
    analysis from its own mic or, failing that, the most recent mic in its zone."""
    from app.perception.workers import PerceptionManager

    await ws.accept()
    pm = PerceptionManager.instance()
    registry = SourceRegistry.instance()
    try:
        while True:
            entry = registry.get(source_id)
            if entry is None:
                await ws.close(code=4004, reason="Unknown source")
                return
            now = time.time()
            audio = pm.audio_insights.get(source_id)
            if audio is None or now - audio["ts"] > 5:
                in_zone = [pm.audio_insights[e.source_id] for e in registry.all()
                           if e.zone_id == entry.zone_id and e.source_id in pm.audio_insights
                           and now - pm.audio_insights[e.source_id]["ts"] <= 5]
                audio = max(in_zone, key=lambda a: a["ts"], default=None)
            await ws.send_json({"ts": now, **pm.insights.get(source_id, {}), "audio": audio})
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("Inspect client error: %s", exc)


# ── /ws/preview/<source_id> — Camera preview stream ───────────────────

@router.websocket("/ws/preview/{source_id}")
async def ws_preview(ws: WebSocket, source_id: str, raw: int = 0):
    """Stream the latest annotated frame (falls back to the raw frame) at ~8 fps.

    Reads the source's latest-frame slot rather than its queue, so previews
    never steal frames from the inference workers.
    """
    entry = SourceRegistry.instance().get(source_id)
    if not entry:
        await ws.close(code=4004, reason="Source not found")
        return
    await ws.accept()
    last = None
    try:
        while True:
            fresh_annotated = entry.annotated_jpeg and time.time() - entry.annotated_ts < 2.0
            frame = entry.latest_jpeg if (raw or not fresh_annotated) else entry.annotated_jpeg
            if frame is not None and frame is not last:
                await ws.send_bytes(frame)
                last = frame
            await asyncio.sleep(0.12)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("Preview stream error for %s: %s", source_id, exc)
