"""
Data schemas for the Fusion layer.
"""

from __future__ import annotations

import time
from typing import Optional
from dataclasses import dataclass, field


@dataclass
class ModalityState:
    """The current fused state of a single modality within a zone."""
    score: float = 0.0
    last_updated: float = 0.0
    # Additional context (e.g. "density: 0.8", "Scream detected")
    context: str = ""
    
    @property
    def age(self) -> float:
        return time.time() - self.last_updated if self.last_updated > 0 else 999.0


@dataclass
class ZoneState:
    """The complete state of a logical zone (group of cameras/mics)."""
    zone_id: str
    name: str
    
    # 0.0 to 1.0 global risk for this zone
    risk_score: float = 0.0
    
    # State Machine: "normal" | "elevated" | "high" | "critical"
    alert_level: str = "normal"
    
    # The individual modality trackers
    vision: ModalityState = field(default_factory=ModalityState)
    motion: ModalityState = field(default_factory=ModalityState)
    audio: ModalityState = field(default_factory=ModalityState)
    
    last_updated: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            "zone_id": self.zone_id,
            "name": self.name,
            "risk_score": round(self.risk_score, 3),
            "alert_level": self.alert_level,
            "vision": {
                "score": round(self.vision.score, 3),
                "context": self.vision.context,
                "age_s": round(self.vision.age, 1)
            },
            "motion": {
                "score": round(self.motion.score, 3),
                "context": self.motion.context,
                "age_s": round(self.motion.age, 1)
            },
            "audio": {
                "score": round(self.audio.score, 3),
                "context": self.audio.context,
                "age_s": round(self.audio.age, 1)
            },
            "last_updated": self.last_updated
        }


@dataclass
class SystemState:
    """The global system state pushed to the UI via WebSockets."""
    active_sources: int = 0
    total_sources: int = 0
    active_zones: int = 0
    highest_risk: float = 0.0
    zones: dict[str, dict] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            "active_sources": self.active_sources,
            "total_sources": self.total_sources,
            "active_zones": self.active_zones,
            "highest_risk": round(self.highest_risk, 3),
            "zones": self.zones,
            "timestamp": time.time()
        }
