"""
Audio Model — HuggingFace Audio Spectrogram Transformer (AST).
"""

from __future__ import annotations

import logging
from typing import Any

import torch
import numpy as np
from transformers import ASTForAudioClassification, ASTFeatureExtractor

from app.models.registry import BaseModel, ModelInfo
from app.core.config import load_config

logger = logging.getLogger("spectra.models.audio")


class AstAudioModel(BaseModel):
    """Audio classification using AST on AudioSet."""

    def __init__(self, model_name: str = "MIT/ast-finetuned-audioset-10-10-0.4593"):
        self.model_name = model_name
        self._model = None
        self._extractor = None
        self._device = "cpu"
        self._loaded = False
        
        # Load threat groups from config
        # e.g., ["Scream", "Gunshot, gunfire", "Explosion"]
        config = load_config()
        self._threat_labels = set(config.audio.threat_groups.get("high_risk", []))
        
        # Map class IDs to labels
        self._id2label = {}

    def load(self, device: str) -> None:
        if self._loaded:
            return
            
        logger.info("Loading AST Audio model (%s) on %s", self.model_name, device)
        self._device = device
        
        try:
            self._extractor = ASTFeatureExtractor.from_pretrained(self.model_name)
            self._model = ASTForAudioClassification.from_pretrained(self.model_name)
            self._model.to(device)
            self._model.eval()
            
            self._id2label = self._model.config.id2label
            self._loaded = True
            logger.info("AST Audio model loaded successfully")
            
        except Exception as e:
            logger.error("Failed to load AST model: %s", e)
            raise

    def predict(self, inputs: Any) -> dict:
        """
        Run inference on a 1-second audio chunk.
        inputs: float32 numpy array (mono, 16kHz).
        """
        if not self._loaded or self._model is None:
            raise RuntimeError("Model not loaded")

        audio = inputs
        
        # Feature extraction
        features = self._extractor(
            audio, 
            sampling_rate=16000, 
            return_tensors="pt"
        )
        
        input_values = features.input_values.to(self._device)
        
        with torch.no_grad():
            outputs = self._model(input_values)
            logits = outputs.logits
            
        # Get probabilities
        probs = torch.nn.functional.softmax(logits, dim=-1)[0]
        
        # Find the highest probability among threat classes
        max_threat_prob = 0.0
        top_threat_label = None
        
        # Also track the absolute top class (threat or not) for UI evidence
        top_prob_val, top_idx_val = torch.max(probs, dim=-1)
        top_class = self._id2label[top_idx_val.item()]
        top_prob = top_prob_val.item()
        
        for idx, prob_tensor in enumerate(probs):
            prob = prob_tensor.item()
            label = self._id2label[idx]
            
            # Map AudioSet labels to our threat groups
            if label in self._threat_labels:
                if prob > max_threat_prob:
                    max_threat_prob = prob
                    top_threat_label = label
                    
        return {
            "audio_score": max_threat_prob,  # 0.0 to 1.0 based on threat probability
            "threat_label": top_threat_label if max_threat_prob > 0.05 else None,
            "top_class": top_class,
            "top_prob": round(top_prob, 3)
        }

    def info(self) -> ModelInfo:
        return ModelInfo(
            name="ast",
            version="finetuned-audioset",
            source="pretrained",
            device=self._device,
            loaded=self._loaded
        )
