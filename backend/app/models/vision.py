"""
Vision Model — YOLO for person detection and counting.
"""

from __future__ import annotations

import logging
from typing import Any

from ultralytics import YOLO
import torch

from app.models.registry import BaseModel, ModelInfo
from app.core.config import load_config

logger = logging.getLogger("spectra.models.vision")


class YoloModel(BaseModel):
    """YOLOv8-based person detector."""

    def __init__(self, model_name: str = "yolov8s.pt"):
        self.model_name = model_name
        self._model = None
        self._device = "cpu"
        self._loaded = False
        self._config = load_config()

    def load(self, device: str) -> None:
        if self._loaded:
            return
            
        logger.info("Loading YOLO model (%s) on %s", self.model_name, device)
        self._device = device
        
        # Suppress Ultralytics verbose output
        import sys
        import io
        from contextlib import redirect_stdout
        with redirect_stdout(io.StringIO()):
            self._model = YOLO(self.model_name)
            self._model.to(device)
            
        self._loaded = True
        logger.info("YOLO model loaded")

    def predict(self, inputs: Any) -> dict:
        """
        Run inference on a BGR frame (numpy array).
        Returns a dictionary with detection results.
        """
        if not self._loaded or self._model is None:
            raise RuntimeError("Model not loaded")

        frame = inputs

        # Ultralytics handles numpy BGR directly
        # classes=[0] filters for 'person' only to speed up NMS
        # verbose=False prevents it from printing to stdout every frame
        results = self._model.predict(
            source=frame, 
            classes=[0], 
            conf=self._config.fusion.weights.get("vision_min_conf", 0.3),
            verbose=False,
            device=self._device
        )
        
        # There's only one frame, so we take results[0]
        result = results[0]
        boxes = result.boxes
        
        count = len(boxes)
        
        # Calculate a naive "density" score (0.0 to 1.0)
        # Assuming 30 people in a frame is "dense" for our prototype
        # Real-world density requires perspective transforms, but this is a start.
        max_people = self._config.fusion.weights.get("vision_max_people", 30)
        density = min(count / max_people, 1.0)
        
        return {
            "person_count": count,
            "density_score": density,
            # We could return bounding boxes here for the UI if needed
        }

    def info(self) -> ModelInfo:
        return ModelInfo(
            name="yolo",
            version="v8s",
            source="pretrained",
            device=self._device,
            loaded=self._loaded
        )
