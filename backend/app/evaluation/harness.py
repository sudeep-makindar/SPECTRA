"""
Evaluation harness — does cross-modal fusion actually reduce false alarms?

Method
------
We generate randomized signal-level traces for 9 scenario classes (4 true
emergencies, 5 benign look-alikes) — modality evidence over 60 s at 2 Hz with
random onset, amplitude and noise — and replay each trace through the *same*
`FusionCore` code that runs in production, under five detector designs:

* audio-only, vision-only, motion-only — single-sensor products
* any-sensor OR — all sensors, no gating (alarm if any sensor is high)
* SPECTRA — gated cross-modal fusion

A detector "alarms" when it reaches HIGH or above. We report detection rate
on emergencies, false-alarm rate on benign scenarios, detection latency from
event onset (negative = early warning), and a confusion matrix of peak tier
per scenario for SPECTRA.

Honesty note: these are *synthetic sensor-evidence* traces, not labelled
real-world footage. They test the fusion logic; perception accuracy on real
video/audio is benchmarked separately (`--perception`).
"""

from __future__ import annotations

import json
import math
import random
import statistics
import time
from dataclasses import replace

from app.core.config import DATA_DIR, load_config
from app.fusion.core import FusionCore, FusionParams, LEVELS, level_rank

EVAL_DIR = DATA_DIR / "eval"
REPORT_PATH = EVAL_DIR / "report.json"
DT = 0.5
DURATION = 60.0

SCENARIOS = {
    # name: (is_emergency, description)
    "crowd_surge": (True, "Density ramps to crush level, then turbulence and shouting"),
    "static_crush": (True, "Compressed crowd: extreme density, almost no motion"),
    "panic_scatter": (True, "Sudden dispersal with screaming"),
    "gunshot_reaction": (True, "Gunshot signature, crowd scatters 1–2.5 s later"),
    "normal_flow": (False, "Steady pedestrian flow, ambient chatter"),
    "concert_peak": (False, "Loud singing/shouting, rhythmic motion, dense but healthy"),
    "lone_scream": (False, "A single scream/shout with no crowd reaction"),
    "camera_shake": (False, "Camera vibration or lighting change: motion spike only"),
    "dense_queue": (False, "Slow, dense but orderly queue (LoS D)"),
}


def _trace(name: str, rng: random.Random, noise: float = 1.0, dropout: float = 0.0) -> tuple[list[dict], float, bool]:
    """Returns per-tick evidence, event onset time, and whether it is an emergency."""
    amp = rng.uniform(0.85, 1.08)
    onset = rng.uniform(10, 22)
    clamp = lambda x: max(0.0, min(1.0, x))  # noqa: E731
    n = lambda s=0.05: rng.gauss(0, s * noise)  # noqa: E731
    ticks = []
    dur_a, dur_b = rng.uniform(2, 4), rng.uniform(10, 15)
    ramp = rng.uniform(18, 32)
    react = rng.uniform(1.0, 2.5)
    base_v = rng.uniform(0.15, 0.3)
    peak_v = rng.uniform(0.55, 0.7)
    event_onset = onset

    t = 0.0
    while t < DURATION:
        u = t - onset
        v, m, a, hard = base_v + n(), 0.08 + n(0.03), 0.06 + n(0.03), False
        if rng.random() < 0.04:  # passing chatter / footsteps
            a += rng.uniform(0.1, 0.3)

        if name == "crowd_surge":
            v = 0.3 + 0.67 * min(1, max(0, u) / ramp) * amp + n()
            if u > 0.6 * ramp:
                m = 0.6 * amp + n(0.08)
                a = 0.5 * amp + n(0.08)
            event_onset = onset + ramp * (0.9 - 0.3) / 0.67  # density crosses 0.9 (~3.6 p/m²)
        elif name == "static_crush":
            v = 0.5 + 0.48 * min(1, max(0, u) / 10) * amp + n(0.03)
            a = 0.25 + n(0.05) if u > 5 else a
            event_onset = onset + 10 * (0.4 / 0.48)
        elif name == "panic_scatter":
            v = 0.5 + n()
            if 0 <= u <= dur_b:
                m = 0.9 * amp + n(0.05)
            if react <= u <= react + 8:
                a = 0.82 * amp + n(0.05)
        elif name == "gunshot_reaction":
            if 0 <= u <= 1.5:
                a, hard = 0.93 + n(0.02), True
            elif 1.5 < u <= 12:
                a = 0.6 + n(0.08)
            if react <= u <= react + dur_b:
                m = 0.9 * amp + n(0.05)
        elif name == "concert_peak":
            beat = 0.5 + 0.5 * math.sin(t * 2 * math.pi / 2.2)
            v = 0.42 * amp + n(0.04)
            m = 0.22 + 0.15 * beat + n(0.05)
            a = 0.72 * amp + 0.1 * beat + n(0.05)
        elif name == "lone_scream":
            if 0 <= u <= dur_a:
                a = 0.85 * amp + n(0.05)
        elif name == "camera_shake":
            if 0 <= u <= dur_a:
                m = 0.85 * amp + n(0.05)
        elif name == "dense_queue":
            v = base_v + (peak_v - base_v) * min(1, max(0, u) / 15) + n(0.03)
            m = 0.06 + n(0.02)
        if dropout:
            v, m, a = (0.0 if rng.random() < dropout else x for x in (v, m, a))
        ticks.append({"t": t, "vision": clamp(v), "motion": clamp(m), "audio": clamp(a), "hard": hard})
        t += DT
    return ticks, event_onset, SCENARIOS[name][0]


def _systems(base: FusionParams) -> dict[str, FusionParams]:
    never = 2.0  # active threshold that can never be met → no corroboration
    return {
        "Audio-only": replace(base, cap_audio=1.0, cap_vision=0.0, cap_motion=0.0, active_threshold=never),
        "Vision-only": replace(base, cap_audio=0.0, cap_vision=1.0, cap_motion=0.0, active_threshold=never),
        "Motion-only": replace(base, cap_audio=0.0, cap_vision=0.0, cap_motion=1.0, active_threshold=never),
        "Any-sensor OR": replace(base, cap_audio=1.0, cap_vision=1.0, cap_motion=1.0, active_threshold=never),
        "SPECTRA fusion": base,
    }


def _run_trace(params: FusionParams, ticks: list[dict]) -> tuple[str, float | None, float | None]:
    core = FusionCore(params=params)
    peak, t_high, t_crit = "normal", None, None
    for tk in ticks:
        hard = tk["hard"] and params.cap_audio > 0
        res = core.step(tk["t"], {k: tk[k] for k in ("vision", "motion", "audio")}, hard_trigger=hard)
        if level_rank(res.level) > level_rank(peak):
            peak = res.level
        if t_high is None and level_rank(res.level) >= level_rank("high"):
            t_high = tk["t"]
        if t_crit is None and res.level == "critical":
            t_crit = tk["t"]
    return peak, t_high, t_crit


def _evaluate_suite(systems: dict, trials: int, seed: int, noise: float, dropout: float) -> tuple[dict, dict]:
    rng = random.Random(seed)
    traces = {name: [_trace(name, random.Random(rng.random()), noise, dropout) for _ in range(trials)]
              for name in SCENARIOS}

    results: dict[str, dict] = {}
    confusion: dict[str, dict[str, int]] = {}
    for sys_name, params in systems.items():
        per_scenario = {}
        tp = fn = fp = tn = 0
        latencies: list[float] = []
        for name, runs in traces.items():
            alarms, lats, peaks = 0, [], {lvl: 0 for lvl in LEVELS}
            for ticks, onset, is_emergency in runs:
                peak, t_high, _ = _run_trace(params, ticks)
                peaks[peak] += 1
                alarmed = t_high is not None
                alarms += alarmed
                if is_emergency:
                    tp += alarmed
                    fn += not alarmed
                    if alarmed:
                        lats.append(t_high - onset)
                else:
                    fp += alarmed
                    tn += not alarmed
            latencies += lats
            per_scenario[name] = {
                "alarm_rate": round(alarms / trials, 3),
                "median_latency_s": round(statistics.median(lats), 2) if lats else None,
            }
            if sys_name == "SPECTRA fusion":
                confusion[name] = peaks
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        results[sys_name] = {
            "detection_rate": round(recall, 3),
            "false_alarm_rate": round(fp / (fp + tn), 3) if fp + tn else 0.0,
            "precision": round(precision, 3),
            "f1": round(2 * precision * recall / (precision + recall), 3) if precision + recall else 0.0,
            "median_latency_s": round(statistics.median(latencies), 2) if latencies else None,
            "p90_latency_s": round(sorted(latencies)[int(0.9 * (len(latencies) - 1))], 2) if latencies else None,
            "per_scenario": per_scenario,
        }

    return results, confusion


def run_evaluation(trials: int = 40, seed: int = 7) -> dict:
    t0 = time.time()
    base = FusionParams.from_config(load_config().fusion)
    systems = _systems(base)
    results, confusion = _evaluate_suite(systems, trials, seed, noise=1.0, dropout=0.0)
    stress, stress_conf = _evaluate_suite(systems, trials, seed + 1, noise=2.0, dropout=0.15)

    spectra, best_single = results["SPECTRA fusion"], results["Any-sensor OR"]
    far_reduction = None
    if best_single["false_alarm_rate"] > 0:
        far_reduction = round(1 - spectra["false_alarm_rate"] / best_single["false_alarm_rate"], 3)

    return {
        "generated_at": time.time(),
        "runtime_s": round(time.time() - t0, 2),
        "trials_per_scenario": trials,
        "seed": seed,
        "scenarios": {k: {"emergency": v[0], "description": v[1]} for k, v in SCENARIOS.items()},
        "systems": results,
        "confusion_spectra": confusion,
        "stress": {
            "description": "2× sensor noise and 15% random per-tick sensor dropout (held-out seed)",
            "systems": {k: {kk: v[kk] for kk in ("detection_rate", "false_alarm_rate", "precision", "f1",
                                                 "median_latency_s")} for k, v in stress.items()},
            "confusion_spectra": stress_conf,
        },
        "headline": {
            "false_alarm_reduction_vs_or": far_reduction,
            "spectra_detection_rate": spectra["detection_rate"],
            "spectra_false_alarm_rate": spectra["false_alarm_rate"],
            "or_false_alarm_rate": best_single["false_alarm_rate"],
        },
        "method": "Synthetic sensor-evidence traces replayed through the production FusionCore. "
                  "Alarm = reaching HIGH or above. Latency is measured from event onset; negative means "
                  "the alarm fired before the crush threshold (early warning).",
        "limitations": [
            "Traces model sensor *evidence*, not raw video/audio — perception errors are approximated by noise.",
            "Fusion thresholds were tuned on the standard suite; the stress suite uses a held-out seed, "
            "double noise and sensor dropout.",
            "No labelled real-world crowd-disaster footage was available; field validation is future work.",
        ],
        "params": base.__dict__,
    }


def save_report(report: dict) -> None:
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2))


def load_report() -> dict | None:
    if REPORT_PATH.exists():
        return json.loads(REPORT_PATH.read_text())
    return None
