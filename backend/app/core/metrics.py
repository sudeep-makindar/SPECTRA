"""
Lightweight per-stage metrics collection.

Tracks latencies at each pipeline stage (capture → ingest → inference → fusion → alert)
so we can report p50/p95 on the System page and in benchmarks.

Also tracks per-source stats: fps, dropped frames, queue depth, reconnects.

Design note: we use a simple in-memory ring buffer approach, not a full
metrics library, because we need sub-second granularity with minimal overhead
and the dashboard reads these via WebSocket, not Prometheus scrape.
"""

from __future__ import annotations

import time
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class LatencySample:
    """A single timing measurement through the pipeline."""
    source_id: str
    stage: str  # "capture", "ingest", "dequeue", "inference", "fusion", "alert"
    ts: float
    duration_ms: float


@dataclass
class SourceStats:
    """Mutable stats for a single source."""
    fps: float = 0.0
    dropped_frames: int = 0
    queue_depth: int = 0
    reconnect_count: int = 0
    last_seen: float = 0.0
    frame_times: deque = field(default_factory=lambda: deque(maxlen=60))

    def record_frame(self) -> None:
        now = time.time()
        self.frame_times.append(now)
        self.last_seen = now
        # Compute rolling FPS from frame arrival times
        if len(self.frame_times) >= 2:
            window = self.frame_times[-1] - self.frame_times[0]
            if window > 0:
                self.fps = round((len(self.frame_times) - 1) / window, 1)

    def to_dict(self) -> dict:
        return {
            "fps": self.fps,
            "dropped_frames": self.dropped_frames,
            "queue_depth": self.queue_depth,
            "reconnect_count": self.reconnect_count,
            "last_seen": self.last_seen,
            "age_s": round(time.time() - self.last_seen, 1) if self.last_seen > 0 else None,
        }


class MetricsCollector:
    """Thread-safe singleton metrics collector.

    Usage:
        metrics = MetricsCollector.instance()
        metrics.record_latency("cam-1", "inference", 12.3)
        metrics.source("cam-1").record_frame()
    """

    _instance: Optional["MetricsCollector"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._latencies: dict[str, deque[LatencySample]] = defaultdict(
            lambda: deque(maxlen=1000)
        )
        self._sources: dict[str, SourceStats] = defaultdict(SourceStats)
        self._lock_data = threading.Lock()
        self._start_time = time.time()

    @classmethod
    def instance(cls) -> "MetricsCollector":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def record_latency(self, source_id: str, stage: str, duration_ms: float) -> None:
        sample = LatencySample(
            source_id=source_id, stage=stage, ts=time.time(), duration_ms=duration_ms
        )
        with self._lock_data:
            self._latencies[stage].append(sample)

    def source(self, source_id: str) -> SourceStats:
        return self._sources[source_id]

    def latency_percentiles(self, stage: str, window_s: float = 60.0) -> dict:
        """Return p50 and p95 latency for a stage over the last window_s seconds."""
        cutoff = time.time() - window_s
        with self._lock_data:
            samples = [s.duration_ms for s in self._latencies[stage] if s.ts > cutoff]

        if not samples:
            return {"p50": None, "p95": None, "count": 0}

        samples.sort()
        n = len(samples)
        return {
            "p50": round(samples[n // 2], 2),
            "p95": round(samples[int(n * 0.95)], 2),
            "count": n,
        }

    def all_latencies(self, window_s: float = 60.0) -> dict:
        stages = ["ingest", "dequeue", "inference", "fusion", "alert"]
        return {stage: self.latency_percentiles(stage, window_s) for stage in stages}

    def all_sources(self) -> dict:
        return {sid: stats.to_dict() for sid, stats in self._sources.items()}

    def snapshot(self) -> dict:
        """Full metrics snapshot for the System page and /api/metrics."""
        return {
            "uptime_s": round(time.time() - self._start_time, 1),
            "latencies": self.all_latencies(),
            "sources": self.all_sources(),
        }
