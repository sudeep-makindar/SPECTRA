# Spectra

**A multimodal crowd-safety intelligence platform.**

Spectra ingests video and audio from heterogeneous sources (CCTV cameras, microphones, phone-based nodes), runs AI perception on each stream, groups sources into spatial zones, and fuses vision + motion + audio signals into a live, explainable risk score per zone. When risk crosses a threshold, it raises an alert with an evidence clip, timeline, and narrative summary.

> **Important:** Spectra is a decision-support prototype that helps control-room operators decide where to look. It is not a certified life-safety system. Pretrained models produce false positives; the project measures and reports them honestly.

## The Problem

Crowd-safety monitoring today is either purely human (operators watching too many screens) or single-modal (a camera analytics vendor that ignores audio). Both miss events. A scream on a microphone means nothing without visual context; a dense crowd looks alarming but might just be a queue. Spectra's thesis is that **cross-modal confirmation** — requiring two or more modalities to agree before raising risk — dramatically reduces false positives while catching real incidents faster.

## Why It's Hard

- **Heterogeneous sources** with different latencies, frame rates, and failure modes
- **Real-time fusion** across modalities that don't share a clock or coordinate system
- **Baseline-relative anomaly detection** (a camera's "normal" depends on angle, distance, and time of day)
- **Explainability** — an operator needs to know *why* the system is alarmed, not just *that* it is
- **Running on consumer hardware** (Apple Silicon laptop, no cloud GPU)

## Architecture

```
Sources (RTSP/webcam/phone/file) → Ingestion Gateway → [Vision Worker | Audio Worker]
    → Fusion Engine (per zone) → Alerts + Evidence → Dashboard (React)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full diagram and design decisions.

## Key Technical Decisions

| Decision | Why |
|----------|-----|
| **Zones as the core abstraction** | A microphone covers an area, not a camera's FOV. Fusion runs per zone. |
| **Cross-modal confirmation** | ≥2 modalities agreeing applies a multiplier; 1 modality alone gets dampened. This is the false-positive reducer. |
| **Hysteresis state machine** | Different up/down thresholds prevent alert flapping (NORMAL→HIGH requires 0.55, HIGH→NORMAL requires 0.40). |
| **Baseline-relative motion** | Optical flow is compared to a 60-second rolling baseline per camera, not absolute values. |
| **MPS with CPU fallback** | Runs on Apple Silicon; `PYTORCH_ENABLE_MPS_FALLBACK=1` silently falls back for unsupported ops. |
| **Everything tunable in YAML** | Fusion weights, thresholds, audio label groups — no magic numbers in code. |

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, asyncio, multiprocessing for inference workers
- **Vision:** Ultralytics YOLO (small variant, AGPL-3.0 — see [License Notes](#license-notes))
- **Motion:** OpenCV Farneback optical flow on downscaled frames
- **Audio:** HuggingFace `MIT/ast-finetuned-audioset-10-10-0.4593` (Audio Spectrogram Transformer)
- **Database:** SQLite via SQLModel
- **Frontend:** React + TypeScript, Vite, Tailwind CSS, Recharts
- **Real-time:** WebSocket for live state, REST for CRUD and history

## Quick Start

```bash
# Clone and setup
git clone <repo-url> && cd spectra
make setup

# Start dev servers (backend on :8000, frontend on :5173)
make dev

# Run tests
make test

# Launch demo with simulated sources
make demo
```

### Prerequisites

- Python 3.11+ with `uv` or `pip`
- Node.js 18+
- macOS with Apple Silicon recommended (works on any platform with CPU)

## Project Structure

```
backend/       — FastAPI server, AI workers, fusion engine
frontend/      — React dashboard
scripts/       — benchmarks, evaluation, utilities
training/      — fine-tuning stubs (Phase 7)
docs/          — architecture, decisions, benchmarks
config/        — YAML configuration files
data/          — gitignored runtime data (incidents, DB)
```

## Limitations (Honest Assessment)

- **Pretrained models** are not fine-tuned for crowd-safety; expect false positives from the audio classifier in noisy environments
- **Single-machine** architecture; no horizontal scaling
- **No ONVIF auto-discovery**; camera URLs must be configured manually
- **Privacy**: face blur is a flag, not production-grade; no anonymization pipeline
- **Audio capture** via browser requires HTTPS on non-localhost (see [docs/REMOTE_NODES.md](docs/REMOTE_NODES.md))

## What I'd Do Next

1. Fine-tune the AST audio model on a public scream/gunshot dataset (training stubs are in place)
2. Add a lightweight panic classifier on optical flow features
3. Session recorder with deterministic replay and "what-if" threshold slider
4. Shift handover summary and incident report export

## Ethics & Privacy

- Raw video/audio never leaves the server. Only evidence JSON text is sent to the LLM summarizer (if configured).
- Face blur toggle is available (behind a config flag).
- Incident clips are auto-deleted after a configurable retention period (default: 30 days).
- The system always displays "Decision-support prototype. Not a certified safety system."
- Simulated sources are clearly labeled `SIM` in the UI.

## License Notes

This project uses Ultralytics YOLO, which is licensed under AGPL-3.0. If you deploy Spectra, you must comply with AGPL-3.0 terms (open-source your deployment) or obtain a commercial Ultralytics license.

The Audio Spectrogram Transformer (AST) model is from MIT and is BSD-licensed.
