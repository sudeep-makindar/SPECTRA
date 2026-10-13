"""
Perception Workers — run models on incoming source packets.

We use `asyncio.to_thread` for inference. Since OpenCV and PyTorch (MPS)
release the GIL during heavy computation, threading gives us parallel execution
without the serialization overhead and memory duplication of multiprocessing
(and without macOS MPS fork locks).

Backpressure: each source has at most one video inference in flight. Frames
that arrive while it is busy are skipped (and counted) instead of queueing
up latency. Audio is buffered into sliding windows (2 s window, 1 s hop).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable, Awaitable

import numpy as np

from app.core.config import load_config
from app.core.device import get_device
from app.core.metrics import MetricsCollector
from app.evidence.manager import EvidenceManager
from app.ingest.base import SourcePacket, SourceKind
from app.models.registry import ModelRegistry
from app.perception.schema import RiskSample

logger = logging.getLogger("spectra.perception.workers")


class PerceptionManager:
    """Manages the inference workers and routes packets to models."""

    _instance = None

    def __init__(self):
        self._is_running = False
        self._tasks: set[asyncio.Task] = set()
        self.on_sample: Callable[[RiskSample], Awaitable[None]] | None = None
        self.device = get_device()
        self._config = load_config()
        self._video_busy: set[str] = set()
        self._audio_busy: set[str] = set()
        self._audio_buf: dict[str, np.ndarray] = {}
        self.model_status: dict[str, str] = {}

    @classmethod
    def instance(cls) -> "PerceptionManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def initialize_models(self) -> None:
        """Load all models. A model that fails to load disables its modality, not the app."""
        registry = ModelRegistry.instance()

        def _load(name: str, factory, device: str) -> None:
            if registry.is_loaded(name):
                return
            try:
                model = factory()
                model.load(device)
                registry.register(name, model)
                self.model_status[name] = "loaded"
            except Exception as exc:
                logger.error("Failed to load %s model: %s", name, exc, exc_info=True)
                self.model_status[name] = f"error: {exc}"

        from app.models.vision import YoloModel
        from app.models.motion import MotionModel
        from app.models.audio import AstAudioModel
        await asyncio.to_thread(_load, "yolo", YoloModel, self.device)
        await asyncio.to_thread(_load, "motion", MotionModel, "cpu")
        await asyncio.to_thread(_load, "audio", AstAudioModel, self.device)

    async def start(self) -> None:
        if self._is_running:
            return
        self._is_running = True  # accept packets immediately; models finish loading in background
        task = asyncio.create_task(self.initialize_models())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        logger.info("PerceptionManager started (models loading in background)")

    async def stop(self) -> None:
        self._is_running = False
        for task in list(self._tasks):
            task.cancel()
        self._tasks.clear()
        logger.info("PerceptionManager stopped")

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def process_packet(self, packet: SourcePacket) -> None:
        """Route a packet to the appropriate models."""
        if not self._is_running:
            return

        if packet.kind == SourceKind.VIDEO:
            EvidenceManager.instance().add_frame(packet)
            if packet.source_id in self._video_busy:
                MetricsCollector.instance().source(packet.source_id).skipped_frames += 1
                return
            self._video_busy.add(packet.source_id)
            self._spawn(self._run_vision_and_motion(packet))

        elif packet.kind == SourceKind.AUDIO:
            self._buffer_audio(packet)

    # ── Video ──────────────────────────────────────────────────────────

    async def _run_vision_and_motion(self, packet: SourcePacket) -> None:
        sid = packet.source_id
        try:
            await self._vision_and_motion(packet)
        except Exception as exc:
            logger.warning("Vision pipeline error on %s: %s", sid, exc, exc_info=True)
        finally:
            self._video_busy.discard(sid)

    async def _vision_and_motion(self, packet: SourcePacket) -> None:
        if packet.payload is None:
            return
        sid = packet.source_id
        registry = ModelRegistry.instance()
        metrics = MetricsCollector.instance()

        if packet.metadata.get("source_type") == "simulated":
            d = packet.metadata.get("sim_density", 0.0)
            v = {"person_count": int(d * 25), "avg_velocity": 0.0, "chaos_index": 0.0,
                 "fallen_count": 0, "direction_deg": None, "grid": None, "detections": []}
            m = {"motion_score": packet.metadata.get("sim_motion", 0.0), "ratio": 0.0,
                 "raw_magnitude": 0.0, "baseline": 0.0, "direction_deg": None, "flow_grid": None}
        else:
            yolo, motion = registry.get("yolo"), registry.get("motion")
            if yolo is None or motion is None:
                return  # models still loading

            async def timed(stage, fn, arg):
                t0 = time.time()
                out = await asyncio.to_thread(fn, arg)
                metrics.record_latency(sid, stage, (time.time() - t0) * 1000)
                return out

            inp = {"source_id": sid, "frame": packet.payload}
            v, m = await asyncio.gather(timed("vision", yolo.predict, inp), timed("motion", motion.predict, inp))
        metrics.source(sid).record_inference()
        if v.get("detections"):
            EvidenceManager.instance().add_detections(sid, packet.ts_capture, packet.payload.shape[1],
                                                      [d["box"] for d in v["detections"]])

        # Annotated operator view for the preview tile
        from app.ingest.registry import SourceRegistry
        from app.models.vision import annotate_frame
        entry = SourceRegistry.instance().get(sid)
        if entry is not None and packet.metadata.get("source_type") != "simulated":
            from app.zones.manager import ZoneManager
            zcfg = ZoneManager.instance().get(entry.zone_id or "") if entry.zone_id else None
            label = (zcfg.name if zcfg else "UNASSIGNED").upper()
            jpeg = await asyncio.to_thread(annotate_frame, packet.payload, v, m, label,
                                           self._config.video.preview_width, self._config.video.preview_quality)
            if jpeg:
                entry.annotated_jpeg = jpeg
                entry.annotated_ts = time.time()

        if not self.on_sample:
            return
        await self.on_sample(RiskSample(
            source_id=sid, modality="vision", score=min(1.0, v["person_count"] / 25), ts_capture=packet.ts_capture,
            metadata={
                "count": v["person_count"], "avg_velocity": v["avg_velocity"], "chaos_index": v["chaos_index"],
                "fallen_count": v["fallen_count"], "direction_deg": v["direction_deg"], "grid": v["grid"],
            },
        ))
        await self.on_sample(RiskSample(
            source_id=sid, modality="motion", score=m["motion_score"], ts_capture=packet.ts_capture,
            metadata={"magnitude": m["raw_magnitude"], "baseline": m["baseline"], "ratio": m["ratio"],
                      "direction_deg": m["direction_deg"], "calibrating": m.get("calibrating", False)},
        ))

    # ── Audio ──────────────────────────────────────────────────────────

    def _buffer_audio(self, packet: SourcePacket) -> None:
        if packet.payload is None:
            return
        sid = packet.source_id
        chunk = np.asarray(packet.payload, dtype=np.float32).ravel()
        sr = int(packet.metadata.get("sample_rate", 16000))
        if sr != 16000 and chunk.size:
            # Linear resample — adequate for classification
            n = int(chunk.size * 16000 / sr)
            chunk = np.interp(np.linspace(0, chunk.size - 1, n), np.arange(chunk.size), chunk).astype(np.float32)

        window = int(self._config.audio.window_s * 16000)
        hop = int(self._config.audio.hop_s * 16000)
        buf = np.concatenate([self._audio_buf.get(sid, np.zeros(0, np.float32)), chunk])[-window * 3:]
        self._audio_buf[sid] = buf
        MetricsCollector.instance().source(sid).record_frame()

        if buf.size >= window and sid not in self._audio_busy:
            segment = buf[-window:].copy()
            self._audio_buf[sid] = buf[-(window - hop):]
            self._audio_busy.add(sid)
            self._spawn(self._run_audio(sid, segment, packet.ts_capture))

    async def _run_audio(self, sid: str, audio: np.ndarray, ts_capture: float) -> None:
        try:
            model = ModelRegistry.instance().get("audio")
            if model is None:
                return
            metrics = MetricsCollector.instance()
            t0 = time.time()
            a = await asyncio.to_thread(model.predict, audio)
            total_ms = (time.time() - t0) * 1000
            if a.get("whisper_ms"):
                metrics.record_latency(sid, "whisper", a["whisper_ms"])
            metrics.record_latency(sid, "audio", total_ms - (a.get("whisper_ms") or 0))
            metrics.source(sid).record_inference()
            if self.on_sample:
                await self.on_sample(RiskSample(
                    source_id=sid, modality="audio", score=a["audio_score"], ts_capture=ts_capture,
                    metadata={k: a.get(k) for k in ("threat_label", "top_class", "top_prob", "hard_trigger",
                                                      "detected_text", "keyword", "language", "rms",
                                                      "gunshot_suppressed", "groups")},
                ))
        except Exception as exc:
            logger.warning("Audio pipeline error on %s: %s", sid, exc, exc_info=True)
        finally:
            self._audio_busy.discard(sid)
