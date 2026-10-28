"""
Source Registry — manages source lifecycle, queues, and health.

Responsibilities:
1. Register/unregister sources with token-based auth for browser nodes
2. Manage per-source bounded queues with latest-frame-wins policy
3. Track source health (fps, drops, last-seen, status)
4. Provide the ingestion gateway for all adapters

Design: "latest-wins" queue — when the queue is full, we drop the oldest
frame and enqueue the new one. This prevents latency from growing unbounded.
A dead camera must never look like a calm zone; staleness is tracked and
surfaced as "degraded" or "blind spot" status.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
import uuid
from typing import Optional

from app.core.config import DATA_DIR

from app.core.metrics import MetricsCollector
from app.ingest.base import BaseSource, SourceKind, SourcePacket

logger = logging.getLogger("spectra.ingest.registry")

# Maximum queue depth per source — small to prevent latency buildup
MAX_QUEUE_DEPTH = 5
# How long before a source is considered stale
STALENESS_TIMEOUT_S = 10.0
# Devices (and their pairing tokens) survive restarts, so a paired phone's
# link keeps working and network cameras don't have to be added again.
DEVICES_FILE = DATA_DIR / "devices.json"


class SourceEntry:
    """A registered source with its adapter, queue, and health state."""

    def __init__(
        self,
        source_id: str,
        name: str,
        kind: SourceKind,
        adapter_type: str,
        token: str,
        zone_id: Optional[str] = None,
        adapter: Optional[BaseSource] = None,
        url: Optional[str] = None,
        config: Optional[dict] = None,
        capabilities: Optional[dict] = None,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
    ):
        from app.ingest.factory import DEFAULT_CAPABILITIES
        self.source_id = source_id
        self.name = name
        self.kind = kind
        self.adapter_type = adapter_type
        self.token = token
        self.zone_id = zone_id
        self.adapter = adapter
        self.url = url
        self.config = config or {}
        self.capabilities = {**DEFAULT_CAPABILITIES.get(adapter_type, {}), **(capabilities or {})}
        self.lat = lat
        self.lng = lng

        # Per-source queue — bounded, latest-wins
        self.queue: asyncio.Queue[SourcePacket] = asyncio.Queue(maxsize=MAX_QUEUE_DEPTH)

        # Health tracking
        self.status: str = "offline"
        self.last_seen: float = 0.0
        self.fps: float = 0.0
        self.dropped_frames: int = 0
        self.total_frames: int = 0
        self._frame_times: list[float] = []

        # Latest preview frames (raw from the adapter, annotated from perception)
        self.latest_jpeg: Optional[bytes] = None
        self.latest_ts: float = 0.0
        self.annotated_jpeg: Optional[bytes] = None
        self.annotated_ts: float = 0.0

        # Task handle for the adapter's run loop
        self._task: Optional[tuple[Optional[asyncio.Task], asyncio.Task]] = None

    async def enqueue(self, packet: SourcePacket) -> None:
        """Enqueue a packet, dropping the oldest if full (latest-wins).

        This is the backpressure mechanism: we never block the ingestion
        pipeline. If inference is slow, we skip stale frames instead of
        buffering up latency.
        """
        self.total_frames += 1
        self.last_seen = time.time()
        self._update_fps()
        if packet.frame_jpeg:
            self.latest_jpeg = packet.frame_jpeg
            self.latest_ts = packet.ts_capture

        if self.queue.full():
            try:
                self.queue.get_nowait()  # Drop oldest
                self.dropped_frames += 1
                MetricsCollector.instance().source(self.source_id).dropped_frames += 1
            except asyncio.QueueEmpty:
                pass

        await self.queue.put(packet)
        MetricsCollector.instance().source(self.source_id).record_frame()
        MetricsCollector.instance().source(self.source_id).queue_depth = self.queue.qsize()

        if self.status != "online":
            self.status = "online"
            logger.info("Source %s (%s) is now online", self.name, self.source_id)

    def _update_fps(self) -> None:
        """Rolling FPS from frame arrival times."""
        now = time.time()
        self._frame_times.append(now)
        # Keep last 60 timestamps
        cutoff = now - 5.0
        self._frame_times = [t for t in self._frame_times if t > cutoff]
        if len(self._frame_times) >= 2:
            window = self._frame_times[-1] - self._frame_times[0]
            if window > 0:
                self.fps = round((len(self._frame_times) - 1) / window, 1)

    def check_staleness(self) -> None:
        """Mark source as degraded/offline if no packets received recently."""
        if self.last_seen == 0:
            return  # Never received a frame

        age = time.time() - self.last_seen
        if age > STALENESS_TIMEOUT_S * 3:
            if self.status != "offline":
                self.status = "offline"
                logger.warning(
                    "Source %s (%s) is offline — no data for %.0f s",
                    self.name, self.source_id, age
                )
        elif age > STALENESS_TIMEOUT_S:
            if self.status != "degraded":
                self.status = "degraded"
                logger.warning(
                    "Source %s (%s) is degraded — last data %.1f s ago",
                    self.name, self.source_id, age
                )

    def to_dict(self) -> dict:
        """JSON-serializable source info for API responses."""
        age = time.time() - self.last_seen if self.last_seen > 0 else None
        return {
            "id": self.source_id,
            "name": self.name,
            "kind": self.kind.value,
            "adapter": self.adapter_type,
            "zone_id": self.zone_id,
            "status": self.status,
            "fps": self.fps,
            "dropped_frames": self.dropped_frames,
            "total_frames": self.total_frames,
            "queue_depth": self.queue.qsize(),
            "last_seen": self.last_seen if self.last_seen > 0 else None,
            "last_seen_age_s": round(age, 1) if age is not None else None,
            "inference_fps": MetricsCollector.instance().source(self.source_id).to_dict()["inference_fps"],
            "skipped_frames": MetricsCollector.instance().source(self.source_id).skipped_frames,
            "has_audio": self.has_audio,
            "capabilities": self.capabilities,
            "lat": self.lat,
            "lng": self.lng,
        }

    def spec(self) -> dict:
        """What is saved to disk to rebuild this device after a restart."""
        return {
            "id": self.source_id, "name": self.name, "kind": self.kind.value, "adapter": self.adapter_type,
            "token": self.token, "zone_id": self.zone_id, "url": self.url, "config": self.config,
            "capabilities": self.capabilities, "lat": self.lat, "lng": self.lng,
        }

    @property
    def has_audio(self) -> bool:
        return self.kind == SourceKind.AUDIO or bool(self.capabilities.get("audio"))


class SourceRegistry:
    """Singleton registry for all active sources."""

    _instance: Optional["SourceRegistry"] = None

    def __init__(self) -> None:
        self._sources: dict[str, SourceEntry] = {}
        self._staleness_task: Optional[asyncio.Task] = None

    @classmethod
    def instance(cls) -> "SourceRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register(
        self,
        name: str,
        kind: SourceKind,
        adapter_type: str,
        zone_id: Optional[str] = None,
        source_id: Optional[str] = None,
        adapter: Optional[BaseSource] = None,
        token: Optional[str] = None,
        url: Optional[str] = None,
        config: Optional[dict] = None,
        capabilities: Optional[dict] = None,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        persist: bool = True,
    ) -> SourceEntry:
        """Register a source. A new device gets a fresh auth token; a restored one keeps its own."""
        sid = source_id or str(uuid.uuid4())[:8]
        entry = SourceEntry(
            source_id=sid,
            name=name,
            kind=kind,
            adapter_type=adapter_type,
            token=token or secrets.token_urlsafe(16),
            zone_id=zone_id,
            adapter=adapter,
            url=url,
            config=config,
            capabilities=capabilities,
            lat=lat,
            lng=lng,
        )
        self._sources[sid] = entry
        logger.info("Registered source: %s (%s, %s, zone=%s)", name, sid, adapter_type, zone_id)
        if persist:
            self.save()
        return entry

    def unregister(self, source_id: str) -> None:
        """Remove a source."""
        if source_id in self._sources:
            entry = self._sources.pop(source_id)
            logger.info("Unregistered source: %s (%s)", entry.name, source_id)
            self.save()

    # ── Persistence ────────────────────────────────────────────────────

    def save(self) -> None:
        specs = [e.spec() for e in self._sources.values() if e.adapter_type != "simulated"]
        try:
            DEVICES_FILE.parent.mkdir(parents=True, exist_ok=True)
            tmp = DEVICES_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(specs, indent=2))
            tmp.replace(DEVICES_FILE)
        except OSError as exc:
            logger.warning("Could not save devices: %s", exc)

    async def restore(self) -> None:
        """Re-register saved devices with their original ids and tokens, and start them."""
        from app.ingest.factory import AdapterError, build_adapter
        if not DEVICES_FILE.exists():
            return
        try:
            specs = json.loads(DEVICES_FILE.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Could not read %s (%s); starting with no devices", DEVICES_FILE, exc)
            return
        for spec in specs:
            try:
                adapter = build_adapter(spec["adapter"], spec["id"], spec["name"], spec.get("url"), spec.get("config"))
            except AdapterError as exc:
                logger.warning("Skipping saved device %s: %s", spec.get("name"), exc)
                continue
            self.register(
                name=spec["name"], kind=SourceKind(spec["kind"]), adapter_type=spec["adapter"],
                zone_id=spec.get("zone_id"), source_id=spec["id"], adapter=adapter, token=spec.get("token"),
                url=spec.get("url"), config=spec.get("config"), capabilities=spec.get("capabilities"),
                lat=spec.get("lat"), lng=spec.get("lng"), persist=False,
            )
            await self.start_source(spec["id"])
        logger.info("Restored %d saved devices", len(self._sources))

    def get(self, source_id: str) -> Optional[SourceEntry]:
        return self._sources.get(source_id)

    def get_by_token(self, token: str) -> Optional[SourceEntry]:
        """Find a source by its auth token (for browser node connections)."""
        for entry in self._sources.values():
            if entry.token == token:
                return entry
        return None

    def all(self) -> list[SourceEntry]:
        return list(self._sources.values())

    def by_zone(self, zone_id: str) -> list[SourceEntry]:
        return [s for s in self._sources.values() if s.zone_id == zone_id]

    def by_kind(self, kind: SourceKind) -> list[SourceEntry]:
        return [s for s in self._sources.values() if s.kind == kind]

    def to_list(self) -> list[dict]:
        """All sources as JSON-serializable dicts."""
        return [s.to_dict() for s in self._sources.values()]

    async def start_staleness_monitor(self) -> None:
        """Background task that checks for stale sources."""
        async def _monitor():
            while True:
                for entry in self._sources.values():
                    entry.check_staleness()
                await asyncio.sleep(2.0)

        self._staleness_task = asyncio.create_task(_monitor())
        logger.info("Staleness monitor started")

    async def start_source(self, source_id: str) -> None:
        """Start a source adapter's run loop."""
        entry = self._sources.get(source_id)
        if not entry:
            logger.warning("Cannot start source %s — not found", source_id)
            return

        async def _run_adapter():
            try:
                await entry.adapter.start(entry.enqueue)
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                logger.error("Source %s adapter crashed: %s", source_id, exc, exc_info=True)
                entry.status = "error"
                
        async def _run_consumer():
            from app.perception.workers import PerceptionManager
            pm = PerceptionManager.instance()
            try:
                while True:
                    packet = await entry.queue.get()
                    await pm.process_packet(packet)
                    entry.queue.task_done()
            except asyncio.CancelledError:
                pass

        # Token devices (phones on the /node page) push packets over /ws/node and have no
        # adapter loop, but their queue still needs a consumer, or their video
        # would fill the queue and never reach the models.
        adapter_task = asyncio.create_task(_run_adapter()) if entry.adapter else None
        entry._task = (adapter_task, asyncio.create_task(_run_consumer()))
        logger.info("Started source adapter & consumer: %s (%s)", entry.name, source_id)

    async def stop_source(self, source_id: str) -> None:
        """Stop a source adapter and its consumer."""
        entry = self._sources.get(source_id)
        if not entry:
            return

        if entry.adapter:
            await entry.adapter.stop()

        if entry._task:
            tasks = [t for t in entry._task if t is not None]
            for t in tasks:
                if not t.done():
                    t.cancel()
            try:
                await asyncio.gather(*tasks, return_exceptions=True)
            except asyncio.CancelledError:
                pass

        entry.status = "offline"
        logger.info("Stopped source adapter: %s (%s)", entry.name, source_id)

    async def stop_all(self) -> None:
        """Stop all source adapters."""
        for sid in list(self._sources.keys()):
            await self.stop_source(sid)
        if self._staleness_task:
            self._staleness_task.cancel()
