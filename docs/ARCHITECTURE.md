# Spectra — Architecture

> A distributed, multimodal crowd-safety monitoring platform.

## Overview

Spectra ingests video and audio from heterogeneous sources, runs AI perception (person detection, optical flow, audio classification), fuses multi-modal signals per spatial zone, and surfaces explainable risk scores to control-room operators through a real-time dashboard.

It is a **decision-support prototype**, not a certified life-safety system.

## System Architecture

```
┌──────────── SOURCES (heterogeneous, typed, independent) ────────────┐
│ Video: RTSP/ONVIF CCTV · IP-Webcam phone · Browser node · File loop │
│ Audio: CCTV-embedded mic · standalone mic · Browser node · Local mic │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
 ┌─────────────────────  INGESTION GATEWAY (FastAPI)  ──────────────────┐
 │ Source adapters → normalize → timestamp → bounded latest-wins queue  │
 │ Source registry + health (fps, drops, last-seen, status)             │
 └───────────────┬───────────────────────────────────┬──────────────────┘
                 ▼                                   ▼
      VIDEO WORKER PROCESS                     AUDIO WORKER PROCESS
      • YOLO person count/density              • AST classification
      • Optical-flow motion features           • Sliding window, hop 1 s
        (baseline-relative)                    • Threat group mapping
                 └───────────────┬───────────────────┘
                                 ▼
 ┌──────────────────  FUSION ENGINE (per zone)  ─────────────────────────┐
 │ Per-modality scores 0–1 → weighted fusion → cross-modal confirmation  │
 │ → temporal smoothing (EMA) → state machine with hysteresis + cooldown │
 └───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
 ┌───────────────  ALERTS & EVIDENCE  ────────────────────────────────────┐
 │ Ring buffer per video source → incident clip (5 s before/after)       │
 │ Audio snippet · score timeline · top contributing signals             │
 │ LLM/template narrative · stored in SQLite + /data/incidents           │
 └───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
      DASHBOARD (React) ← WebSocket live state + REST for history
```

## Key Design Decisions

### Zones as the core abstraction
A zone (e.g. "Main Gate") contains N cameras and M microphones. Fusion runs per zone, not per device, because a microphone covers an area that may span multiple cameras.

### Cross-modal confirmation
The main technical argument: requiring ≥2 modalities to agree before raising risk significantly reduces false positives. A single scream detection alone gets dampened; a scream + crowd scatter + density spike confirms.

### Backpressure over buffering
Bounded queues with latest-frame-wins policy. We drop stale frames rather than building up latency. Dropped frames are counted and reported.

### Baseline-relative motion
Optical flow magnitude is compared to a rolling baseline per camera, not absolute values. This accounts for camera angle, distance, and normal activity levels.

## Tech Stack

| Layer      | Technology                                     |
|------------|------------------------------------------------|
| Backend    | Python 3.11+, FastAPI, asyncio, multiprocessing |
| Database   | SQLite via SQLModel                             |
| Vision     | Ultralytics YOLO (small), OpenCV optical flow   |
| Audio      | HuggingFace AST (AudioSet), torchaudio          |
| Frontend   | React, TypeScript, Vite, Tailwind CSS, Recharts  |
| Comms      | WebSocket (live state), REST (CRUD, history)     |
| Device     | Apple Silicon MPS with CPU fallback              |

## Directory Structure

```
/backend
  /app
    main.py              # FastAPI entry point
    /api                 # REST endpoints
    /ws                  # WebSocket handlers
    /core                # config, device, logging, metrics
    /ingest              # source adapters, registry, queues
    /perception          # vision, motion, audio workers
    /fusion              # engine, state machine, rules
    /evidence            # ring buffers, clip writer, narrative
    /models              # model registry
    /db                  # SQLModel models, session
  /config                # YAML configuration files
  /tests                 # pytest test suite
/frontend
  /src
    /components          # reusable UI components
    /pages               # route-level pages
    /hooks               # custom React hooks
    /store               # Zustand state management
    /theme               # design tokens
/scripts                 # benchmarks, evaluation, utilities
/training                # fine-tuning stubs (Phase 7)
/data                    # gitignored: incidents, datasets, checkpoints
/docs                    # architecture, decisions, benchmarks, evaluation
```
