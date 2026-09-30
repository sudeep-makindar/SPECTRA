"""
WebSocket endpoints for Spectra.

/ws/live — pushes live state (per-zone risk, per-source status, alerts) to the dashboard.
/ws/node — ingestion from browser-based source nodes (getUserMedia).
/ws/preview/<source_id> — streams JPEG frames for camera preview tiles.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.ingest.registry import SourceRegistry
from app.ingest.base import SourcePacket, SourceKind
from app.core.metrics import MetricsCollector

logger = logging.getLogger("spectra.ws")
router = APIRouter()

# Track connected dashboard clients
_live_clients: set[WebSocket] = set()


# ── /ws/live — Dashboard live feed ─────────────────────────────────────

@router.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    """Push live state to the dashboard at ~2-5 Hz.

    Sends JSON messages with:
    - sources: per-source status (fps, drops, last_seen, status)
    - zones: per-zone risk score and state (Phase 3+)
    - alerts: new alert events (Phase 4+)
    """
    await ws.accept()
    _live_clients.add(ws)
    logger.info("Dashboard client connected (%d total)", len(_live_clients))

    try:
        while True:
            registry = SourceRegistry.instance()

            state = {
                "type": "state",
                "ts": time.time(),
                "sources": registry.to_list(),
                "metrics": MetricsCollector.instance().snapshot(),
                # zones and alerts will be added in Phases 3-4
            }

            await ws.send_json(state)
            await asyncio.sleep(0.5)  # ~2 Hz base rate

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Dashboard client error: %s", exc)
    finally:
        _live_clients.discard(ws)
        logger.info("Dashboard client disconnected (%d remaining)", len(_live_clients))


async def broadcast_alert(alert_data: dict) -> None:
    """Broadcast a new alert to all connected dashboard clients."""
    message = {"type": "alert", "ts": time.time(), **alert_data}
    dead = set()
    for ws in _live_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.add(ws)
    _live_clients -= dead


# ── /ws/node — Browser source ingestion ────────────────────────────────

@router.websocket("/ws/node")
async def ws_node(ws: WebSocket, token: str = Query(...)):
    """Ingestion WebSocket for browser-based source nodes.

    A phone or laptop opens /node, picks camera/mic, and sends:
    - Video: JPEG frames at ~5fps with a JSON header
    - Audio: 16kHz PCM16 chunks with a JSON header

    Authentication: per-source token created in the UI.
    """
    # Authenticate
    registry = SourceRegistry.instance()
    entry = registry.get_by_token(token)

    if not entry:
        await ws.close(code=4001, reason="Invalid token")
        logger.warning("Node connection rejected: invalid token")
        return

    await ws.accept()
    logger.info("Node connected: %s (%s)", entry.name, entry.source_id)
    entry.status = "online"

    try:
        while True:
            # Receive binary (frame/audio) or text (metadata) messages
            data = await ws.receive()

            if "bytes" in data:
                raw = data["bytes"]
                # Binary protocol: first 4 bytes = header length (uint32 BE)
                # Next header_len bytes = JSON header
                # Remaining = payload (JPEG for video, PCM16 for audio)
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

                if header.get("type") == "video":
                    # Payload is a JPEG frame
                    import numpy as np
                    import cv2
                    nparr = np.frombuffer(payload_bytes, np.uint8)
                    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if frame is None:
                        continue

                    packet = SourcePacket(
                        source_id=entry.source_id,
                        kind=SourceKind.VIDEO,
                        ts_capture=header.get("ts", time.time()),
                        payload=frame,
                        frame_jpeg=payload_bytes,  # Already JPEG
                        metadata={"source_type": "browser_node"},
                    )
                    await entry.enqueue(packet)

                elif header.get("type") == "audio":
                    # Payload is PCM16 audio chunk
                    import numpy as np
                    audio = np.frombuffer(payload_bytes, dtype=np.int16).astype(np.float32) / 32768.0

                    packet = SourcePacket(
                        source_id=entry.source_id,
                        kind=SourceKind.AUDIO,
                        ts_capture=header.get("ts", time.time()),
                        payload=audio,
                        metadata={
                            "source_type": "browser_node",
                            "sample_rate": header.get("sample_rate", 16000),
                        },
                    )
                    await entry.enqueue(packet)

            elif "text" in data:
                # Text messages for control (ping, status)
                try:
                    msg = json.loads(data["text"])
                    if msg.get("type") == "ping":
                        await ws.send_json({"type": "pong", "ts": time.time()})
                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Node %s error: %s", entry.source_id, exc)
    finally:
        entry.status = "offline"
        logger.info("Node disconnected: %s (%s)", entry.name, entry.source_id)


# ── /ws/preview/<source_id> — Camera preview stream ───────────────────

@router.websocket("/ws/preview/{source_id}")
async def ws_preview(ws: WebSocket, source_id: str):
    """Stream JPEG frames for a camera's preview tile in the dashboard.

    Sends binary JPEG frames at ~5 fps. If the source has no new frame,
    it waits briefly rather than resending stale data.
    """
    registry = SourceRegistry.instance()
    entry = registry.get(source_id)

    if not entry:
        await ws.close(code=4004, reason="Source not found")
        return

    await ws.accept()
    logger.debug("Preview client connected for source %s", source_id)

    last_sent_ts = 0.0

    try:
        while True:
            # Try to get the latest frame from the queue without blocking
            try:
                packet = entry.queue.get_nowait()
                if packet.frame_jpeg and packet.ts_capture > last_sent_ts:
                    await ws.send_bytes(packet.frame_jpeg)
                    last_sent_ts = packet.ts_capture
                # Put it back for inference workers
                if not entry.queue.full():
                    await entry.queue.put(packet)
            except asyncio.QueueEmpty:
                pass

            await asyncio.sleep(0.2)  # ~5 Hz max

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("Preview stream error for %s: %s", source_id, exc)
