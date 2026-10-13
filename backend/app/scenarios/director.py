"""
Scenario Director — scripted, clearly-labelled simulations injected into a zone.

Real crowd crushes cannot be staged for a demo. The director layers synthetic
signal timelines on top of whatever the zone's live sensors report (the
fusion engine takes the max of real and simulated evidence), so live cameras
keep contributing while the scenario plays. Every simulated signal is flagged
and the UI shows a SIMULATION badge on the zone.

The same signal shapes are used by the evaluation harness.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from typing import Optional


def _ramp(t: float, t0: float, t1: float, a: float, b: float) -> float:
    if t <= t0:
        return a
    if t >= t1:
        return b
    return a + (b - a) * (t - t0) / (t1 - t0)


def _pulse(t: float, t0: float, t1: float, level: float, base: float = 0.0) -> float:
    return level if t0 <= t <= t1 else base


SCENARIOS: dict[str, dict] = {
    "surge": {
        "title": "Gate Congestion Surge",
        "description": "Density climbs past Fruin LoS F as inbound flow outpaces the gate. Crowd waves and shouting follow.",
        "duration_s": 50,
        "expected": "critical",
    },
    "panic": {
        "title": "Panic Scatter & Distress",
        "description": "Sudden dispersal (motion 4× baseline) with screaming and the Hindi distress call “bachao”.",
        "duration_s": 35,
        "expected": "critical",
    },
    "concert": {
        "title": "Concert Peak (False-Alarm Test)",
        "description": "Loud singing, shouting and dancing in a dense but healthy crowd. Audio-only systems alarm; SPECTRA should not.",
        "duration_s": 40,
        "expected": "elevated",
    },
    "gunshot": {
        "title": "Gunshot + Crowd Reaction",
        "description": "Impulsive gunshot signature followed 1.5 s later by a scatter. Hard trigger → HIGH, corroboration → CRITICAL.",
        "duration_s": 30,
        "expected": "critical",
    },
    "blackout": {
        "title": "Sensor Failure / Blind Spot",
        "description": "All feeds in the zone drop. A dead camera must never look like a calm zone.",
        "duration_s": 25,
        "expected": "blind",
    },
}


def scenario_signals(name: str, t: float, rng: random.Random) -> dict:
    """Synthetic evidence for scenario `name` at t seconds after start."""
    n = lambda s=0.04: rng.gauss(0, s)  # noqa: E731
    clamp = lambda x: max(0.0, min(1.0, x))  # noqa: E731
    out = {"vision": 0.0, "motion": 0.0, "audio": 0.0, "people": None, "audio_label": None,
           "keyword": None, "transcript": "", "hard_trigger": False, "chaos": 0.0,
           "fallen": 0, "blind": False}

    if name == "surge":
        out["vision"] = clamp(_ramp(t, 2, 30, 0.25, 0.97) + n())
        out["people"] = int(_ramp(t, 2, 30, 3, 26))
        out["motion"] = clamp(_ramp(t, 22, 32, 0.08, 0.62) + n(0.06))
        out["chaos"] = _ramp(t, 22, 32, 0.1, 0.7)
        out["audio"] = clamp(_ramp(t, 26, 34, 0.1, 0.55) + n())
        if t > 28:
            out["audio_label"] = "Shout"
            out["transcript"] = "stop pushing! peeche jao!"
            out["keyword"] = "stop"
    elif name == "panic":
        out["vision"] = clamp(0.55 + n())
        out["people"] = 12
        out["motion"] = clamp(_pulse(t, 5, 22, 0.9, 0.12) + n(0.05))
        out["chaos"] = 0.85 if 5 <= t <= 22 else 0.2
        out["audio"] = clamp(_pulse(t, 6, 20, 0.86, 0.08) + n())
        if 6 <= t <= 20:
            out["audio_label"] = "Screaming"
            out["keyword"] = "bachao"
            out["transcript"] = "bachao! bachao! bhago!"
    elif name == "concert":
        beat = 0.5 + 0.5 * math.sin(t * 2 * math.pi / 2.2)
        out["vision"] = clamp(0.40 + n(0.03))
        out["people"] = 9
        out["motion"] = clamp(0.20 + 0.12 * beat + n(0.04))
        out["audio"] = clamp(0.78 + 0.08 * beat + n(0.04))
        out["audio_label"] = "Singing / Shout"
        out["transcript"] = "♪ (crowd singing) ♪"
    elif name == "gunshot":
        out["vision"] = clamp(0.35 + n())
        out["people"] = 8
        shot = 4 <= t <= 6
        out["hard_trigger"] = shot
        out["audio"] = clamp((0.93 if shot else _pulse(t, 6, 18, 0.7, 0.05)) + n(0.03))
        out["audio_label"] = "Gunshot, gunfire" if shot else ("Screaming" if 6 < t <= 18 else None)
        out["motion"] = clamp(_pulse(t, 5.5, 20, 0.92, 0.1) + n(0.05))
        out["chaos"] = 0.9 if 5.5 <= t <= 20 else 0.15
    elif name == "blackout":
        out["blind"] = 3 <= t <= 22
    return out


@dataclass
class ActiveScenario:
    name: str
    zone_id: str
    started_at: float
    rng: random.Random

    @property
    def elapsed(self) -> float:
        return time.time() - self.started_at

    @property
    def done(self) -> bool:
        return self.elapsed > SCENARIOS[self.name]["duration_s"]


class ScenarioDirector:
    _instance: Optional["ScenarioDirector"] = None

    def __init__(self) -> None:
        self._active: dict[str, ActiveScenario] = {}

    @classmethod
    def instance(cls) -> "ScenarioDirector":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def catalog(self) -> list[dict]:
        return [{"id": k, **v} for k, v in SCENARIOS.items()]

    def start(self, name: str, zone_id: str) -> ActiveScenario:
        if name not in SCENARIOS:
            raise KeyError(name)
        sc = ActiveScenario(name=name, zone_id=zone_id, started_at=time.time(),
                            rng=random.Random())
        self._active[zone_id] = sc
        return sc

    def stop(self, zone_id: str) -> None:
        self._active.pop(zone_id, None)

    def stop_all(self) -> None:
        self._active.clear()

    def signals(self, zone_id: str) -> Optional[dict]:
        sc = self._active.get(zone_id)
        if not sc:
            return None
        if sc.done:
            del self._active[zone_id]
            return None
        sig = scenario_signals(sc.name, sc.elapsed, sc.rng)
        sig["scenario"] = sc.name
        sig["elapsed"] = sc.elapsed
        return sig

    def active(self) -> list[dict]:
        return [
            {"zone_id": z, "scenario": s.name, "title": SCENARIOS[s.name]["title"],
             "elapsed": round(s.elapsed, 1), "duration_s": SCENARIOS[s.name]["duration_s"]}
            for z, s in self._active.items() if not s.done
        ]
