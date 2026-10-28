"""
Vision Model — YOLO person detection + ByteTrack for crowd analytics.

Per camera it reports: headcount, an occupancy heat grid, mean crowd heading,
mean speed, heading chaos (circular variance) and a fallen-person heuristic.

Each camera gets its own YOLO instance: ByteTrack state lives inside the
predictor, so sharing one model across cameras would mix track IDs between
feeds and corrupt the velocity/chaos estimates.
"""

from __future__ import annotations

import io
import logging
import math
import threading
from contextlib import redirect_stdout
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO

from app.models.registry import BaseModel, ModelInfo
from app.core.config import load_config

logger = logging.getLogger("spectra.models.vision")

GRID_ROWS, GRID_COLS = 6, 8

# BGR colours matching the dashboard: white for normal marks, amber and red
# only for things that mean risk (fast movement, a person on the ground).
WHITE = (240, 243, 244)
INK = (14, 13, 13)
GREY = (150, 152, 155)
AMBER = (75, 176, 232)
RED = (67, 75, 239)


class YoloModel(BaseModel):
    """YOLO person detector with per-camera ByteTrack tracking."""

    def __init__(self, model_name: str = "yolo26s.pt"):
        self.model_name = model_name
        self.label = model_name.rsplit(".", 1)[0].upper()  # "yolo26s.pt" → "YOLO26S"
        self._models: dict[str, YOLO] = {}
        self._models_lock = threading.Lock()
        self._device = "cpu"
        self._loaded = False
        self._config = load_config()
        self._prev_positions: dict[str, dict[int, tuple[float, float]]] = {}

    def _new_model(self) -> YOLO:
        with redirect_stdout(io.StringIO()):
            m = YOLO(self.model_name)
            m.to(self._device)
        return m

    def load(self, device: str) -> None:
        if self._loaded:
            return
        logger.info("Loading YOLO model (%s) on %s", self.model_name, device)
        self._device = device
        self._models["__warm__"] = self._new_model()
        # Warm-up pass so the first real frame isn't slow
        self._models["__warm__"].predict(np.zeros((480, 640, 3), np.uint8), classes=[0], verbose=False, device=device)
        self._loaded = True
        logger.info("YOLO model loaded with ByteTrack tracking")

    def _model_for(self, source_id: str) -> YOLO:
        with self._models_lock:
            if source_id not in self._models:
                # Reuse the warmed instance for the first camera
                warm = self._models.pop("__warm__", None)
                self._models[source_id] = warm or self._new_model()
            return self._models[source_id]

    def predict(self, inputs: dict[str, Any]) -> dict:
        if not self._loaded:
            raise RuntimeError("Model not loaded")

        source_id = inputs.get("source_id", "default")
        frame = inputs["frame"]
        H, W = frame.shape[:2]
        fc = self._config.fusion

        results = self._model_for(source_id).track(
            source=frame,
            classes=[0],
            conf=fc.vision_min_conf,
            imgsz=fc.vision_imgsz,
            persist=True,
            tracker="bytetrack.yaml",
            verbose=False,
            device=self._device,
            half=self._device == "cuda",  # FP16 roughly doubles NVIDIA throughput
        )
        boxes = results[0].boxes
        count = len(boxes)

        prev = self._prev_positions.setdefault(source_id, {})
        current: dict[int, tuple[float, float]] = {}
        velocities: list[tuple[float, float]] = []
        dets: list[dict] = []
        fallen_count = 0
        grid = np.zeros((GRID_ROWS, GRID_COLS), np.float32)
        scale = 640.0 / max(W, 1)

        xyxy = boxes.xyxy.cpu().numpy() if count else np.zeros((0, 4))
        ids = boxes.id.int().cpu().tolist() if boxes.id is not None else [None] * count
        confs = boxes.conf.cpu().tolist() if count else []

        for (x1, y1, x2, y2), tid, conf in zip(xyxy, ids, confs):
            w, h = x2 - x1, y2 - y1
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            # Fallen heuristic: lying-down aspect ratio, ignoring boxes cropped
            # by the frame edge (a person close to a webcam is "wide" too).
            touches_edge = y1 < 4 or y2 > H - 4
            fallen = (w > h * 1.3) and not touches_edge and h < 0.6 * H
            fallen_count += int(fallen)
            gx = min(GRID_COLS - 1, int(cx / W * GRID_COLS))
            gy = min(GRID_ROWS - 1, int(y2 / H * GRID_ROWS))  # feet position
            grid[gy, gx] += 0.35
            if tid is not None:
                current[tid] = (cx, cy)
                if tid in prev:
                    px, py = prev[tid]
                    velocities.append((math.hypot(cx - px, cy - py) * scale, math.atan2(cy - py, cx - px)))
            dets.append({"box": [int(x1), int(y1), int(x2), int(y2)], "id": tid,
                         "conf": round(conf, 2), "fallen": fallen})

        self._prev_positions[source_id] = current

        avg_velocity, chaos_index, direction = 0.0, 0.0, None
        if velocities:
            avg_velocity = sum(v for v, _ in velocities) / len(velocities)
            moving = [a for v, a in velocities if v > 2.0]
            if moving:
                cs, sn = sum(math.cos(a) for a in moving), sum(math.sin(a) for a in moving)
                direction = math.degrees(math.atan2(sn, cs)) % 360
                if len(moving) > 3:
                    chaos_index = 1.0 - math.hypot(cs, sn) / len(moving)

        # Light blur so the heatmap reads as density, not cells
        grid = cv2.GaussianBlur(grid, (3, 3), 0.8)
        grid = np.clip(grid * 1.6, 0, 1)

        return {
            "person_count": count,
            "avg_velocity": round(avg_velocity, 2),
            "chaos_index": round(chaos_index, 3),
            "fallen_count": fallen_count,
            "direction_deg": round(direction, 1) if direction is not None else None,
            "grid": [[round(float(v), 3) for v in row] for row in grid],
            "detections": dets,
        }

    def info(self) -> ModelInfo:
        return ModelInfo(
            name=self.model_name.rsplit(".", 1)[0],
            version="bytetrack",
            source="pretrained",
            device=self._device,
            loaded=self._loaded,
        )


def annotate_frame(frame: np.ndarray, vision: dict | None, motion: dict | None,
                   zone_label: str = "", preview_width: int = 640, quality: int = 70,
                   model_label: str = "") -> bytes | None:
    """Render the operator view: labelled person boxes, movement arrows and a status bar."""
    H, W = frame.shape[:2]
    s = preview_width / W if W > preview_width else 1.0
    img = cv2.resize(frame, (int(W * s), int(H * s)), interpolation=cv2.INTER_AREA) if s != 1.0 else frame.copy()
    h, w = img.shape[:2]

    # Optical-flow arrows
    if motion and motion.get("flow_grid"):
        fg = motion["flow_grid"]
        rows, cols = len(fg), len(fg[0])
        for r in range(rows):
            for c in range(cols):
                dx, dy = fg[r][c]
                mag = math.hypot(dx, dy)
                if mag < 0.6:
                    continue
                x0, y0 = int((c + 0.5) * w / cols), int((r + 0.5) * h / rows)
                k = min(18.0, 6.0 * mag) / max(mag, 1e-6)
                cv2.arrowedLine(img, (x0, y0), (int(x0 + dx * k), int(y0 + dy * k)),
                                AMBER if mag > 3 else GREY, 1, cv2.LINE_AA, tipLength=0.4)

    font = cv2.FONT_HERSHEY_SIMPLEX
    if vision:
        for d in vision.get("detections", []):
            x1, y1, x2, y2 = (int(v * s) for v in d["box"])
            color = RED if d["fallen"] else WHITE
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
            tag = ("DOWN  " if d["fallen"] else "") + f"person {d['conf']:.2f}" + (f" #{d['id']}" if d["id"] is not None else "")
            (tw, th), _ = cv2.getTextSize(tag, font, 0.42, 1)
            ty = y1 - 4 if y1 - th - 8 > 0 else y1 + th + 8  # label above the box, or inside if at the top edge
            cv2.rectangle(img, (x1 - 1, ty - th - 4), (x1 + tw + 8, ty + 4), color, -1)
            cv2.putText(img, tag, (x1 + 4, ty), font, 0.42, WHITE if d["fallen"] else INK, 1, cv2.LINE_AA)

    # Status bar
    overlay = img.copy()
    cv2.rectangle(overlay, (0, h - 28), (w, h), INK, -1)
    img = cv2.addWeighted(overlay, 0.7, img, 0.3, 0)
    count = vision["person_count"] if vision else 0
    hud = "  |  ".join(p for p in (model_label, f"{count} {'person' if count == 1 else 'people'}",
                                f"movement x{motion.get('ratio', 0):.1f}" if motion else "", zone_label) if p)
    cv2.putText(img, hud, (10, h - 10), font, 0.45, WHITE, 1, cv2.LINE_AA)

    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes() if ok else None
