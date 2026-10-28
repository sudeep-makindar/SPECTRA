"""
Zone Manager — the spatial model of the venue.

A zone is a physical area (gate, stage front, corridor) with a known floor
area. Cameras and microphones are assigned to zones; fusion runs per zone.
SPECTRA starts with one zone, "Venue"; more are added on the Map page, each
placed as a circle on the street map.

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
from dataclasses import dataclass, asdict, field, fields
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
    # Placement on the street map; None until placed
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_m: float = 25.0
    sop: list[str] = field(default_factory=list)  # standard operating procedures

    def to_dict(self) -> dict:
        return asdict(self)


DEFAULT_SOP = [
    "Send the nearest stewards to the crowd",
    "Slow or hold people coming in",
    "Open extra exits and make a calm PA announcement",
]

DEFAULT_ZONES = [
    ZoneConfig(
        id="venue", name="Venue", area_m2=6.0, capacity=20, kind="general",
        sop=list(DEFAULT_SOP),
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
                raw = json.loads(ZONES_FILE.read_text(encoding="utf-8"))
                known = {f.name for f in fields(ZoneConfig)}
                for z in raw:
                    cfg = ZoneConfig(**{k: v for k, v in z.items() if k in known})  # older files had x/y/w/h
                    self._zones[cfg.id] = cfg
                if not self._zones:
                    raise ValueError("no zones in file")
                logger.info("Loaded %d zones from %s", len(self._zones), ZONES_FILE)
                return
            except Exception as exc:
                logger.warning("Could not read zones file (%s) — using defaults", exc)
        for z in DEFAULT_ZONES:
            self._zones[z.id] = ZoneConfig(**asdict(z))
        self._save()

    def _save(self) -> None:
        ZONES_FILE.parent.mkdir(parents=True, exist_ok=True)
        ZONES_FILE.write_text(json.dumps([z.to_dict() for z in self._zones.values()], indent=2, ensure_ascii=False),
                              encoding="utf-8")

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
        kwargs.setdefault("area_m2", 6.0)
        kwargs.setdefault("capacity", 20)
        kwargs.setdefault("sop", list(DEFAULT_SOP))
        cfg = ZoneConfig(id=zid, name=name, **kwargs)
        self._zones[zid] = cfg
        self._save()
        return cfg

    def delete(self, zone_id: str) -> bool:
        """Remove a zone. The last zone can't be removed."""
        if zone_id in self._zones and len(self._zones) > 1:
            del self._zones[zone_id]
            self._save()
            return True
        return False

    def update(self, zone_id: str, **changes) -> Optional[ZoneConfig]:
        cfg = self._zones.get(zone_id)
        if not cfg:
            return None
        for k, v in changes.items():
            if v is not None and hasattr(cfg, k) and k != "id":
                setattr(cfg, k, v)
        self._save()
        return cfg

