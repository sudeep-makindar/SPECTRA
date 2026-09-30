"""
Source adapters — concrete implementations of BaseSource.

FileLoopSource: loops a video file for repeatable dev and benchmarks.
SimulatedSource: generates scripted calm→panic scenarios.
LocalWebcamSource: captures from the machine's webcam.
RtspHttpVideoSource: connects to RTSP/MJPEG/HTTP camera streams.
"""

from __future__ import annotations

import asyncio
import logging
import time
import math
from typing import Optional, Callable, Awaitable

import cv2
import numpy as np

from app.ingest.base import BaseSource, SourceKind, SourcePacket
from app.core.config import load_config

logger = logging.getLogger("spectra.ingest.adapters")


def _encode_jpeg(frame: np.ndarray, quality: int = 70) -> bytes:
    """Encode a BGR frame as JPEG bytes."""
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes()


def _resize_for_preview(frame: np.ndarray, max_width: int = 640) -> np.ndarray:
    """Resize frame for dashboard preview tiles."""
    h, w = frame.shape[:2]
    if w <= max_width:
        return frame
    scale = max_width / w
    return cv2.resize(frame, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA)


# ── FileLoopSource ──────────────────────────────────────────────────────

class FileLoopSource(BaseSource):
    """Loops a video file at a target FPS.

    Used for repeatable development, benchmarks, and demos.
    The file is played in an infinite loop until stopped.
    """

    def __init__(self, source_id: str, name: str, file_path: str, target_fps: int = 5):
        super().__init__(source_id, name, SourceKind.VIDEO, {"file_path": file_path})
        self.file_path = file_path
        self.target_fps = target_fps
        self._cap: Optional[cv2.VideoCapture] = None
        self._frame_count = 0

    async def start(self, enqueue: Callable[[SourcePacket], Awaitable[None]]) -> None:
        self.is_running = True
        frame_interval = 1.0 / self.target_fps
        config = load_config()

        logger.info("FileLoopSource %s: opening %s at %d fps", self.name, self.file_path, self.target_fps)

        while self.is_running:
            self._cap = cv2.VideoCapture(self.file_path)
            if not self._cap.isOpened():
                logger.error("FileLoopSource %s: cannot open %s", self.name, self.file_path)
                await asyncio.sleep(2.0)
                continue

            file_fps = self._cap.get(cv2.CAP_PROP_FPS) or 30.0
            # Skip ratio: how many file frames to skip per analysis frame
            skip = max(1, int(file_fps / self.target_fps))

            while self.is_running:
                t0 = time.time()
                ret, frame = self._cap.read()

                if not ret:
                    # End of file — loop
                    logger.debug("FileLoopSource %s: looping", self.name)
                    break

                self._frame_count += 1
                if self._frame_count % skip != 0:
                    continue

                preview = _resize_for_preview(frame, config.video.preview_width)
                jpeg = _encode_jpeg(preview, config.video.preview_quality)

                packet = self._make_packet(
                    payload=frame,
                    ts_capture=time.time(),
                    frame_jpeg=jpeg,
                    metadata={"frame_num": self._frame_count, "source_type": "file_loop"},
                )
                await enqueue(packet)

                # Throttle to target FPS
                elapsed = time.time() - t0
                sleep_time = max(0, frame_interval - elapsed)
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)

            if self._cap:
                self._cap.release()

        logger.info("FileLoopSource %s: stopped", self.name)

    async def stop(self) -> None:
        self.is_running = False
        if self._cap:
            self._cap.release()

    def status(self) -> dict:
        return {
            "file_path": self.file_path,
            "frame_count": self._frame_count,
            "target_fps": self.target_fps,
        }


# ── SimulatedSource ─────────────────────────────────────────────────────

class SimulatedSource(BaseSource):
    """Generates scripted scenarios for development and testing.

    Produces synthetic frames with colored backgrounds and text overlays
    that cycle through calm → building → panic → calm states.

    Clearly labeled "SIM" — can never be mistaken for real detection.
    """

    SCENARIOS = {
        "calm": {"duration_s": 15, "color": (76, 154, 110), "density": 0.1, "motion": 0.05, "label": "CALM"},
        "building": {"duration_s": 8, "color": (157, 141, 247), "density": 0.4, "motion": 0.3, "label": "BUILDING"},
        "panic": {"duration_s": 5, "color": (66, 158, 245), "density": 0.8, "motion": 0.9, "label": "PANIC"},
        "resolving": {"duration_s": 10, "color": (157, 141, 247), "density": 0.3, "motion": 0.2, "label": "RESOLVING"},
    }

    def __init__(self, source_id: str, name: str, target_fps: int = 5, width: int = 640, height: int = 480):
        super().__init__(source_id, name, SourceKind.VIDEO, {"simulated": True})
        self.target_fps = target_fps
        self.width = width
        self.height = height

    async def start(self, enqueue: Callable[[SourcePacket], Awaitable[None]]) -> None:
        self.is_running = True
        frame_interval = 1.0 / self.target_fps
        scenario_order = ["calm", "building", "panic", "resolving"]

        logger.info("SimulatedSource %s: starting (SIM mode)", self.name)

        while self.is_running:
            for phase_name in scenario_order:
                if not self.is_running:
                    break

                phase = self.SCENARIOS[phase_name]
                t_start = time.time()
                frame_num = 0

                while self.is_running and (time.time() - t_start) < phase["duration_s"]:
                    t0 = time.time()
                    progress = (time.time() - t_start) / phase["duration_s"]

                    # Generate synthetic frame
                    frame = self._generate_frame(phase, progress, frame_num)
                    jpeg = _encode_jpeg(frame, 60)

                    packet = self._make_packet(
                        payload=frame,
                        ts_capture=time.time(),
                        frame_jpeg=jpeg,
                        metadata={
                            "source_type": "simulated",
                            "phase": phase_name,
                            "sim_density": phase["density"],
                            "sim_motion": phase["motion"],
                            "progress": round(progress, 2),
                        },
                    )
                    await enqueue(packet)

                    frame_num += 1
                    elapsed = time.time() - t0
                    await asyncio.sleep(max(0, frame_interval - elapsed))

        logger.info("SimulatedSource %s: stopped", self.name)

    def _generate_frame(self, phase: dict, progress: float, frame_num: int) -> np.ndarray:
        """Generate a synthetic frame for a scenario phase."""
        # Background color
        color = phase["color"]
        frame = np.full((self.height, self.width, 3), color, dtype=np.uint8)

        # Add some visual noise proportional to motion level
        noise_level = int(phase["motion"] * 30)
        if noise_level > 0:
            noise = np.random.randint(-noise_level, noise_level, frame.shape, dtype=np.int16)
            frame = np.clip(frame.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        # Draw simulated "people" dots proportional to density
        num_dots = int(phase["density"] * 50)
        for _ in range(num_dots):
            cx = np.random.randint(40, self.width - 40)
            cy = np.random.randint(80, self.height - 40)
            cv2.circle(frame, (cx, cy), 8, (30, 30, 30), -1)
            cv2.circle(frame, (cx, cy - 14), 6, (30, 30, 30), -1)  # Head

        # SIM label — always visible, never ambiguous
        cv2.putText(frame, "SIM", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.putText(frame, phase["label"], (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        cv2.putText(
            frame,
            f"D:{phase['density']:.1f} M:{phase['motion']:.1f}",
            (10, self.height - 15),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1,
        )

        return frame

    async def stop(self) -> None:
        self.is_running = False

    def status(self) -> dict:
        return {"simulated": True, "target_fps": self.target_fps}


# ── LocalWebcamSource ───────────────────────────────────────────────────

class LocalWebcamSource(BaseSource):
    """Captures video from the machine's built-in or USB webcam."""

    def __init__(self, source_id: str, name: str, device_index: int = 0, target_fps: int = 5):
        super().__init__(source_id, name, SourceKind.VIDEO, {"device_index": device_index})
        self.device_index = device_index
        self.target_fps = target_fps
        self._cap: Optional[cv2.VideoCapture] = None

    async def start(self, enqueue: Callable[[SourcePacket], Awaitable[None]]) -> None:
        self.is_running = True
        frame_interval = 1.0 / self.target_fps
        config = load_config()

        logger.info("LocalWebcamSource %s: opening device %d", self.name, self.device_index)
        self._cap = cv2.VideoCapture(self.device_index)

        if not self._cap.isOpened():
            logger.error("LocalWebcamSource %s: cannot open device %d", self.name, self.device_index)
            return

        while self.is_running:
            t0 = time.time()
            ret, frame = self._cap.read()
            if not ret:
                logger.warning("LocalWebcamSource %s: frame grab failed, retrying…", self.name)
                await asyncio.sleep(0.5)
                continue

            preview = _resize_for_preview(frame, config.video.preview_width)
            jpeg = _encode_jpeg(preview, config.video.preview_quality)

            packet = self._make_packet(
                payload=frame,
                ts_capture=time.time(),
                frame_jpeg=jpeg,
                metadata={"source_type": "webcam", "device_index": self.device_index},
            )
            await enqueue(packet)

            elapsed = time.time() - t0
            await asyncio.sleep(max(0, frame_interval - elapsed))

        if self._cap:
            self._cap.release()
        logger.info("LocalWebcamSource %s: stopped", self.name)

    async def stop(self) -> None:
        self.is_running = False
        if self._cap:
            self._cap.release()

    def status(self) -> dict:
        return {"device_index": self.device_index, "target_fps": self.target_fps}


# ── RtspHttpVideoSource ────────────────────────────────────────────────

class RtspHttpVideoSource(BaseSource):
    """Connects to RTSP/MJPEG/HTTP camera streams via OpenCV.

    Auto-reconnects with exponential backoff on failure.
    Works with real CCTV cameras and "IP Webcam" phone app.
    """

    def __init__(self, source_id: str, name: str, url: str, target_fps: int = 5):
        super().__init__(source_id, name, SourceKind.VIDEO, {"url": url})
        self.url = url
        self.target_fps = target_fps
        self._cap: Optional[cv2.VideoCapture] = None
        self._reconnect_count = 0

    async def start(self, enqueue: Callable[[SourcePacket], Awaitable[None]]) -> None:
        self.is_running = True
        frame_interval = 1.0 / self.target_fps
        config = load_config()
        backoff = 1.0

        while self.is_running:
            logger.info("RtspHttpVideoSource %s: connecting to %s", self.name, self.url)
            self._cap = cv2.VideoCapture(self.url)

            if not self._cap.isOpened():
                self._reconnect_count += 1
                logger.warning(
                    "RtspHttpVideoSource %s: connection failed (attempt %d), retrying in %.1f s",
                    self.name, self._reconnect_count, backoff
                )
                MetricsCollector.instance().source(self.source_id).reconnect_count = self._reconnect_count
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
                continue

            backoff = 1.0  # Reset on successful connection
            logger.info("RtspHttpVideoSource %s: connected", self.name)

            while self.is_running:
                t0 = time.time()
                ret, frame = self._cap.read()

                if not ret:
                    self._reconnect_count += 1
                    logger.warning("RtspHttpVideoSource %s: stream interrupted, reconnecting…", self.name)
                    MetricsCollector.instance().source(self.source_id).reconnect_count = self._reconnect_count
                    break

                preview = _resize_for_preview(frame, config.video.preview_width)
                jpeg = _encode_jpeg(preview, config.video.preview_quality)

                packet = self._make_packet(
                    payload=frame,
                    ts_capture=time.time(),
                    frame_jpeg=jpeg,
                    metadata={"source_type": "rtsp_http", "url": self.url},
                )
                await enqueue(packet)

                elapsed = time.time() - t0
                await asyncio.sleep(max(0, frame_interval - elapsed))

            if self._cap:
                self._cap.release()
                self._cap = None

        logger.info("RtspHttpVideoSource %s: stopped", self.name)

    async def stop(self) -> None:
        self.is_running = False
        if self._cap:
            self._cap.release()

    def status(self) -> dict:
        return {
            "url": self.url,
            "target_fps": self.target_fps,
            "reconnect_count": self._reconnect_count,
        }


# Import for metrics
from app.core.metrics import MetricsCollector
