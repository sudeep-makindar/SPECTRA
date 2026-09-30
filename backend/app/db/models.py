"""
Database models for Spectra.

These map directly to the data model in the spec:
- Source: a video or audio input device
- Zone: a logical area containing multiple sources
- Incident: an alert event with evidence
- RiskSample: time-series data for charts (downsampled)
"""

from __future__ import annotations

import time
from typing import Optional
from enum import Enum

from sqlmodel import SQLModel, Field


class SourceKind(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"


class SourceStatus(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    CALIBRATING = "calibrating"
    DEGRADED = "degraded"
    ERROR = "error"


class IncidentStatus(str, Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    ESCALATED = "escalated"
    RESOLVED = "resolved"


class RiskState(str, Enum):
    NORMAL = "normal"
    ELEVATED = "elevated"
    HIGH = "high"
    CRITICAL = "critical"


class Source(SQLModel, table=True):
    id: Optional[str] = Field(default=None, primary_key=True)
    name: str
    kind: str  # "video" | "audio"
    adapter: str  # "rtsp", "file_loop", "webcam", "browser_node", "simulated", "local_mic"
    url: Optional[str] = None
    config_json: Optional[str] = None  # JSON blob for adapter-specific config
    token: Optional[str] = None  # Auth token for browser nodes
    zone_id: Optional[str] = None
    status: str = "offline"
    last_seen: Optional[float] = None
    created_at: float = Field(default_factory=time.time)


class Zone(SQLModel, table=True):
    id: Optional[str] = Field(default=None, primary_key=True)
    name: str
    capacity: Optional[int] = None  # Expected max occupancy
    thresholds_json: Optional[str] = None  # Per-zone fusion overrides (JSON)
    created_at: float = Field(default_factory=time.time)


class Incident(SQLModel, table=True):
    id: Optional[str] = Field(default=None, primary_key=True)
    zone_id: str
    started_at: float
    ended_at: Optional[float] = None
    peak_state: str = "high"  # RiskState
    peak_risk: float = 0.0
    status: str = "open"  # IncidentStatus
    clip_path: Optional[str] = None
    audio_path: Optional[str] = None
    evidence_path: Optional[str] = None
    narrative: Optional[str] = None
    notes: Optional[str] = None
    created_at: float = Field(default_factory=time.time)


class RiskSample(SQLModel, table=True):
    """Downsampled risk time-series for zone charts."""
    id: Optional[int] = Field(default=None, primary_key=True)
    zone_id: str
    ts: float
    risk: float
    state: str  # RiskState
    contributions_json: Optional[str] = None  # JSON: {"density": 0.3, "motion": 0.5, "audio": 0.2}
