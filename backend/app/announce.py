"""
Announcement hub — public-address messages played on speakers in a zone.

A speaker is any screen that can talk:
  * a dashboard switched to "use this computer as a speaker" — it checks in
    every few seconds, and plays new announcements from the live feed;
  * a phone or laptop on the /node page with the speaker role — it gets each
    announcement pushed over its own WebSocket.
Every speaker reads the text aloud with its own built-in voice, one item per
language, so no audio is generated or sent by the server.
"""

from __future__ import annotations

import asyncio
import collections
import logging
import time
import uuid
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger("spectra.announce")

SPEAKER_TIMEOUT_S = 25.0  # a dashboard that stops checking in is no longer a speaker


class AnnouncementHub:
    _instance: Optional["AnnouncementHub"] = None

    def __init__(self) -> None:
        self._dashboards: dict[str, dict] = {}
        self._node_sockets: dict[str, WebSocket] = {}
        self._recent: collections.deque = collections.deque(maxlen=20)

    @classmethod
    def instance(cls) -> "AnnouncementHub":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Speakers ──────────────────────────────────────────────────────

    def heartbeat(self, speaker_id: str, name: str, zone_id: Optional[str]) -> None:
        self._dashboards[speaker_id] = {"id": speaker_id, "name": name[:60] or "Dashboard",
                                        "zone_id": zone_id or None, "last_seen": time.time()}

    def remove_dashboard(self, speaker_id: str) -> None:
        self._dashboards.pop(speaker_id, None)

    def attach_node(self, source_id: str, ws: WebSocket) -> None:
        self._node_sockets[source_id] = ws

    def detach_node(self, source_id: str, ws: WebSocket) -> None:
        if self._node_sockets.get(source_id) is ws:
            del self._node_sockets[source_id]

    def speakers(self) -> list[dict]:
        """Everything that will play an announcement right now."""
        from app.ingest.registry import SourceRegistry
        now = time.time()
        for sid in [k for k, v in self._dashboards.items() if now - v["last_seen"] > SPEAKER_TIMEOUT_S]:
            del self._dashboards[sid]
        out = [{"id": d["id"], "name": d["name"], "zone_id": d["zone_id"], "kind": "dashboard"}
               for d in self._dashboards.values()]
        registry = SourceRegistry.instance()
        for source_id in self._node_sockets:
            entry = registry.get(source_id)
            if entry and entry.capabilities.get("speaker"):
                out.append({"id": source_id, "name": entry.name, "zone_id": entry.zone_id, "kind": "device"})
        return out

    @staticmethod
    def _plays(speaker_zone: Optional[str], target_zone: Optional[str]) -> bool:
        """A speaker set to every zone plays everything; a zone speaker plays its zone and venue-wide calls."""
        return target_zone is None or speaker_zone is None or speaker_zone == target_zone

    # ── Announcements ─────────────────────────────────────────────────

    def recent(self, n: int = 10) -> list[dict]:
        return list(self._recent)[-n:]

    async def announce(self, zone_id: Optional[str], items: list[dict]) -> dict:
        from app.fusion.engine import FusionEngine
        from app.zones.manager import ZoneManager

        zone = ZoneManager.instance().get(zone_id) if zone_id else None
        ann = {"id": uuid.uuid4().hex[:10], "ts": time.time(), "zone_id": zone.id if zone else None,
               "zone_name": zone.name if zone else "every zone", "items": items}
        self._recent.append(ann)

        targets = [s for s in self.speakers() if self._plays(s["zone_id"], ann["zone_id"])]
        sends = []
        for s in targets:
            ws = self._node_sockets.get(s["id"]) if s["kind"] == "device" else None
            if ws is not None:
                sends.append(ws.send_json({"type": "announce", "id": ann["id"], "items": items}))
        results = await asyncio.gather(*sends, return_exceptions=True)
        failed = sum(1 for r in results if isinstance(r, Exception))

        first = next((i["text"] for i in items if i.get("text")), "")
        log_zone = ann["zone_id"] or ZoneManager.instance().default_zone_id()
        FusionEngine.instance().log_event(log_zone, "announcement", "info",
                                          f"Announcement to {ann['zone_name']}: {first[:90]}")
        logger.info("Announcement %s to %s: %d speakers (%d failed)", ann["id"], ann["zone_name"], len(targets), failed)
        return {"id": ann["id"], "speakers": len(targets) - failed,
                "names": [s["name"] for s in targets]}
