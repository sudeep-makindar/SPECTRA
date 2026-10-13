"""
Lightweight per-stage metrics collection.

Tracks latencies at each pipeline stage (vision/motion/audio inference,
fusion tick, capture→fusion end-to-end) so we can report p50/p95/p99 on the
System page and in benchmarks. Also tracks per-source stats: capture fps,
inference fps, dropped frames, skipped frames, queue depth, reconnects.

Design note: we use a simple in-memory ring buffer approach, not a full
metrics library, because we need sub-second granularity with minimal overhead
and the dashboard reads these via WebSocket, not Prometheus scrape.
"""

from __future__ import annotations

import os
import time
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Optional

try:
    import psutil
except ImportError:  # pragma: no cover
    psutil = None

STAGES = ["vision", "motion", "audio", "whisper", "fusion", "e2e"]


@dataclass
class LatencySample:
    """A single timing measurement through the pipeline."""
    source_id: str
    stage: str
    ts: float
    duration_ms: float


@dataclass
class SourceStats:
    """Mutable stats for a single source."""
    fps: float = 0.0
    inference_fps: float = 0.0
    dropped_frames: int = 0
    skipped_frames: int = 0
    queue_depth: int = 0
    reconnect_count: int = 0
    last_seen: float = 0.0
    frame_times: deque = field(default_factory=lambda: deque(maxlen=60))
    infer_times: deque = field(default_factory=lambda: deque(maxlen=60))

    @staticmethod
    def _rate(times: deque) -> float:
        if len(times) >= 2:
            window = times[-1] - times[0]
            if window > 0:
                return round((len(times) - 1) / window, 1)
        return 0.0

    def record_frame(self) -> None:
        now = time.time()
        self.frame_times.append(now)
        self.last_seen = now
        self.fps = self._rate(self.frame_times)

    def record_inference(self) -> None:
        self.infer_times.append(time.time())
        self.inference_fps = self._rate(self.infer_times)

    def to_dict(self) -> dict:
        stale = self.infer_times and time.time() - self.infer_times[-1] > 3
        return {
            "fps": self.fps,
            "inference_fps": 0.0 if stale else self.inference_fps,
            "dropped_frames": self.dropped_frames,
            "skipped_frames": self.skipped_frames,
            "queue_depth": self.queue_depth,
            "reconnect_count": self.reconnect_count,
            "last_seen": self.last_seen,
            "age_s": round(time.time() - self.last_seen, 1) if self.last_seen > 0 else None,
        }


class MetricsCollector:
    """Thread-safe singleton metrics collector.

    Usage:
        metrics = MetricsCollector.instance()
        metrics.record_latency("cam-1", "vision", 12.3)
        metrics.source("cam-1").record_frame()
    """

    _instance: Optional["MetricsCollector"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._latencies: dict[str, deque[LatencySample]] = defaultdict(lambda: deque(maxlen=2000))
        self._sources: dict[str, SourceStats] = defaultdict(SourceStats)
        self._lock_data = threading.Lock()
        self._start_time = time.time()
        self._trend: deque = deque(maxlen=150)  # (ts, {stage: p95}) sampled every ~2 s
        self._last_trend = 0.0
        self._proc = psutil.Process(os.getpid()) if psutil else None
        if psutil:
            psutil.cpu_percent(None)

    @classmethod
    def instance(cls) -> "MetricsCollector":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def record_latency(self, source_id: str, stage: str, duration_ms: float) -> None:
        sample = LatencySample(source_id=source_id, stage=stage, ts=time.time(), duration_ms=duration_ms)
        with self._lock_data:
            self._latencies[stage].append(sample)

    def source(self, source_id: str) -> SourceStats:
        return self._sources[source_id]

    def latency_percentiles(self, stage: str, window_s: float = 60.0) -> dict:
        cutoff = time.time() - window_s
        with self._lock_data:
            samples = [s.duration_ms for s in self._latencies[stage] if s.ts > cutoff]
        if not samples:
            return {"p50": None, "p95": None, "p99": None, "mean": None, "count": 0}
        samples.sort()
        n = len(samples)
        pick = lambda q: round(samples[min(n - 1, int(n * q))], 2)  # noqa: E731
        return {"p50": pick(0.50), "p95": pick(0.95), "p99": pick(0.99),
                "mean": round(sum(samples) / n, 2), "count": n}

    def all_latencies(self, window_s: float = 60.0) -> dict:
        return {stage: self.latency_percentiles(stage, window_s) for stage in STAGES}

    def all_sources(self) -> dict:
        return {sid: stats.to_dict() for sid, stats in self._sources.items()}

    def system(self) -> dict:
        if not psutil:
            return {}
        vm = psutil.virtual_memory()
        return {
            "cpu_percent": psutil.cpu_percent(None),
            "cpu_count": psutil.cpu_count(),
            "ram_percent": vm.percent,
            "ram_used_gb": round(vm.used / 1e9, 2),
            "ram_total_gb": round(vm.total / 1e9, 2),
            "process_rss_gb": round(self._proc.memory_info().rss / 1e9, 2) if self._proc else None,
            "threads": self._proc.num_threads() if self._proc else None,
        }

    def snapshot(self) -> dict:
        """Full metrics snapshot for the System page and /api/metrics."""
        lat = self.all_latencies(window_s=30.0)
        now = time.time()
        if now - self._last_trend >= 2.0:
            self._last_trend = now
            self._trend.append({"ts": round(now, 1), **{s: lat[s]["p95"] for s in STAGES}})
        return {
            "uptime_s": round(now - self._start_time, 1),
            "latencies": lat,
            "sources": self.all_sources(),
            "system": self.system(),
            "trend": list(self._trend),
        }
