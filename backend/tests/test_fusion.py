"""
Safety properties of the gated fusion core.

These are the guarantees the pitch rests on, so they are pinned as tests.
"""

from app.fusion.core import FusionCore, FusionParams


def run(scores: dict, ticks: int = 20, hard: bool = False) -> FusionCore:
    core = FusionCore(params=FusionParams())
    for i in range(ticks):
        core.step(i * 0.5, scores, hard_trigger=hard)
    return core


def test_lone_scream_never_exceeds_elevated():
    assert run({"vision": 0.1, "motion": 0.05, "audio": 1.0}).level == "elevated"


def test_motion_spike_alone_never_exceeds_elevated():
    assert run({"vision": 0.1, "motion": 1.0, "audio": 0.05}).level == "elevated"


def test_crush_density_alone_reaches_high_not_critical():
    assert run({"vision": 1.0, "motion": 0.05, "audio": 0.05}).level == "high"


def test_corroborated_scatter_and_scream_is_critical():
    assert run({"vision": 0.5, "motion": 0.9, "audio": 0.85}).level == "critical"


def test_single_tick_blip_does_not_corroborate():
    core = FusionCore(params=FusionParams())
    for i in range(20):
        motion = 0.9 if i % 4 == 0 else 0.1  # isolated one-tick spikes
        core.step(i * 0.5, {"vision": 0.1, "motion": motion, "audio": 0.85})
        assert core.level in ("normal", "elevated")


def test_gunshot_is_high_alone_and_critical_with_crowd_reaction():
    assert run({"audio": 0.9}, hard=True).level == "high"
    assert run({"audio": 0.9, "motion": 0.8}, hard=True).level == "critical"


def test_hysteresis_steps_down_one_tier_at_a_time():
    core = run({"vision": 0.5, "motion": 0.9, "audio": 0.85})
    assert core.level == "critical"
    levels = []
    for i in range(40):
        core.step(100 + i * 0.5, {"vision": 0.0, "motion": 0.0, "audio": 0.0})
        if not levels or levels[-1] != core.level:
            levels.append(core.level)
    assert levels == ["critical", "high", "elevated", "normal"]


def test_forecast_reports_eta_on_rising_risk():
    core = FusionCore(params=FusionParams())
    for i in range(30):
        core.step(i * 0.5, {"vision": 0.02 * i, "motion": 0.0, "audio": 0.0})
    assert core.forecast()["slope_per_min"] > 0
