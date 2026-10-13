"""
SPECTRA evaluation harness — CLI.

    cd backend
    python -m tests.eval_harness                 # fusion benchmark (40 trials/scenario)
    python -m tests.eval_harness --trials 100
    python -m tests.eval_harness --perception    # also time YOLO + optical flow on a real video

Writes data/eval/report.json (served at /api/eval/latest and shown on the
System page) and data/eval/report.md.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import DATA_DIR  # noqa: E402
from app.evaluation.harness import EVAL_DIR, run_evaluation, save_report  # noqa: E402


def perception_benchmark(video: Path, frames: int = 100) -> dict:
    """Time the real perception models on a real video file."""
    import cv2
    from app.core.device import get_device
    from app.models.motion import MotionModel
    from app.models.vision import YoloModel

    device = get_device()
    yolo, motion = YoloModel(), MotionModel()
    yolo.load(device)
    motion.load("cpu")
    cap = cv2.VideoCapture(str(video))
    v_ms, m_ms, counts = [], [], []
    while len(v_ms) < frames:
        ok, frame = cap.read()
        if not ok:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
        inp = {"source_id": "bench", "frame": frame}
        t0 = time.perf_counter()
        r = yolo.predict(inp)
        v_ms.append((time.perf_counter() - t0) * 1000)
        t0 = time.perf_counter()
        motion.predict(inp)
        m_ms.append((time.perf_counter() - t0) * 1000)
        counts.append(r["person_count"])
    cap.release()

    def pct(xs, q):
        xs = sorted(xs[5:])  # drop warm-up
        return round(xs[min(len(xs) - 1, int(q * len(xs)))], 1)

    return {
        "video": video.name, "device": device, "frames": frames,
        "yolo_ms": {"p50": pct(v_ms, 0.5), "p95": pct(v_ms, 0.95), "p99": pct(v_ms, 0.99)},
        "flow_ms": {"p50": pct(m_ms, 0.5), "p95": pct(m_ms, 0.95), "p99": pct(m_ms, 0.99)},
        "max_fps_single_camera": round(1000 / max(pct(v_ms, 0.5), pct(m_ms, 0.5)), 1),
        "mean_people": round(sum(counts) / len(counts), 1),
    }


def to_markdown(r: dict) -> str:
    lines = ["# SPECTRA Evaluation Report", "",
             f"Trials per scenario: {r['trials_per_scenario']} · seed {r['seed']}", "",
             r["method"], "", "## Standard suite", "",
             "| Detector | Detection rate | False-alarm rate | Precision | F1 | Median latency (s) |",
             "|---|---|---|---|---|---|"]
    for name, s in r["systems"].items():
        lines.append(f"| {name} | {s['detection_rate']:.0%} | {s['false_alarm_rate']:.0%} | "
                     f"{s['precision']:.2f} | {s['f1']:.2f} | {s['median_latency_s']} |")
    lines += ["", f"## Stress suite — {r['stress']['description']}", "",
              "| Detector | Detection rate | False-alarm rate | F1 |", "|---|---|---|---|"]
    for name, s in r["stress"]["systems"].items():
        lines.append(f"| {name} | {s['detection_rate']:.0%} | {s['false_alarm_rate']:.0%} | {s['f1']:.2f} |")
    lines += ["", "## SPECTRA peak tier per scenario (standard suite)", "",
              "| Scenario | Emergency | normal | elevated | high | critical |", "|---|---|---|---|---|---|"]
    for name, c in r["confusion_spectra"].items():
        em = "yes" if r["scenarios"][name]["emergency"] else "no"
        lines.append(f"| {name} | {em} | {c['normal']} | {c['elevated']} | {c['high']} | {c['critical']} |")
    if r.get("perception"):
        p = r["perception"]
        lines += ["", "## Perception latency (real video)", "",
                  f"{p['video']} on {p['device']}: YOLO p50 {p['yolo_ms']['p50']} ms / p95 {p['yolo_ms']['p95']} ms; "
                  f"optical flow p50 {p['flow_ms']['p50']} ms; ≈{p['max_fps_single_camera']} fps per camera."]
    lines += ["", "## Limitations", ""] + [f"- {x}" for x in r["limitations"]]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--trials", type=int, default=40)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--perception", action="store_true", help="also benchmark YOLO + flow on a real video")
    ap.add_argument("--video", type=Path, default=DATA_DIR / "test_loop.mp4")
    args = ap.parse_args()

    report = run_evaluation(args.trials, args.seed)
    if args.perception:
        if args.video.exists():
            report["perception"] = perception_benchmark(args.video)
        else:
            print(f"! video not found: {args.video} — skipping perception benchmark")
    save_report(report)
    md = to_markdown(report)
    (EVAL_DIR / "report.md").write_text(md)
    print(md)
    print(f"Saved → {EVAL_DIR / 'report.json'}")


if __name__ == "__main__":
    main()
