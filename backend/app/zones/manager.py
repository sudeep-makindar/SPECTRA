"""
Zone Manager — the spatial model of the venue.

A zone is a physical area (gate, stage front, corridor) with a known floor
area. Cameras and microphones are assigned to zones; fusion runs per zone.

Floor area turns a headcount into a physical density (people / m²), which
maps onto Fruin's Level of Service — the standard used by crowd-safety
engineers. Above ~5 people/m² crowds lose the ability to move individually
and crush risk becomes severe.

Zones persist to data/zones.json so the demo layout survives restarts.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, asdict, field
from typing import Optional

from app.core.config import DATA_DIR

logger = logging.getLogger("spectra.zones")

ZONES_FILE = DATA_DIR / "zones.json"

# Fruin Level of Service for queuing/standing areas (people per m²).
# Each tier: (upper bound, label, description)
FRUIN_LOS = [
    (0.83, "A", "Free circulation"),
    (1.08, "B", "Restricted circulation"),
    (1.54, "C", "Personal space restricted"),
    (3.57, "D", "Contact with others"),
    (5.00, "E", "Unavoidable contact"),
    (float("inf"), "F", "Crush danger"),
]


def fruin_level(density_ppm2: float) -> tuple[str, str]:
    for bound, label, desc in FRUIN_LOS:
        if density_ppm2 < bound:
            return label, desc
    return "F", "Crush danger"


@dataclass
class ZoneConfig:
    id: str
    name: str
    area_m2: float = 50.0          # floor area covered by this zone's cameras
    capacity: int = 100            # safe occupancy
    kind: str = "general"          # gate | stage | corridor | exit | general
    # Position on the venue map, in a 0–100 coordinate space
    x: float = 0.0
    y: float = 0.0
    w: float = 30.0
    h: float = 30.0
    sop: list[str] = field(default_factory=list)  # standard operating procedures

    def to_dict(self) -> dict:
        return asdict(self)


DEFAULT_ZONES = [
    ZoneConfig(
        id="gate", name="Main Gate", area_m2=4.0, capacity=10, kind="gate",
        x=4, y=58, w=30, h=36,
        sop=[
            "Hold inbound entry at the outer cordon",
            "Open overflow lanes / Gate B",
            "Deploy stewards to break up the queue",
        ],
    ),
    ZoneConfig(
        id="stage", name="Stage Front", area_m2=6.0, capacity=20, kind="stage",
        x=36, y=6, w=60, h=40,
        sop=[
            "Ask performers to pause and make a PA announcement",
            "Open pit barrier relief gates",
            "Move first-aid team to the barrier",
        ],
    ),
    ZoneConfig(
        id="exit", name="Exit Corridor", area_m2=4.0, capacity=10, kind="corridor",
        x=40, y=58, w=56, h=36,
        sop=[
            "Stop counter-flow — make corridor one-way",
            "Open emergency exits E2 and E3",
            "Station stewards at the corridor mouth",
        ],
    ),
]


class ZoneManager:
    _instance: Optional["ZoneManager"] = None

    def __init__(self) -> None:
        self._zones: dict[str, ZoneConfig] = {}
        self._load()

    @classmethod
    def instance(cls) -> "ZoneManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _load(self) -> None:
        if ZONES_FILE.exists():
            try:
                raw = json.loads(ZONES_FILE.read_text())
                for z in raw:
                    cfg = ZoneConfig(**z)
                    self._zones[cfg.id] = cfg
                logger.info("Loaded %d zones from %s", len(self._zones), ZONES_FILE)
                return
            except Exception as exc:
                logger.warning("Could not read zones file (%s) — using defaults", exc)
        for z in DEFAULT_ZONES:
            self._zones[z.id] = ZoneConfig(**asdict(z))
        self._save()

    def _save(self) -> None:
        ZONES_FILE.parent.mkdir(parents=True, exist_ok=True)
        ZONES_FILE.write_text(json.dumps([z.to_dict() for z in self._zones.values()], indent=2))

    def all(self) -> list[ZoneConfig]:
        return list(self._zones.values())

    def get(self, zone_id: str) -> Optional[ZoneConfig]:
        return self._zones.get(zone_id)

    def default_zone_id(self) -> str:
        return next(iter(self._zones), "default")

    def create(self, name: str, **kwargs) -> ZoneConfig:
        base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "zone"
        zid, n = base, 2
        while zid in self._zones:
            zid, n = f"{base}-{n}", n + 1
        cfg = ZoneConfig(id=zid, name=name, **kwargs)
        self._zones[zid] = cfg
        self._save()
        return cfg

    def update(self, zone_id: str, **changes) -> Optional[ZoneConfig]:
        cfg = self._zones.get(zone_id)
        if not cfg:
            return None
        for k, v in changes.items():
            if v is not None and hasattr(cfg, k) and k != "id":
                setattr(cfg, k, v)
        self._save()
        return cfg

    def delete(self, zone_id: str) -> bool:
        if zone_id in self._zones and len(self._zones) > 1:
            del self._zones[zone_id]
            self._save()
            return True
        return False
