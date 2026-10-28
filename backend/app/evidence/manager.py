"""
Evidence Manager — rolling video buffers and incident clips.

Every video source keeps a ring buffer of recent frames. When an incident
opens, we wait `post_event_s`, then cut a clip spanning `pre_event_s` before
to `post_event_s` after the trigger for every camera in the incident's zone.

Clips are H.264 (avc1) so they play in any browser, get a thumbnail, and —
when `evidence.face_blur` is on — have faces blurred before they touch disk
(privacy by design; aligns with India's DPDP Act data-minimisation principle).
Anonymisation reuses the YOLO person boxes: the head region (top ~22% of each
box) of every tracked person is blurred, so no separate face model is needed
and people facing away are covered too.
"""

from __future__ import annotations

import asyncio
import collections
import datetime
import logging
import time

import cv2
import numpy as np

from app.core.config import load_config, INCIDENTS_DIR
from app.ingest.base import SourcePacket

logger = logging.getLogger("spectra.evidence")

MAX_STORE_WIDTH = 960


class EvidenceManager:
    _instance = None

    def __init__(self):
        self._config = load_config()
        self._buffers: dict[str, collections.deque] = {}
        self._buffer_duration = self._config.evidence.ring_buffer_s
        self._is_running = False
        self._record_queue: asyncio.Queue = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._blur = bool(self._config.evidence.face_blur)
        # Recent person boxes per source: (ts, frame_width, [[x1,y1,x2,y2], ...])
        self._detections: dict[str, collections.deque] = {}

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
        logger.info("Evidence Manager started (ring buffer %.0fs, face blur %s)",
                    self._buffer_duration, "on" if self._blur else "off")

    async def stop(self) -> None:
        self._is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def add_frame(self, packet: SourcePacket) -> None:
        if packet.payload is None or not isinstance(packet.payload, np.ndarray) or packet.payload.ndim != 3:
            return
        frame = packet.payload
        if frame.shape[1] > MAX_STORE_WIDTH:
            s = MAX_STORE_WIDTH / frame.shape[1]
            frame = cv2.resize(frame, (MAX_STORE_WIDTH, int(frame.shape[0] * s)), interpolation=cv2.INTER_AREA)
        dq = self._buffers.setdefault(packet.source_id, collections.deque())
        dq.append((packet.ts_capture, frame))
        cutoff = packet.ts_capture - self._buffer_duration
        while dq and dq[0][0] < cutoff:
            dq.popleft()

    def add_detections(self, source_id: str, ts: float, frame_width: int, boxes: list) -> None:
        dq = self._detections.setdefault(source_id, collections.deque(maxlen=200))
        dq.append((ts, frame_width, boxes))
        while dq and dq[0][0] < ts - self._buffer_duration - 2:
            dq.popleft()

    def _boxes_at(self, source_id: str, ts: float) -> tuple[int, list] | None:
        best = None
        for t, w, boxes in self._detections.get(source_id, ()):
            if abs(t - ts) <= 1.0 and (best is None or abs(t - ts) < abs(best[0] - ts)):
                best = (t, w, boxes)
        return (best[1], best[2]) if best else None

    def trigger_incident(self, zone_id: str, incident_id: str) -> None:
        from app.fusion.engine import FusionEngine
        zone = FusionEngine.instance().get_zone(zone_id)
        source_ids = [s for s in (zone.source_ids if zone else []) if s in self._buffers]
        if not source_ids:
            logger.info("Incident %s: no camera buffers in zone %s — no clip", incident_id, zone_id)
            return
        self._record_queue.put_nowait((incident_id, zone_id, source_ids, time.time()))

    async def _process_records(self) -> None:
        cfg = self._config.evidence
        while self._is_running:
            try:
                incident_id, zone_id, source_ids, trigger_ts = await self._record_queue.get()
                wait = trigger_ts + cfg.post_event_s - time.time()
                if wait > 0:
                    await asyncio.sleep(wait)
                for sid in source_ids:
                    frames = [(t, f) for t, f in list(self._buffers.get(sid, []))
                              if trigger_ts - cfg.pre_event_s <= t <= trigger_ts + cfg.post_event_s]
                    clip = await asyncio.to_thread(self._write_clip, zone_id, sid, trigger_ts, frames)
                    if clip:
                        self._attach(incident_id, clip)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error recording incident: %s", e, exc_info=True)

    def _attach(self, incident_id: str, clip: dict) -> None:
        from app.incidents.store import IncidentStore
        store = IncidentStore.instance()
        inc = store.get(incident_id)
        if inc is not None:
            inc["clips"].append(clip)
            store.save(inc)

    def _blur_faces(self, frame: np.ndarray, source_id: str, ts: float) -> np.ndarray:
        if not self._blur:
            return frame
        found = self._boxes_at(source_id, ts)
        if not found:
            return frame
        orig_w, boxes = found
        s = frame.shape[1] / max(orig_w, 1)
        H, W = frame.shape[:2]
        for x1, y1, x2, y2 in boxes:
            x1, y1, x2, y2 = int(x1 * s), int(y1 * s), int(x2 * s), int(y2 * s)
            bw, bh = x2 - x1, y2 - y1
            hx1, hx2 = max(0, x1 + int(bw * 0.15)), min(W, x2 - int(bw * 0.15))
            hy1, hy2 = max(0, y1), min(H, y1 + max(int(bh * 0.22), int(bw * 0.5)))
            if hx2 - hx1 > 2 and hy2 - hy1 > 2:
                roi = frame[hy1:hy2, hx1:hx2]
                small = cv2.resize(roi, (max(1, roi.shape[1] // 10), max(1, roi.shape[0] // 10)))
                frame[hy1:hy2, hx1:hx2] = cv2.resize(small, (roi.shape[1], roi.shape[0]), interpolation=cv2.INTER_NEAREST)
        return frame

    def _write_clip(self, zone_id: str, source_id: str, ts: float, frames: list) -> dict | None:
        if len(frames) < 2:
            return None
        INCIDENTS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.fromtimestamp(ts).strftime("%Y%m%d_%H%M%S")
        base = f"{zone_id}_{source_id}_{stamp}"
        path, thumb = INCIDENTS_DIR / f"{base}.mp4", INCIDENTS_DIR / f"{base}.jpg"

        duration = frames[-1][0] - frames[0][0]
        fps = max(1.0, min(30.0, (len(frames) - 1) / duration)) if duration > 0 else 5.0
        h, w = frames[0][1].shape[:2]
        w, h = w - w % 2, h - h % 2  # H.264 needs even dimensions
        writer = _ClipWriter(path, w, h, fps)

        trigger_frame = None
        try:
            for t, frame in frames:
                if frame.shape[0] < h or frame.shape[1] < w:
                    continue
                f = self._blur_faces(frame[:h, :w].copy(), source_id, t)
                if trigger_frame is None and t >= ts:
                    trigger_frame = f
                writer.write(f)
        finally:
            writer.close()
        cv2.imwrite(str(thumb), trigger_frame if trigger_frame is not None else self._blur_faces(frames[-1][1].copy(), source_id, frames[-1][0]),
                    [cv2.IMWRITE_JPEG_QUALITY, 80])

        logger.info("Incident clip saved: %s (%d frames, %.1f fps)", path.name, len(frames), fps)
        return {
            "source_id": source_id,
            "file": path.name,
            "thumb_file": thumb.name,
            "url": f"/api/incidents/media/{path.name}",
            "thumb": f"/api/incidents/media/{thumb.name}",
            "frames": len(frames),
            "duration_s": round(duration, 1),
            "trigger_offset_s": round(ts - frames[0][0], 1),
            "face_blur": self._blur,
        }


class _ClipWriter:
    """Writes browser-playable H.264 MP4.

    Uses the ffmpeg binary bundled with imageio-ffmpeg (Windows, macOS and
    Linux alike); OpenCV's own H.264 support depends on the platform and is
    usually missing on Windows, where clips would silently fall back to a
    codec browsers can't play. OpenCV remains the fallback.
    """

    def __init__(self, path, w: int, h: int, fps: float):
        self._proc = None
        self._cv = None
        try:
            import subprocess
            import imageio_ffmpeg
            self._proc = subprocess.Popen(
                [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
                 "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{fps:.2f}", "-i", "-",
                 "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                 str(path)],
                stdin=subprocess.PIPE,
            )
        except Exception as exc:
            logger.warning("ffmpeg unavailable (%s); writing the clip with OpenCV", exc)
            self._cv = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"avc1"), fps, (w, h))
            if not self._cv.isOpened():
                self._cv = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    def write(self, frame) -> None:
        if self._proc and self._proc.stdin:
            self._proc.stdin.write(frame.tobytes())
        elif self._cv:
            self._cv.write(frame)

    def close(self) -> None:
        if self._proc and self._proc.stdin:
            self._proc.stdin.close()
            self._proc.wait(timeout=30)
        if self._cv:
            self._cv.release()
