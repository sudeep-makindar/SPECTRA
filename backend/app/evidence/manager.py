"""
Evidence Manager — Maintains rolling video buffers and records incidents.
"""

from __future__ import annotations

import asyncio
import collections
import logging
import time
from pathlib import Path

import cv2
import numpy as np

from app.core.config import load_config, INCIDENTS_DIR
from app.ingest.base import SourcePacket

logger = logging.getLogger("spectra.evidence")

class EvidenceManager:
    _instance = None

    def __init__(self):
        self._config = load_config()
        self._buffers: dict[str, collections.deque] = {}
        self._buffer_duration = self._config.evidence.ring_buffer_s
        self._is_running = False
        
        # A queue of (zone_id, source_id, timestamp) for incidents to record
        self._record_queue: asyncio.Queue = asyncio.Queue()
        self._task: asyncio.Task | None = None

    @classmethod
    def instance(cls) -> "EvidenceManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def start(self) -> None:
        if self._is_running:
            return
        self._is_running = True
        self._task = asyncio.create_task(self._process_records())
        logger.info("Evidence Manager started (Ring buffer: %ds)", self._buffer_duration)

    async def stop(self) -> None:
        self._is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def add_frame(self, packet: SourcePacket) -> None:
        """Add a frame to the rolling buffer for its source."""
        if packet.payload is None or not isinstance(packet.payload, np.ndarray):
            return
            
        source_id = packet.source_id
        if source_id not in self._buffers:
            self._buffers[source_id] = collections.deque()
            
        dq = self._buffers[source_id]
        
        # Store timestamp and the BGR frame
        dq.append((packet.ts_capture, packet.payload))
        
        # Evict old frames
        cutoff = packet.ts_capture - self._buffer_duration
        while len(dq) > 0 and dq[0][0] < cutoff:
            dq.popleft()

    def trigger_incident(self, zone_id: str) -> None:
        """Signal that an incident occurred in a zone."""
        # For prototype, we just grab all currently active sources in the buffer
        # In a real system, we'd map zone_id to specific source_ids
        for source_id in self._buffers.keys():
            self._record_queue.put_nowait((zone_id, source_id, time.time()))

    async def _process_records(self) -> None:
        while self._is_running:
            try:
                zone_id, source_id, trigger_ts = await self._record_queue.get()
                
                # Copy the current buffer safely
                if source_id not in self._buffers:
                    self._record_queue.task_done()
                    continue
                    
                frames = list(self._buffers[source_id])
                
                # Offload encoding to a thread so we don't block the async loop
                await asyncio.to_thread(self._write_video, zone_id, source_id, trigger_ts, frames)
                
                self._record_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error recording incident: %s", e)

    def _write_video(self, zone_id: str, source_id: str, ts: float, frames: list[tuple[float, np.ndarray]]) -> None:
        if not frames:
            return
            
        # Ensure directory exists
        INCIDENTS_DIR.mkdir(parents=True, exist_ok=True)
        
        # Generate filename
        # Format: zoneID_sourceID_YYYYMMDD_HHMMSS.mp4
        import datetime
        dt_str = datetime.datetime.fromtimestamp(ts).strftime("%Y%m%d_%H%M%S")
        filename = f"{zone_id}_{source_id}_{dt_str}.mp4"
        filepath = INCIDENTS_DIR / filename
        
        # Determine fps from timestamps or default to 5
        if len(frames) > 1:
            duration = frames[-1][0] - frames[0][0]
            fps = len(frames) / duration if duration > 0 else 5.0
        else:
            fps = 5.0
            
        # Get frame dimensions
        height, width = frames[0][1].shape[:2]
        
        logger.info("Writing incident video %s (%d frames, %.1f fps)", filename, len(frames), fps)
        
        # Use mp4v codec for standard mp4
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(str(filepath), fourcc, fps, (width, height))
        
        try:
            for _, frame in frames:
                out.write(frame)
        finally:
            out.release()
            
        logger.info("Incident video saved to %s", filepath)
