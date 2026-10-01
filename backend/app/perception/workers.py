"""
Perception Workers — run models on incoming source packets.

We use `asyncio.to_thread` for inference. Since OpenCV and PyTorch (MPS)
release the GIL during heavy computation, threading gives us parallel execution
without the serialization overhead and memory duplication of multiprocessing.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable, Awaitable

from app.ingest.base import SourcePacket, SourceKind
from app.perception.schema import RiskSample
from app.models.registry import ModelRegistry
from app.core.metrics import MetricsCollector
from app.core.device import get_device
from app.evidence.manager import EvidenceManager

logger = logging.getLogger("spectra.perception.workers")


class PerceptionManager:
    """Manages the inference workers and routes packets to models."""

    _instance = None

    def __init__(self):
        self._is_running = False
        self._tasks: list[asyncio.Task] = []
        # In Phase 3, this callback will push to the Fusion Engine
        self.on_sample: Callable[[RiskSample], Awaitable[None]] | None = None
        
        self.device = get_device()

    @classmethod
    def instance(cls) -> "PerceptionManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def initialize_models(self) -> None:
        """Load all models into the registry."""
        registry = ModelRegistry.instance()
        
        # Load YOLO
        if not registry.is_loaded("yolo"):
            from app.models.vision import YoloModel
            yolo = YoloModel()
            yolo.load(self.device)
            registry.register("yolo", yolo)
            
        # Load Optical Flow
        if not registry.is_loaded("motion"):
            from app.models.motion import MotionModel
            motion = MotionModel()
            motion.load("cpu")  # OpenCV runs on CPU
            registry.register("motion", motion)
            
        # Load AST Audio
        if not registry.is_loaded("audio"):
            from app.models.audio import AstAudioModel
            audio = AstAudioModel()
            audio.load(self.device)
            registry.register("audio", audio)

    async def start(self) -> None:
        if self._is_running:
            return
            
        await self.initialize_models()
        self._is_running = True
        logger.info("PerceptionManager started")
        
    async def stop(self) -> None:
        self._is_running = False
        for task in self._tasks:
            task.cancel()
        self._tasks.clear()
        logger.info("PerceptionManager stopped")

    async def process_packet(self, packet: SourcePacket) -> None:
        """Route a packet to the appropriate models."""
        if not self._is_running:
            return

        # Always add packet to Evidence buffer for Phase 4 recording
        evidence = EvidenceManager.instance()
        evidence.add_frame(packet)

        if packet.kind == SourceKind.VIDEO:
            # Dispatch to vision and motion workers concurrently
            task = asyncio.create_task(self._run_vision_and_motion(packet))
            self._tasks.append(task)
            
        elif packet.kind == SourceKind.AUDIO:
            task = asyncio.create_task(self._run_audio(packet))
            self._tasks.append(task)
            
        # Clean up finished tasks
        self._tasks = [t for t in self._tasks if not t.done()]

    async def _run_vision_and_motion(self, packet: SourcePacket) -> None:
        """Run YOLO and Optical Flow in parallel threads."""
        if packet.payload is None:
            return

        registry = ModelRegistry.instance()
        yolo = registry.get("yolo")
        motion = registry.get("motion")
        metrics = MetricsCollector.instance()
        
        t0 = time.time()
        
        # Run inference in thread pool to avoid blocking the event loop
        # For simulated sources, we just use their metadata instead of running expensive models
        if packet.metadata.get("source_type") == "simulated":
            v_result = {
                "density_score": packet.metadata.get("sim_density", 0.0),
                "person_count": int(packet.metadata.get("sim_density", 0.0) * 50)
            }
            m_result = {
                "motion_score": packet.metadata.get("sim_motion", 0.0),
                "raw_magnitude": packet.metadata.get("sim_motion", 0.0) * 10,
                "baseline": 1.0
            }
        else:
            v_result, m_result = await asyncio.gather(
                asyncio.to_thread(yolo.predict, {"source_id": packet.source_id, "frame": packet.payload}),
                asyncio.to_thread(motion.predict, {"source_id": packet.source_id, "frame": packet.payload})
            )
            
        latency = time.time() - t0
        metrics.record_latency("vision", latency)

        # Emit Vision sample
        v_sample = RiskSample(
            source_id=packet.source_id,
            modality="vision",
            score=v_result["density_score"],
            ts_capture=packet.ts_capture,
            metadata={
                "count": v_result["person_count"],
                "avg_velocity": v_result.get("avg_velocity", 0.0),
                "chaos_index": v_result.get("chaos_index", 0.0)
            }
        )
        logger.debug("Vision: source=%s score=%.2f latency=%.2fs", packet.source_id, v_sample.score, latency)
        if self.on_sample:
            await self.on_sample(v_sample)
            
        # Emit Motion sample
        m_sample = RiskSample(
            source_id=packet.source_id,
            modality="motion",
            score=m_result["motion_score"],
            ts_capture=packet.ts_capture,
            metadata={
                "magnitude": m_result["raw_magnitude"],
                "baseline": m_result["baseline"]
            }
        )
        logger.debug("Motion: source=%s score=%.2f latency=%.2fs", packet.source_id, m_sample.score, latency)
        if self.on_sample:
            await self.on_sample(m_sample)

    async def _run_audio(self, packet: SourcePacket) -> None:
        """Run AST Audio classification."""
        if packet.payload is None:
            return
            
        registry = ModelRegistry.instance()
        audio_model = registry.get("audio")
        metrics = MetricsCollector.instance()
        
        t0 = time.time()
        
        if packet.metadata.get("source_type") == "simulated":
            a_result = {
                "audio_score": packet.metadata.get("sim_density", 0.0), # Just use density as proxy
                "threat_label": "SIMULATED THREAT" if packet.metadata.get("sim_density", 0.0) > 0.6 else None,
                "top_class": "Simulated",
                "top_prob": 1.0
            }
        else:
            a_result = await asyncio.to_thread(audio_model.predict, packet.payload)
            
        latency = time.time() - t0
        metrics.record_latency("audio", latency)

        a_sample = RiskSample(
            source_id=packet.source_id,
            modality="audio",
            score=a_result["audio_score"],
            ts_capture=packet.ts_capture,
            metadata={
                "threat_label": a_result["threat_label"],
                "top_class": a_result["top_class"],
                "top_prob": a_result["top_prob"],
                "detected_text": a_result.get("detected_text", "")
            }
        )
        logger.debug("Audio: source=%s threat=%s prob=%.2f text='%s'", packet.source_id, a_sample.metadata["top_class"], a_sample.metadata["top_prob"], a_sample.metadata["detected_text"])
        
        if self.on_sample:
            await self.on_sample(a_sample)
