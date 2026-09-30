"""
Motion Model — Baseline-relative optical flow.
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np

from app.models.registry import BaseModel, ModelInfo

logger = logging.getLogger("spectra.models.motion")


class MotionModel(BaseModel):
    """Computes dense optical flow and compares against a rolling baseline.
    
    A camera looking at a busy street naturally has high motion. We care
    about sudden spikes relative to *that camera's* normal baseline.
    """

    def __init__(self):
        self._loaded = False
        self._device = "cpu"
        
        # State tracked per source_id
        # { source_id: previous_gray_frame }
        self._prev_frames: dict[str, np.ndarray] = {}
        
        # { source_id: rolling_baseline_magnitude }
        self._baselines: dict[str, float] = {}

    def load(self, device: str) -> None:
        self._device = device
        self._loaded = True
        logger.info("Motion model loaded (OpenCV)")

    def predict(self, inputs: dict[str, Any]) -> dict:
        """
        inputs: {
            "source_id": str,
            "frame": np.ndarray (BGR)
        }
        """
        source_id = inputs["source_id"]
        frame = inputs["frame"]
        
        # Downscale for performance (flow doesn't need 1080p)
        small = cv2.resize(frame, (320, 240), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        
        if source_id not in self._prev_frames:
            self._prev_frames[source_id] = gray
            self._baselines[source_id] = 0.0
            return {"motion_score": 0.0, "raw_magnitude": 0.0, "baseline": 0.0}
            
        prev_gray = self._prev_frames[source_id]
        
        # Compute dense optical flow
        flow = cv2.calcOpticalFlowFarneback(
            prev_gray, gray, None,
            pyr_scale=0.5, levels=3, winsize=15,
            iterations=3, poly_n=5, poly_sigma=1.2, flags=0
        )
        
        # Calculate magnitude
        mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        mean_mag = float(np.mean(mag))
        
        # Update rolling baseline (EMA)
        # alpha controls how fast the baseline adapts. 
        # Low alpha = slow adaptation (good for detecting sudden spikes)
        alpha = 0.05 
        current_baseline = self._baselines[source_id]
        new_baseline = (alpha * mean_mag) + ((1 - alpha) * current_baseline)
        
        # If baseline is 0 (startup), just use the mean
        if current_baseline == 0:
            new_baseline = mean_mag
            
        self._baselines[source_id] = new_baseline
        self._prev_frames[source_id] = gray
        
        # Calculate anomaly score (how much higher than baseline?)
        # If baseline is 2.0 and we hit 6.0, ratio is 3.0
        # If baseline is very small, cap it to avoid div by zero spikes
        safe_baseline = max(new_baseline, 0.5)
        ratio = mean_mag / safe_baseline
        
        # Map ratio to a 0-1 risk score
        # Normal fluctuation might be 1.0 - 1.5. 
        # We start triggering risk around 2.0 (double normal motion).
        # Panic/scatter might hit 3.0 - 5.0.
        if ratio <= 1.5:
            score = 0.0
        else:
            # Map 1.5 -> 0.0, 4.0 -> 1.0
            score = min(max((ratio - 1.5) / 2.5, 0.0), 1.0)
            
        return {
            "motion_score": score,
            "raw_magnitude": round(mean_mag, 3),
            "baseline": round(new_baseline, 3)
        }

    def info(self) -> ModelInfo:
        return ModelInfo(
            name="optical_flow",
            version="farneback",
            source="opencv",
            device=self._device,
            loaded=self._loaded
        )
