"""
Model Registry — loads and manages inference models.

Every model is loaded through this registry so we can:
1. Share instances across sources (never one model per source)
2. Switch between pretrained and fine-tuned checkpoints via config
3. Track model versions for evidence provenance

Phase 0: interface only. Phase 2 implements actual model loading.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("spectra.models")


@dataclass
class ModelInfo:
    """Metadata about a loaded model."""
    name: str
    version: str
    source: str  # "pretrained" | "finetuned:<path>"
    device: str
    loaded: bool = False


class BaseModel(ABC):
    """Interface for all inference models."""

    @abstractmethod
    def load(self, device: str) -> None:
        """Load model weights onto the specified device."""
        ...

    @abstractmethod
    def predict(self, inputs: Any) -> Any:
        """Run inference on a batch of inputs."""
        ...

    @abstractmethod
    def info(self) -> ModelInfo:
        """Return model metadata."""
        ...


class ModelRegistry:
    """Singleton registry for loaded models.

    Usage:
        registry = ModelRegistry.instance()
        registry.register("yolo", YoloModel())
        model = registry.get("yolo")
    """

    _instance: Optional["ModelRegistry"] = None

    def __init__(self) -> None:
        self._models: dict[str, BaseModel] = {}

    @classmethod
    def instance(cls) -> "ModelRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register(self, name: str, model: BaseModel) -> None:
        self._models[name] = model
        logger.info("Registered model: %s", name)

    def get(self, name: str) -> BaseModel:
        if name not in self._models:
            raise KeyError(f"Model '{name}' not registered. Available: {list(self._models.keys())}")
        return self._models[name]

    def all_info(self) -> dict[str, dict]:
        return {name: model.info().__dict__ for name, model in self._models.items()}

    def is_loaded(self, name: str) -> bool:
        return name in self._models and self._models[name].info().loaded
