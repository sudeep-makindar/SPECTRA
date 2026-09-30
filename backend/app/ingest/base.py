"""
Base source interface and normalized packet type.

Every source adapter (file loop, webcam, RTSP, browser node, simulated)
implements BaseSource and yields SourcePacket instances.

Design note: sources are typed and independent — each runs in its own
async task or thread, yielding packets into a bounded queue.
"""

from __future__ import annotations

import time
import uuid
import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Any, Callable, Awaitable

import numpy as np

logger = logging.getLogger("spectra.ingest")


class SourceKind(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"


@dataclass
class SourcePacket:
    """Normalized packet from any source adapter.

    Every adapter yields these, regardless of the underlying transport.
    """
    source_id: str
    kind: SourceKind  # "video" | "audio"
    ts_capture: float  # When the frame/chunk was captured (epoch seconds)
    ts_ingest: float = field(default_factory=time.time)  # When the gateway received it
    payload: Optional[Any] = None  # np.ndarray for video (BGR), np.ndarray for audio (float32 mono)
    frame_jpeg: Optional[bytes] = None  # JPEG-encoded preview frame (for dashboard tiles)
    metadata: dict = field(default_factory=dict)  # Adapter-specific metadata


class BaseSource(ABC):
    """Interface for all source adapters.

    Lifecycle: configure() → start() → [yields packets via queue] → stop()
    """

    def __init__(self, source_id: str, name: str, kind: SourceKind, config: dict | None = None):
        self.source_id = source_id
        self.name = name
        self.kind = kind
        self.config = config or {}
        self.is_running = False

    @abstractmethod
    async def start(self, enqueue: Callable[[SourcePacket], Awaitable[None]]) -> None:
        """Start producing packets via the enqueue callback.

        Implementations must:
        1. Set self.is_running = True
        2. Loop, passing SourcePacket instances to `await enqueue(packet)`
        3. Handle reconnection internally (with backoff)
        4. Check self.is_running and exit cleanly when False
        """
        ...

    @abstractmethod
    async def stop(self) -> None:
        """Stop producing packets. Must be idempotent."""
        ...

    @abstractmethod
    def status(self) -> dict:
        """Return adapter-specific status for the UI."""
        ...

    def _make_packet(self, payload: Any, **kwargs) -> SourcePacket:
        """Convenience: create a packet with proper IDs and timestamps."""
        return SourcePacket(
            source_id=self.source_id,
            kind=self.kind,
            ts_capture=kwargs.get("ts_capture", time.time()),
            payload=payload,
            frame_jpeg=kwargs.get("frame_jpeg"),
            metadata=kwargs.get("metadata", {}),
        )
