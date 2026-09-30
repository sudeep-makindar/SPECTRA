"""
Vision Model — YOLO11 with ByteTrack for advanced crowd analytics.
Tracks crowd density, average velocity, and flow chaos.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from ultralytics import YOLO
import torch

from app.models.registry import BaseModel, ModelInfo
from app.core.config import load_config

logger = logging.getLogger("spectra.models.vision")


class YoloModel(BaseModel):
    """YOLO11-based person detector with object tracking."""

    def __init__(self, model_name: str = "yolo11s.pt"):
        self.model_name = model_name
        self._model = None
        self._device = "cpu"
        self._loaded = False
        self._config = load_config()
        
        # Track previous positions to compute velocity
        # { source_id: { track_id: (x, y) } }
        self._prev_positions: dict[str, dict[int, tuple[float, float]]] = {}

    def load(self, device: str) -> None:
        if self._loaded:
            return
            
        logger.info("Loading YOLO11 model (%s) on %s", self.model_name, device)
        self._device = device
        
        import sys
        import io
        from contextlib import redirect_stdout
        with redirect_stdout(io.StringIO()):
            self._model = YOLO(self.model_name)
            self._model.to(device)
            
        self._loaded = True
        logger.info("YOLO11 model loaded with ByteTrack capabilities")

    def predict(self, inputs: dict[str, Any]) -> dict:
        """
        inputs: {
            "source_id": str,
            "frame": np.ndarray (BGR)
        }
        """
        if not self._loaded or self._model is None:
            raise RuntimeError("Model not loaded")

        source_id = inputs.get("source_id", "default")
        frame = inputs.get("frame")

        # Use ByteTrack for persistent IDs across frames
        results = self._model.track(
            source=frame, 
            classes=[0],  # Person only
            conf=self._config.fusion.weights.get("vision_min_conf", 0.3),
            persist=True,
            tracker="bytetrack.yaml",
            verbose=False,
            device=self._device
        )
        
        result = results[0]
        boxes = result.boxes
        
        count = len(boxes)
        
        # Calculate crowd density
        max_people = self._config.fusion.weights.get("vision_max_people", 30)
        density = min(count / max_people, 1.0)
        
        # Calculate advanced metrics: Velocity & Chaos
        avg_velocity = 0.0
        chaos_index = 0.0
        
        if source_id not in self._prev_positions:
            self._prev_positions[source_id] = {}
            
        current_positions = {}
        velocities = []
        
        if boxes.id is not None:
            track_ids = boxes.id.int().cpu().tolist()
            xywh = boxes.xywh.cpu().tolist()
            
            for t_id, box in zip(track_ids, xywh):
                cx, cy = box[0], box[1]
                current_positions[t_id] = (cx, cy)
                
                # If we saw this person in the previous frame
                if t_id in self._prev_positions[source_id]:
                    px, py = self._prev_positions[source_id][t_id]
                    # Calculate Euclidean distance traveled (pixels)
                    dist = math.hypot(cx - px, cy - py)
                    
                    # Calculate vector angle
                    angle = math.atan2(cy - py, cx - px)
                    velocities.append((dist, angle))
                    
        # Update history
        self._prev_positions[source_id] = current_positions
        
        if velocities:
            # Average speed (pixels per frame)
            avg_velocity = sum(v[0] for v in velocities) / len(velocities)
            
            # Chaos index (variance of movement angles)
            # If everyone moves the same way (evacuation), variance is low.
            # If people move in all directions (crush/panic), variance is high.
            angles = [v[1] for v in velocities if v[0] > 2.0] # ignore standing still
            if len(angles) > 3:
                import numpy as np
                # Circular variance: 1 - |R| / N
                cos_sum = sum(math.cos(a) for a in angles)
                sin_sum = sum(math.sin(a) for a in angles)
                r = math.hypot(cos_sum, sin_sum)
                chaos_index = 1.0 - (r / len(angles))

        return {
            "person_count": count,
            "density_score": density,
            "avg_velocity": round(avg_velocity, 2),
            "chaos_index": round(chaos_index, 3)
        }

    def info(self) -> ModelInfo:
        return ModelInfo(
            name="yolo11",
            version="11s-bytetrack",
            source="pretrained",
            device=self._device,
            loaded=self._loaded
        )
