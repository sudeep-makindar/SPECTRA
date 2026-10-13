"""
Incident Store — the lifecycle of an alert, from first signal to resolution.

An incident opens when a zone reaches HIGH or CRITICAL and closes when the
zone returns to NORMAL. It carries everything an operator (or an
after-action review) needs: the risk timeline, the signals that fired, the
evidence clips, the AI briefing, and an audit log of operator actions.

Each incident is persisted as one JSON file in data/incidents/, alongside
its clips, so the store survives restarts without schema migrations.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from typing import Optional

from app.core.config import INCIDENTS_DIR

logger = logging.getLogger("spectra.incidents")

STATUSES = ("open", "acknowledged", "escalated", "resolved")


class IncidentStore:
    _instance: Optional["IncidentStore"] = None

    def __init__(self) -> None:
        self._incidents: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._load()

    @classmethod
    def instance(cls) -> "IncidentStore":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _load(self) -> None:
        INCIDENTS_DIR.mkdir(parents=True, exist_ok=True)
        for path in INCIDENTS_DIR.glob("inc-*.json"):
            try:
                inc = json.loads(path.read_text())
                if inc.get("ended_at") is None:
                    # Server restarted mid-incident — close it honestly.
                    inc["ended_at"] = inc.get("updated_at", inc["started_at"])
                    inc["log"].append({"ts": time.time(), "action": "closed", "by": "system",
                                       "note": "Closed on server restart"})
                self._incidents[inc["id"]] = inc
            except Exception as exc:
                logger.warning("Skipping unreadable incident %s: %s", path.name, exc)
        logger.info("Loaded %d incidents", len(self._incidents))

    def save(self, inc: dict) -> None:
        inc["updated_at"] = time.time()
        path = INCIDENTS_DIR / f"{inc['id']}.json"
        with self._lock:
            path.write_text(json.dumps(inc, default=str))

    def open(self, zone_id: str, zone_name: str, level: str, risk: float,
             snapshot: dict, timeline: list, scenario: str | None) -> dict:
        now = time.time()
        inc_id = f"inc-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"
        inc = {
            "id": inc_id,
            "zone_id": zone_id,
            "zone_name": zone_name,
            "started_at": now,
            "ended_at": None,
            "updated_at": now,
            "status": "open",
            "trigger_level": level,
            "peak_level": level,
            "peak_risk": round(risk, 3),
            "trigger_snapshot": snapshot,
            "peak_snapshot": snapshot,
            "timeline": [list(p) for p in timeline],
            "clips": [],
            "brief": None,
            "brief_status": "pending",
            "scenario": scenario,
            "log": [{"ts": now, "action": "opened", "by": "system",
                     "note": f"{zone_name} reached {level.upper()} (risk {risk:.2f})"}],
        }
        self._incidents[inc_id] = inc
        self.save(inc)
        return inc

    def get(self, inc_id: str) -> Optional[dict]:
        return self._incidents.get(inc_id)

    def all(self) -> list[dict]:
        return sorted(self._incidents.values(), key=lambda i: i["started_at"], reverse=True)

    def summaries(self, limit: int = 50) -> list[dict]:
        out = []
        for inc in self.all()[:limit]:
            brief = inc.get("brief") or {}
            out.append({
                "id": inc["id"],
                "zone_id": inc["zone_id"],
                "zone_name": inc["zone_name"],
                "started_at": inc["started_at"],
                "ended_at": inc["ended_at"],
                "status": inc["status"],
                "peak_level": inc["peak_level"],
                "peak_risk": inc["peak_risk"],
                "headline": brief.get("headline"),
                "brief_status": inc.get("brief_status"),
                "clip_count": len(inc.get("clips", [])),
                "thumb": inc["clips"][0]["thumb"] if inc.get("clips") else None,
                "scenario": inc.get("scenario"),
            })
        return out

    def add_log(self, inc_id: str, action: str, by: str = "operator", note: str = "") -> Optional[dict]:
        inc = self._incidents.get(inc_id)
        if not inc:
            return None
        inc["log"].append({"ts": time.time(), "action": action, "by": by, "note": note})
        if action in STATUSES:
            inc["status"] = action
        self.save(inc)
        return inc

    def delete_all(self) -> int:
        n = 0
        for inc_id in list(self._incidents):
            (INCIDENTS_DIR / f"{inc_id}.json").unlink(missing_ok=True)
            for clip in self._incidents[inc_id].get("clips", []):
                for key in ("file", "thumb_file"):
                    if clip.get(key):
                        (INCIDENTS_DIR / clip[key]).unlink(missing_ok=True)
            del self._incidents[inc_id]
            n += 1
        return n
