"""
Motion Model — Baseline-relative optical flow.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any

import cv2
import numpy as np

from app.models.registry import BaseModel, ModelInfo

logger = logging.getLogger("spectra.models.motion")

FLOW_ROWS, FLOW_COLS = 6, 8
CALIBRATION_S = 8.0       # learn each camera's "normal" before scoring
BASELINE_ALPHA = 0.02     # slow adaptation in normal conditions
SPIKE_ALPHA = 0.003       # near-frozen baseline during a spike, so a stampede can't become "normal"
MIN_MAGNITUDE = 0.6       # px/frame below which motion is sensor noise


class MotionModel(BaseModel):
    """Computes dense optical flow and compares against a rolling baseline.

    A camera looking at a busy street naturally has high motion. We care
    about sudden spikes relative to *that camera's* normal baseline.
    """

    def __init__(self):
        self._loaded = False
        self._device = "cpu"
        self._prev_frames: dict[str, np.ndarray] = {}
        self._baselines: dict[str, float] = {}
        self._started: dict[str, float] = {}

    def load(self, device: str) -> None:
        self._device = device
        self._loaded = True
        logger.info("Motion model loaded (OpenCV Farneback)")

    def reset(self, source_id: str) -> None:
        for d in (self._prev_frames, self._baselines, self._started):
            d.pop(source_id, None)

    def predict(self, inputs: dict[str, Any]) -> dict:
        source_id = inputs["source_id"]
        frame = inputs["frame"]

        small = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        if source_id not in self._prev_frames or self._prev_frames[source_id].shape != gray.shape:
            self._prev_frames[source_id] = gray
            self._baselines[source_id] = 0.0
            self._started[source_id] = time.time()
            return {"motion_score": 0.0, "raw_magnitude": 0.0, "baseline": 0.0, "ratio": 0.0,
                    "calibrating": True, "flow_grid": None, "direction_deg": None}

        flow = cv2.calcOpticalFlowFarneback(
            self._prev_frames[source_id], gray, None,
            pyr_scale=0.5, levels=3, winsize=15, iterations=3, poly_n=5, poly_sigma=1.2, flags=0,
        )
        self._prev_frames[source_id] = gray

        mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        mean_mag = float(np.mean(mag))

        # Coarse flow field for visualisation + dominant direction
        fh, fw = flow.shape[:2]
        cells = flow[: fh - fh % FLOW_ROWS, : fw - fw % FLOW_COLS].reshape(
            FLOW_ROWS, fh // FLOW_ROWS, FLOW_COLS, fw // FLOW_COLS, 2).mean(axis=(1, 3))
        flow_grid = [[[round(float(c[0]), 2), round(float(c[1]), 2)] for c in row] for row in cells]
        moving = mag > 1.0
        direction = None
        if moving.mean() > 0.02:
            direction = math.degrees(math.atan2(float(flow[..., 1][moving].mean()),
                                                float(flow[..., 0][moving].mean()))) % 360

        baseline = self._baselines[source_id]
        calibrating = time.time() - self._started[source_id] < CALIBRATION_S
        if baseline == 0:
            baseline = mean_mag
        ratio = mean_mag / max(baseline, 0.5)
        alpha = BASELINE_ALPHA if (calibrating or ratio < 2.0) else SPIKE_ALPHA
        if calibrating:
            alpha = 0.15
        self._baselines[source_id] = alpha * mean_mag + (1 - alpha) * baseline

        # 1.5× baseline → 0, 4× baseline → 1
        score = 0.0
        if not calibrating and mean_mag > MIN_MAGNITUDE and ratio > 1.5:
            score = min(max((ratio - 1.5) / 2.5, 0.0), 1.0)

        return {
            "motion_score": score,
            "raw_magnitude": round(mean_mag, 3),
            "baseline": round(self._baselines[source_id], 3),
            "ratio": round(ratio, 2),
            "calibrating": calibrating,
            "flow_grid": flow_grid,
            "direction_deg": round(direction, 1) if direction is not None else None,
        }

    def info(self) -> ModelInfo:
        return ModelInfo(name="optical_flow", version="farneback", source="opencv",
                         device=self._device, loaded=self._loaded)
