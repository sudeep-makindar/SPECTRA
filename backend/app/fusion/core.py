"""
Fusion Core — pure, deterministic risk logic (no I/O, no clocks).

Shared by the live FusionEngine and the offline evaluation harness, so the
benchmark numbers describe exactly the code that runs in production.

Gated fusion
------------
Each modality produces evidence s ∈ [0, 1]. A modality is *active* when
s ≥ active_threshold.

* 0–1 active modalities → risk = max(cap_i · s_i)
  A single sensor can never exceed its cap. Audio is capped at ELEVATED, so a
  lone scream or a bass drop cannot raise a CRITICAL alarm.
* ≥2 active modalities → risk = cross_modal_multiplier · (1 − Π(1 − cap_i · s_i))
  Independent sensors agreeing compound into a confident alarm.
* Gunshot/explosion hard trigger → instant HIGH; CRITICAL still needs the
  crowd to react (motion or vision corroboration).

Then: asymmetric smoothing (rise fast, fall slow) → hysteresis state machine.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

LEVELS = ["normal", "elevated", "high", "critical"]
MODALITIES = ("vision", "motion", "audio")


@dataclass
class FusionParams:
    active_threshold: float = 0.45
    active_vision: float = 0.60  # density only corroborates when genuinely crowded (≈2.4 p/m², LoS D+)
    cap_vision: float = 0.72
    cap_motion: float = 0.50
    cap_audio: float = 0.50
    cross_modal_multiplier: float = 1.2
    gunshot_hard_trigger: float = 0.80
    rise_alpha: float = 0.6
    fall_alpha: float = 0.25
    threshold_elevated_up: float = 0.30
    threshold_elevated_down: float = 0.20
    threshold_high_up: float = 0.55
    threshold_high_down: float = 0.40
    threshold_critical_up: float = 0.80
    threshold_critical_down: float = 0.65

    @classmethod
    def from_config(cls, c) -> "FusionParams":
        fields = cls.__dataclass_fields__.keys()
        return cls(**{k: getattr(c, k) for k in fields if hasattr(c, k)})

    def cap(self, modality: str) -> float:
        return getattr(self, f"cap_{modality}")

    def threshold(self, modality: str) -> float:
        if modality == "vision":
            return max(self.active_vision, self.active_threshold)
        return self.active_threshold


@dataclass
class FusionResult:
    raw: float
    risk: float
    level: str
    previous_level: str
    contributions: dict[str, float]
    active: list[str]
    corroborated: bool
    hard_trigger: bool

    @property
    def transitioned(self) -> bool:
        return self.level != self.previous_level


@dataclass
class FusionCore:
    """Per-zone fusion state machine."""
    params: FusionParams = field(default_factory=FusionParams)
    risk: float = 0.0
    level: str = "normal"
    history: deque = field(default_factory=lambda: deque(maxlen=240))  # (t, risk)
    # Consecutive ticks each modality has been above its threshold (debounce)
    streak: dict = field(default_factory=lambda: {m: 0 for m in MODALITIES})
    min_streak: int = 2  # ≈1 s at 2 Hz — single-tick blips never corroborate

    def fuse(self, scores: dict[str, float], hard_trigger: bool = False) -> tuple[float, dict, list, bool]:
        p = self.params
        weighted = {m: p.cap(m) * max(0.0, min(1.0, scores.get(m, 0.0))) for m in MODALITIES}
        for m in MODALITIES:
            self.streak[m] = self.streak[m] + 1 if scores.get(m, 0.0) >= p.threshold(m) else 0
        active = [m for m in MODALITIES if self.streak[m] >= self.min_streak]
        corroborated = len(active) >= 2

        if corroborated:
            prod = 1.0
            for m in MODALITIES:
                prod *= 1.0 - weighted[m]
            raw = p.cross_modal_multiplier * (1.0 - prod)
        else:
            raw = max(weighted.values())

        if hard_trigger:
            # Gunshot → HIGH immediately; CRITICAL only with crowd reaction.
            floor = 0.62
            if scores.get("motion", 0) >= p.threshold("motion") or scores.get("vision", 0) >= p.threshold("vision"):
                floor = 0.9
            raw = max(raw, floor)

        raw = min(raw, 1.0)
        total = sum(weighted.values()) or 1.0
        contributions = {m: round(weighted[m] / total, 3) for m in MODALITIES}
        return raw, contributions, active, corroborated

    def step(self, t: float, scores: dict[str, float], hard_trigger: bool = False) -> FusionResult:
        raw, contributions, active, corroborated = self.fuse(scores, hard_trigger)
        alpha = self.params.rise_alpha if raw > self.risk else self.params.fall_alpha
        self.risk = alpha * raw + (1 - alpha) * self.risk
        prev = self.level
        self.level = self._next_level(self.level, self.risk)
        self.history.append((t, self.risk))
        return FusionResult(
            raw=raw, risk=self.risk, level=self.level, previous_level=prev,
            contributions=contributions, active=active,
            corroborated=corroborated, hard_trigger=hard_trigger,
        )

    def _next_level(self, current: str, score: float) -> str:
        p = self.params
        # Upward transitions can jump tiers; downward transitions step one tier at a time.
        if score >= p.threshold_critical_up:
            return "critical"
        if current == "critical":
            return "high" if score < p.threshold_critical_down else "critical"
        if score >= p.threshold_high_up:
            return "high"
        if current == "high":
            return "elevated" if score < p.threshold_high_down else "high"
        if score >= p.threshold_elevated_up:
            return "elevated"
        if current == "elevated":
            return "normal" if score < p.threshold_elevated_down else "elevated"
        return "normal"

    def forecast(self, window_s: float = 20.0) -> dict:
        """Least-squares trend of risk → estimated seconds until HIGH / CRITICAL."""
        if len(self.history) < 6:
            return {"slope_per_min": 0.0, "eta_high_s": None, "eta_critical_s": None}
        t_end = self.history[-1][0]
        pts = [(t, r) for t, r in self.history if t >= t_end - window_s]
        if len(pts) < 6:
            return {"slope_per_min": 0.0, "eta_high_s": None, "eta_critical_s": None}
        n = len(pts)
        mt = sum(t for t, _ in pts) / n
        mr = sum(r for _, r in pts) / n
        var = sum((t - mt) ** 2 for t, _ in pts)
        slope = sum((t - mt) * (r - mr) for t, r in pts) / var if var > 0 else 0.0

        def eta(target: float):
            if self.risk >= target or slope <= 0.002:
                return None
            s = (target - self.risk) / slope
            return round(s, 0) if s <= 600 else None

        return {
            "slope_per_min": round(slope * 60, 3),
            "eta_high_s": eta(self.params.threshold_high_up),
            "eta_critical_s": eta(self.params.threshold_critical_up),
        }


def level_rank(level: str) -> int:
    return LEVELS.index(level) if level in LEVELS else 0
