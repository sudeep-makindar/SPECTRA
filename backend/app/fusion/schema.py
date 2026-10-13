"""
Data schemas for the Fusion layer.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field


@dataclass
class ModalityState:
    """The current fused state of a single modality within a zone."""
    score: float = 0.0
    last_updated: float = 0.0
    # Short human-readable context (e.g. "12 pax · LoS D", "Screaming 0.82")
    context: str = ""
    simulated: bool = False

    @property
    def age(self) -> float:
        return time.time() - self.last_updated if self.last_updated > 0 else 999.0

    def to_dict(self) -> dict:
        return {
            "score": round(self.score, 3),
            "context": self.context,
            "age_s": round(min(self.age, 999.0), 1),
            "simulated": self.simulated,
        }


@dataclass
class ZoneState:
    """The complete live state of a logical zone (group of cameras/mics)."""
    zone_id: str
    name: str

    risk_score: float = 0.0
    raw_score: float = 0.0
    alert_level: str = "normal"  # normal | elevated | high | critical

    vision: ModalityState = field(default_factory=ModalityState)
    motion: ModalityState = field(default_factory=ModalityState)
    audio: ModalityState = field(default_factory=ModalityState)

    # Crowd physics
    people_count: int = 0
    density_ppm2: float = 0.0
    los: str = "A"
    los_desc: str = "Free circulation"
    fallen_count: int = 0
    chaos_index: float = 0.0
    avg_velocity: float = 0.0
    flow_direction_deg: float | None = None
    occupancy_grid: list[list[float]] = field(default_factory=list)

    # Audio evidence
    audio_label: str | None = None
    transcript: str = ""
    keyword: str | None = None
    hard_trigger: bool = False

    # Explainability
    contributions: dict[str, float] = field(default_factory=dict)
    active_modalities: list[str] = field(default_factory=list)
    corroborated: bool = False
    reasons: list[str] = field(default_factory=list)
    forecast: dict = field(default_factory=dict)

    # Status
    source_ids: list[str] = field(default_factory=list)
    sources_online: int = 0
    blind_spot: bool = False
    scenario: str | None = None
    open_incident_id: str | None = None
    acknowledged: bool = False
    history: deque = field(default_factory=lambda: deque(maxlen=240))  # 2 min @ 2 Hz

    last_updated: float = 0.0

    def to_dict(self, include_history: bool = True) -> dict:
        d = {
            "zone_id": self.zone_id,
            "name": self.name,
            "risk_score": round(self.risk_score, 3),
            "raw_score": round(self.raw_score, 3),
            "alert_level": self.alert_level,
            "vision": self.vision.to_dict(),
            "motion": self.motion.to_dict(),
            "audio": self.audio.to_dict(),
            "people_count": self.people_count,
            "density_ppm2": round(self.density_ppm2, 2),
            "los": self.los,
            "los_desc": self.los_desc,
            "fallen_count": self.fallen_count,
            "chaos_index": round(self.chaos_index, 3),
            "avg_velocity": round(self.avg_velocity, 2),
            "flow_direction_deg": self.flow_direction_deg,
            "occupancy_grid": self.occupancy_grid,
            "audio_label": self.audio_label,
            "transcript": self.transcript,
            "keyword": self.keyword,
            "hard_trigger": self.hard_trigger,
            "contributions": self.contributions,
            "active_modalities": self.active_modalities,
            "corroborated": self.corroborated,
            "reasons": self.reasons,
            "forecast": self.forecast,
            "source_ids": self.source_ids,
            "sources_online": self.sources_online,
            "blind_spot": self.blind_spot,
            "scenario": self.scenario,
            "open_incident_id": self.open_incident_id,
            "acknowledged": self.acknowledged,
            "last_updated": self.last_updated,
        }
        if include_history:
            d["history"] = list(self.history)
        return d


@dataclass
class SystemState:
    """The global system state pushed to the UI via WebSockets."""
    active_sources: int = 0
    total_sources: int = 0
    active_zones: int = 0
    highest_risk: float = 0.0
    total_people: int = 0
    zones: dict[str, dict] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "active_sources": self.active_sources,
            "total_sources": self.total_sources,
            "active_zones": self.active_zones,
            "highest_risk": round(self.highest_risk, 3),
            "total_people": self.total_people,
            "zones": self.zones,
            "timestamp": time.time(),
        }
